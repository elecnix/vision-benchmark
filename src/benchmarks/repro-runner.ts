/**
 * bench:repro — Code reproduction benchmark.
 *
 * For each existing benchmark sample image:
 *  1. Shows the image to the model + API documentation
 *  2. Model writes code using our drawing primitives
 *  3. Execute code in sandbox with real drawing context
 *  4. Compare original vs reproduced pixel-by-pixel (precision/recall/F1)
 *  5. Store side-by-side image in report for inspection
 *
 * Results are cached by (model, sample) — only re-runs if model changes.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage } from 'canvas';
import type { BenchmarkSummary, EvalResult, Model, ProviderConfig } from '../types.js';
import { runInference } from '../providers/index.js';
import { cacheLookup, cacheStore } from '../cache.js';
import { CODE_REPRO_API } from '../input-versioning.js';

export interface ReproSample {
  sampleId: string;
  width: number;
  height: number;
  imageBase64: string;
  groundTruthDescription: string;
}

/**
 * Load repro samples from results JSON files.
 * Uses loadImage() from node-canvas to correctly parse PNGs and get dimensions.
 */
export async function loadReproSamples(resultsDir: string): Promise<ReproSample[]> {
  if (!existsSync(resultsDir)) return [];
  const samples: ReproSample[] = [];
  const seen = new Set<string>();
  // Skip code-repro outputs (they contain side-by-side images, not originals)
  const files = readdirSync(resultsDir)
    .filter(f => f.endsWith('.json') && !f.startsWith('repro-') && !f.includes('repro'))
    .sort();

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(resultsDir, file), 'utf-8'));
      for (const r of (data.results ?? [])) {
        if (!r.imageDataUrl || seen.has(r.sampleId)) continue;
        seen.add(r.sampleId);
        try {
          const b64 = r.imageDataUrl.replace(/^data:image\/png;base64,/, '');
          const img = await loadImage(`data:image/png;base64,${b64}`);
          samples.push({
            sampleId: r.sampleId,
            width: img.width, height: img.height,
            imageBase64: b64,
            groundTruthDescription: r.groundTruthDescription ?? r.sampleId ?? '',
          });
        } catch {
          samples.push({
            sampleId: r.sampleId, width: 256, height: 256,
            imageBase64: r.imageDataUrl.replace(/^data:image\/png;base64,/, ''),
            groundTruthDescription: r.groundTruthDescription ?? r.sampleId ?? '',
          });
        }
      }
    } catch {}
  }
  return samples;
}

/**
 * Execute model-generated drawing code in a sandbox.
 * Returns a canvas with the rendered output, or null if execution failed.
 */
