/**
 * Code reproduction benchmark runner.
 *
 * Loads previous benchmark results (from results/*.json), extracts the samples,
 * and for each model re-generates the images then asks the model to reproduce them
 * via code. Executes in a sandbox, scores pixel precision/recall/F1.
 *
 * Results are cached by full config hash — no re-runs if inputs haven't changed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, Image } from 'canvas';
import type { BenchmarkSummary, EvalResult, Model, ProviderConfig } from '../types.js';
import { hashInput, CODE_REPRO_API, INPUT_VERSION } from '../input-versioning.js';
import { cacheLookup, cacheStore } from '../cache.js';

/** Run inference with the model's API */
async function callModel(
  provider: ProviderConfig,
  model: Model,
  imageBase64: string,
  prompt: string
): Promise<{ text: string; timeMs: number; error?: string }> {
  const t0 = Date.now();
  try {
    const httpFetch = (url: string, opts: any) => new Promise((resolve, reject) => {
      const lib = new URL(url).protocol === 'https:' ? require('https') : require('http');
      const parsed = new URL(url);
      const req = lib.request(url, { method: opts.method ?? 'POST', headers: opts.headers, timeout: 180000 }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', reject);
      if (opts.body) req.write(opts.body);
      req.end();
    });

    if (provider.provider === 'openrouter') {
      const baseUrl = (provider as any).baseUrl ?? 'https://openrouter.ai/api/v1';
      const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
      const res: any = await httpFetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${(provider as any).apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/nicolas/vision-benchmark',
          'X-Title': 'vision-benchmark',
        },
        body: JSON.stringify({
          model: model.id,
          messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }, { type: 'text', text: prompt }] }],
          max_tokens: model.maxTokens ?? 2048,
          temperature: model.temperature ?? 0,
        }),
      });
      if (res.status !== 200) throw new Error(`OpenRouter ${res.status}: ${res.body}`);
      return { text: JSON.parse(res.body).choices?.[0]?.message?.content ?? '', timeMs: Date.now() - t0 };
    } else {
      const baseUrl = (provider as any).baseUrl ?? 'http://localhost:11434';
      const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;
      const res: any = await httpFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.id, messages: [{ role: 'user', content: prompt, images: [imageBase64] }], stream: false,
          options: { temperature: model.temperature ?? 0, num_predict: model.maxTokens ?? 2048 },
        }),
        timeout: 300000,
      });
      if (res.status !== 200) throw new Error(`Ollama ${res.status}: ${res.body}`);
      return { text: JSON.parse(res.body).message?.content ?? '', timeMs: Date.now() - t0 };
    }
  } catch (err: any) {
    return { text: '', timeMs: Date.now() - t0, error: err.message };
  }
}

/**
 * Execute model-generated drawing code in a sandbox.
 * Returns a canvas with the rendered result, or null on failure.
 */
export function executeReproCode(code: string, width: number, height: number): ReturnType<typeof createCanvas> | null {
  try {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgb(255,255,255)';
    ctx.fillRect(0, 0, width, height);

    const clean = code.replace(/^```[a-z]*\s*/g, '').replace(/```$/g, '').trim();

    const api = {
      fillRect: (x: number, y: number, w: number, h: number, c: [number, number, number]) => { ctx.fillStyle = `rgb(${c.join(',')})`; ctx.fillRect(x, y, w, h); },
      fillCircle: (cx: number, cy: number, r: number, c: [number, number, number]) => { ctx.fillStyle = `rgb(${c.join(',')})`; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); },
      drawLine: (x1: number, y1: number, x2: number, y2: number, lw: number, c: [number, number, number]) => { ctx.strokeStyle = `rgb(${c.join(',')})`; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); },
      fillText: (text: string, x: number, y: number, fs: number, c: [number, number, number]) => { ctx.fillStyle = `rgb(${c.join(',')})`; ctx.font = `${fs}px Arial`; ctx.textBaseline = 'top'; ctx.fillText(text, x, y); },
    };

    new Function('ctx', clean)(api);
    return canvas;
  } catch {
    return null;
  }
}

/**
 * Pixel comparison: foreground = brightness < 240.
 * Returns precision, recall, F1.
 */
export function comparePixels(original: ReturnType<typeof createCanvas>, reproduced: ReturnType<typeof createCanvas> | null): {
  precision: number; recall: number; f1: number; tp: number; fp: number; fn: number;
} {
  if (!reproduced) return { precision: 0, recall: 0, f1: 0, tp: 0, fp: 0, fn: 0 };
  const od = original.getContext('2d').getImageData(0, 0, original.width, original.height).data;
  const rd = reproduced.getContext('2d').getImageData(0, 0, reproduced.width, reproduced.height).data;
  let tp = 0, fp = 0, fn = 0;
  for (let i = 0; i < od.length; i += 4) {
    const oFg = (od[i] + od[i+1] + od[i+2]) / 3 < 240;
    const rFg = (rd[i] + rd[i+1] + rd[i+2]) / 3 < 240;
    if (oFg && rFg) tp++; else if (!oFg && rFg) fp++; else if (oFg && !rFg) fn++;
  }
  const p = tp + fp > 0 ? tp / (tp + fp) : 0;
  const r = tp + fn > 0 ? tp / (tp + fn) : 0;
  return { precision: p, recall: r, f1: p + r > 0 ? 2 * p * r / (p + r) : 0, tp, fp, fn };
}

/**
 * Sample enriched for reproduction.
 */
interface ReproSample {
  benchmark: string;
  id: string;
  imageBase64: string;
  width: number;
  height: number;
  groundTruthDescription: string;
}

