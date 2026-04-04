/**
 * bench:repro — Code-reproduction benchmark.
 *
 * For each existing sample (from any benchmark), the model receives the image
 * and is asked to write drawing code to reproduce it. The code is executed in
 * a sandbox with our primitives. Results are scored at pixel level
 * (precision/recall/F1).
 *
 * Results include side-by-side original vs reproduced images for the report.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BenchmarkSummary, EvalResult, Model, ProviderConfig, GroundTruth } from '../types.js';
import { createCanvas, Image } from 'canvas';
import { runInference } from '../providers/index.js';
import { executeReproCode, comparePixels, REPRO_PROMPT } from '../benchmarks/code-repro.js';
import { cacheLookup, cacheStore } from '../cache.js';

type ReproSample = {
  id: string;
  imageBase64: string;
  groundTruth: GroundTruth;
};

/**
 * Run the code-reproduction benchmark across models + samples.
 */
export async function runReproBenchmark(params: {
  benchmark: string;
  samples: ReproSample[];
  models: Model[];
  provider: ProviderConfig;
}): Promise<BenchmarkSummary> {
  const { benchmark, samples, models, provider } = params;
  const startedAt = new Date().toISOString();

  console.log(`\n[repro] ${samples.length} samples × ${models.length} models`);

  const allResults: EvalResult[] = [];

  for (const model of models) {
    console.log(`\n  Testing: ${model.displayName ?? model.id}`);
    for (const sample of samples) {
      const info = `${model.displayName ?? model.id} → ${sample.id}`;

      // Check cache: benchmark+model+sample
      const cfgForCache = { benchmark };
      const cacheKeyRaw = cacheLookup(model.id, `repro/${benchmark}/${sample.id}`);

      let responseText: string;
      let error: string | undefined;
      let elapsed: number;

      if (cacheKeyRaw && cacheKeyRaw.responseText) {
        responseText = cacheKeyRaw.responseText;
        elapsed = cacheKeyRaw.totalResponseTimeMs;
        error = cacheKeyRaw.error;
        console.log(`  ◎ [cache] ${info} (${elapsed}ms)`);
      } else {
        const t0 = Date.now();
        try {
          responseText = await runInference(provider, model, sample.imageBase64, REPRO_PROMPT);
        } catch (err: unknown) {
          error = err instanceof Error ? err.message : String(err);
          responseText = '';
          console.error(`  ✗ ${info}: ${error}`);
        }
        elapsed = Date.now() - t0;

        // Cache the raw code response
        cacheStore(model.id, `repro/${benchmark}/${sample.id}`, {
          responseText, totalResponseTimeMs: elapsed, error,
        });
      }

      // Execute the generated code
      const reproCanvas = error ? null : executeReproCode(responseText, sample.groundTruth.width, sample.groundTruth.height);

      // Create original canvas from sample
      const origCanvas = createCanvas(sample.groundTruth.width, sample.groundTruth.height);
      try {
        const img = new Image();
        img.src = `data:image/png;base64,${sample.imageBase64}`;
        origCanvas.getContext('2d').drawImage(img, 0, 0);
      } catch { /* keep blank */ }

      // Pixel-level comparison
      const pixels = comparePixels(origCanvas, reproCanvas);

      // Build repro image for report (side-by-side)
      const sideBySideCanvas = createCanvas(sample.groundTruth.width * 2 + 2, sample.groundTruth.height);
      const sbCtx = sideBySideCanvas.getContext('2d');
      // Original on left
      sbCtx.drawImage(origCanvas, 0, 0);
      // Divider
      sbCtx.fillStyle = '#30363d';
      sbCtx.fillRect(sample.groundTruth.width, 0, 2, sample.groundTruth.height);
      // Reproduced on right (or gray if failed)
      if (reproCanvas) {
        sbCtx.drawImage(reproCanvas, sample.groundTruth.width + 2, 0);
      } else {
        sbCtx.fillStyle = '#1a1a2e';
        sbCtx.fillRect(sample.groundTruth.width + 2, 0, sample.groundTruth.width, sample.groundTruth.height);
        sbCtx.fillStyle = '#8b949e';
        sbCtx.font = '16px sans-serif';
        sbCtx.fillText('execution failed', sample.groundTruth.width + 20, sample.groundTruth.height / 2);
      }
      const sideBySideBase64 = sideBySideCanvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');

      allResults.push({
        sampleId: sample.id,
        questionId: `${sample.id}|repro`,
        modelId: model.id,
        provider: provider.provider,
        groundTruthDescription: sample.groundTruth.description,
        imageDataUrl: `data:image/png;base64,${sideBySideBase64}`,
        modelResponse: responseText || '',
        score: pixels.f1,
        dimensionScores: {
          pixel_precision: pixels.precision,
          pixel_recall: pixels.recall,
          pixel_f1: pixels.f1,
        },
        totalResponseTimeMs: elapsed,
        error,
      });

      const tag = error ? 'exec-failed' : `p=${pixels.precision.toFixed(2)} r=${pixels.recall.toFixed(2)} f1=${pixels.f1.toFixed(2)}`;
      console.log(`  ✓ ${info} [${tag}, ${elapsed}ms]`);
    }
  }

  const endedAt = new Date().toISOString();
  const modelScores: Record<string, { avgScore: number; avgTimeMs: number; sampleCount: number }> = {};
  for (const model of models) {
    const mr = allResults.filter(r => r.modelId === model.id);
    modelScores[model.id] = {
      avgScore: mr.length ? mr.reduce((s, r) => s + r.score, 0) / mr.length : 0,
      avgTimeMs: mr.length ? mr.reduce((s, r) => s + r.totalResponseTimeMs, 0) / mr.length : 0,
      sampleCount: mr.length,
    };
  }

  const summary: BenchmarkSummary = {
    benchmark: `${benchmark}-repro`,
    startedAt, endedAt,
    modelCount: models.length,
    sampleCount: samples.length,
    results: allResults,
    modelScores,
  };

  // Print table
  console.log('\n' + '='.repeat(80));
  console.log(`Results — ${summary.benchmark}`);
  console.log('='.repeat(80));
  console.log(`${'Model'.padEnd(45)} ${'F1'.padStart(8)} ${'Precision'.padStart(10)} ${'Recall'.padStart(8)} ${'Avg ms'.padStart(10)}`);
  console.log('-'.repeat(80));
  for (const m of models) {
    const ms = modelScores[m.id];
    const precResults = allResults.filter(r => r.modelId === m.id && r.dimensionScores);
    const avgP = precResults.length ? precResults.reduce((s, r) => s + (r.dimensionScores?.pixel_precision ?? 0), 0) / precResults.length : 0;
    const avgR = precResults.length ? precResults.reduce((s, r) => s + (r.dimensionScores?.pixel_recall ?? 0), 0) / precResults.length : 0;
    console.log(`${(m.displayName ?? m.id).padEnd(45)} ${ms.avgScore.toFixed(3).padStart(8)} ${avgP.toFixed(3).padStart(10)} ${avgR.toFixed(3).padStart(8)} ${ms.avgTimeMs.toFixed(0).padStart(10)}`);
  }
  console.log('='.repeat(80));

  return summary;
}