export function executeReproCode(code: string, width: number, height: number): ReturnType<typeof createCanvas> | null {
  try {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    // White background
    ctx.fillStyle = 'rgb(255,255,255)';
    ctx.fillRect(0, 0, width, height);

    const clean = code.replace(/^```\w*\s*/g, '').replace(/```\s*$/g, '').trim();

    // Expose drawing functions as bare names (the model writes bare calls)
    const fillRectW = (x:number, y:number, w:number, h:number, c:[number,number,number]) => { ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.fillRect(x, y, w, h); };
    const fillCircleW = (cx:number, cy:number, r:number, c:[number,number,number]) => { ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill(); };
    const drawLineW = (x1:number, y1:number, x2:number, y2:number, lw:number, c:[number,number,number]) => { ctx.strokeStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    const fillTextW = (text:string, x:number, y:number, fs:number, c:[number,number,number]) => { ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.font = `${fs}px Arial`; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillText(text, x, y); };

    new Function('fillRect', 'fillCircle', 'drawLine', 'fillText', 'ctx', clean)(fillRectW, fillCircleW, drawLineW, fillTextW, {});
    return canvas;
  } catch {
    return null;
  }
}

/**
 * Pixel-level comparison: brightness < 240 = foreground.
 *
 * precision = tp / (tp+fp) — of reproduced foreground pixels, how many match original?
 * recall    = tp / (tp+fn) — of original foreground pixels, how many were reproduced?
 * f1        = 2 * p * r / (p + r)
 */
export function comparePixels(
  original: ReturnType<typeof createCanvas>,
  reproduced: ReturnType<typeof createCanvas> | null
): { precision: number; recall: number; f1: number; tp: number; fp: number; fn: number } {
  if (!reproduced || original.width !== reproduced.width || original.height !== reproduced.height) {
    return { precision: 0, recall: 0, f1: 0, tp: 0, fp: 0, fn: 0 };
  }
  const od = original.getContext('2d').getImageData(0, 0, original.width, original.height).data;
  const rd = reproduced.getContext('2d').getImageData(0, 0, reproduced.width, reproduced.height).data;
  const total = od.length / 4;
  let tp = 0, fp = 0, fn = 0;

  for (let i = 0; i < od.length; i += 4) {
    const origFg = (od[i] + od[i+1] + od[i+2]) / 3 < 240;
    const reproFg = (rd[i] + rd[i+1] + rd[i+2]) / 3 < 240;
    if (origFg && reproFg) tp++;
    else if (!origFg && reproFg) fp++;
    else if (origFg && !reproFg) fn++;
  }

  const p = tp + fp > 0 ? tp / (tp + fp) : 0;
  const r = tp + fn > 0 ? tp / (tp + fn) : 0;
  return {
    precision: p, recall: r,
    f1: p + r > 0 ? (2 * p * r) / (p + r) : 0,
    tp, fp, fn,
  };
}

/** Run the reproduction benchmark */
export async function runReproBenchmark(params: {
  samples: ReproSample[];
  models: Model[];
  provider: ProviderConfig;
}): Promise<BenchmarkSummary> {
  const { samples, models, provider } = params;
  const startedAt = new Date().toISOString();
  const allResults: EvalResult[] = [];

  for (const model of models) {
    console.log(`\n[repro] ${model.displayName ?? model.id} × ${samples.length} samples`);
    for (const sample of samples) {
      const cacheKey = `repro/${sample.sampleId}/${model.id}`;
      const cached = cacheLookup(model.id, cacheKey);
      let modelCode: string, error: string|undefined, elapsed: number;

      if (cached) {
        modelCode = cached.responseText; elapsed = cached.totalResponseTimeMs; error = cached.error;
        console.log(`  ◎ [cache] ${sample.sampleId}`);
      } else {
        const t0 = Date.now();
        try { modelCode = await runInference(provider, model, sample.imageBase64, CODE_REPRO_API); }
        catch (e: any) { modelCode = ''; error = e.message; }
        elapsed = Date.now() - t0;
        cacheStore(model.id, cacheKey, { responseText: modelCode, totalResponseTimeMs: elapsed, error });
      }

      // Original canvas
      const origCanvas = createCanvas(sample.width, sample.height);
      try {
        const origImg = await loadImage(`data:image/png;base64,${sample.imageBase64}`);
        origCanvas.getContext('2d').drawImage(origImg, 0, 0);
      } catch { /* blank */ }

      // Execute reproduction
      const reproCanvas = error ? null : executeReproCode(modelCode, sample.width, sample.height);
      const pixels = comparePixels(origCanvas, reproCanvas);

      // Side-by-side image
      const sw = sample.width * 2 + 2;
      const sb = createCanvas(sw, sample.height);
      const sbCtx = sb.getContext('2d');
      sbCtx.fillStyle = '#0d1117'; sbCtx.fillRect(0, 0, sw, sample.height);
      sbCtx.drawImage(origCanvas, 0, 0);
      if (reproCanvas) {
        sbCtx.drawImage(reproCanvas, sample.width + 2, 0);
      }

      allResults.push({
        sampleId: sample.sampleId, questionId: `${sample.sampleId}|repro`,
        modelId: model.id, provider: provider.provider,
        groundTruthDescription: sample.groundTruthDescription,
        imageDataUrl: `data:image/png;base64,${sb.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')}`,
        modelResponse: modelCode, score: pixels.f1,
        dimensionScores: { pixel_precision: pixels.precision, pixel_recall: pixels.recall, pixel_f1: pixels.f1 },
        totalResponseTimeMs: elapsed, error,
      });

      const tag = error ? 'err' : `p=${pixels.precision.toFixed(2)} r=${pixels.recall.toFixed(2)} f1=${pixels.f1.toFixed(2)}`;
      console.log(`  ✓ ${sample.sampleId} [${tag}, ${elapsed}ms]`);
    }
  }

  const endedAt = new Date().toISOString();
  const modelScores: Record<string, { avgScore: number; avgTimeMs: number; sampleCount: number }> = {};
  for (const m of models) {
    const mr = allResults.filter(r => r.modelId === m.id);
    modelScores[m.id] = {
      avgScore: mr.length ? mr.reduce((s,r) => s+r.score, 0)/mr.length : 0,
      avgTimeMs: mr.length ? mr.reduce((s,r) => s+r.totalResponseTimeMs, 0)/mr.length : 0,
      sampleCount: mr.length,
    };
  }

  const summary: BenchmarkSummary = {
    benchmark: 'code-repro', startedAt, endedAt,
    modelCount: models.length, sampleCount: samples.length,
    results: allResults, modelScores,
  };

  console.log('\n' + '='.repeat(90));
  console.log('Code Reproduction — Pixel Precision / Recall / F1');
  console.log('='.repeat(90));
  for (const m of models) {
    const ms = modelScores[m.id];
    const mr = allResults.filter(r => r.modelId === m.id);
    const avgP = mr.length ? mr.reduce((s,r) => s+(r.dimensionScores?.pixel_precision??0),0)/mr.length : 0;
    const avgR = mr.length ? mr.reduce((s,r) => s+(r.dimensionScores?.pixel_recall??0),0)/mr.length : 0;
    console.log(`${(m.displayName ?? m.id).padEnd(40)} F1=${ms.avgScore.toFixed(4).padStart(8)}  P=${avgP.toFixed(4).padStart(8)}  R=${avgR.toFixed(4).padStart(8)}  ${ms.avgTimeMs.toFixed(0).padStart(8)}ms  (${ms.sampleCount})`);
  }

  return summary;
}