/**
 * Load samples from previous benchmark run results.
 * Extracts the original image and ground truth from any results JSON file.
 */
export function loadReproSamples(resultsDir: string): ReproSample[] {
  if (!existsSync(resultsDir)) return [];
  const files = readdirSync(resultsDir).filter(f => f.endsWith('.json'));
  const samples: ReproSample[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(resultsDir, file), 'utf-8'));
      for (const result of (data.results ?? [])) {
        const key = `${result.modelId}--${result.sampleId}`;
        if (result.imageDataUrl && !seen.has(key) && !result.error) {
          seen.add(key);
          // Extract width/height from image if we stored it
          samples.push({
            benchmark: data.benchmark.replace('-repro', ''),
            id: result.sampleId,
            imageBase64: result.imageDataUrl.replace(/^data:image\/png;base64,/, ''),
            width: 256,  // default
            height: 256,
            groundTruthDescription: result.groundTruthDescription,
          });
        }
      }
    } catch {}
  }
  return samples;
}

/**
 * Run the reproduction benchmark.
 * For each sample, prompts the model with the code-repro API doc + image.
 */
export async function runReproBenchmark(params: {
  samples: ReproSample[];
  models: Model[];
  provider: ProviderConfig;
}): Promise<BenchmarkSummary> {
  const { samples, models, provider } = params;
  const startedAt = new Date().toISOString();
  const allResults: EvalResult[] = [];

  for (const model of models) {
    console.log(`\n[repro] Model: ${model.displayName ?? model.id} (${samples.length} samples)`);

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const cacheKeyString = `repro/${hashInput({ s: sample })}/${model.id}`;
      const cached = cacheLookup(model.id, cacheKeyString);

      let modelCode: string;
      let errorMsg: string | undefined;
      let elapsed: number;

      if (cached && cached.responseText !== '') {
        modelCode = cached.responseText;
        elapsed = cached.totalResponseTimeMs;
        console.log(`  ◎ [cache] ${sample.id}`);
      } else {
        const call = await callModel(provider, model, sample.imageBase64, CODE_REPRO_API);
        modelCode = call.text;
        elapsed = call.timeMs;
        errorMsg = call.error;
        cacheStore(model.id, cacheKeyString, { responseText: modelCode, totalResponseTimeMs: elapsed, error: errorMsg });
        console.log(`  ✓ ${sample.id} (${elapsed}ms, error: ${!!errorMsg})`);
      }

      const origCanvas = createCanvas(sample.width, sample.height);
      const origCtx = origCanvas.getContext('2d');
      try {
        const img = new Image(); img.src = `data:image/png;base64,${sample.imageBase64}`;
        origCtx.drawImage(img, 0, 0);
      } catch {}

      const reproCanvas = errorMsg ? null : executeReproCode(modelCode, sample.width, sample.height);
      const pixels = comparePixels(origCanvas, reproCanvas);

      // Create side-by-side image (original | reproduced)
      const sideBySide = createCanvas(sample.width * 2 + 4, sample.height);
      const sbCtx = sideBySide.getContext('2d');
      sbCtx.drawImage(origCanvas, 0, 0);
      if (reproCanvas) sbCtx.drawImage(reproCanvas, sample.width + 4, 0);

      allResults.push({
        sampleId: sample.id, questionId: `${sample.id}|repro`,
        modelId: model.id, provider: provider.provider,
        groundTruthDescription: sample.groundTruthDescription,
        imageDataUrl: `data:image/png;base64,${sideBySide.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')}`,
        modelResponse: modelCode || '', score: pixels.f1,
        dimensionScores: { precision: pixels.precision, recall: pixels.recall, f1: pixels.f1 },
        totalResponseTimeMs: elapsed, error: errorMsg,
      });
    }
  }

  const endedAt = new Date().toISOString();
  const modelScores: Record<string, { avgScore: number; avgTimeMs: number; sampleCount: number }> = {};
  for (const m of models) {
    const mr = allResults.filter(r => r.modelId === m.id);
    modelScores[m.id] = {
      avgScore: mr.length ? mr.reduce((s, r) => s + r.score, 0) / mr.length : 0,
      avgTimeMs: mr.length ? mr.reduce((s, r) => s + r.totalResponseTimeMs, 0) / mr.length : 0,
      sampleCount: mr.length,
    };
  }

  const summary: BenchmarkSummary = {
    benchmark: 'code-repro', startedAt, endedAt,
    modelCount: models.length, sampleCount: samples.length,
    results: allResults, modelScores,
  };

  console.log('\n' + '═'.repeat(85));
  console.log('Code Reproduction Results — pixel precision/recall/F1');
  console.log('═'.repeat(85));
  console.log(`${'Model'.padEnd(40)} ${'F1'.padStart(8)} ${'Prec'.padStart(8)} ${'Recall'.padStart(8)} ${'Avg ms'.padStart(10)} ${'Samples'.padStart(8)}`);
  for (const m of models) {
    const ms = modelScores[m.id];
    const mr = allResults.filter(r => r.modelId === m.id);
    const avgP = mr.length ? mr.reduce((s, r) => s + (r.dimensionScores?.precision ?? 0), 0) / mr.length : 0;
    const avgR = mr.length ? mr.reduce((s, r) => s + (r.dimensionScores?.recall ?? 0), 0) / mr.length : 0;
    console.log(`${(m.displayName ?? m.id).padEnd(40)} ${ms.avgScore.toFixed(3).padStart(8)} ${avgP.toFixed(3).padStart(8)} ${avgR.toFixed(3).padStart(8)} ${ms.avgTimeMs.toFixed(0).padStart(10)} ${ms.sampleCount.toString().padStart(8)}`);
  }

  return summary;
}
