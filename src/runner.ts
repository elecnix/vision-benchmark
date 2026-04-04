import type {
  BenchmarkSummary, EvalResult, ModelResponse,
  AngleBenchmarkConfig, ColoredDotsBenchmarkConfig, DenseDotsBenchmarkConfig,
  OCRBenchmarkConfig, GroundTruth, Model, ProviderConfig,
} from './types.js';
import {
  generateAngleSamples,
  generateColoredDotsSamples,
  generateDenseDotsSamples,
  generateOCRSamples,
} from './generators/index.js';
import { generateQuestions } from './benchmarks/questions.js';
import { scoreResponse } from './benchmarks/evaluator.js';
import { runInference } from './providers/index.js';
import { cacheLookup, cacheStore } from './cache.js';

type BenchConfig = AngleBenchmarkConfig | ColoredDotsBenchmarkConfig | DenseDotsBenchmarkConfig | OCRBenchmarkConfig;
type BenchType = 'angle' | 'colored-dots' | 'dense-dots' | 'ocr';

function samplesFor(bench: BenchType, config: BenchConfig) {
  switch (bench) {
    case 'angle': return Array.from(generateAngleSamples(config as AngleBenchmarkConfig));
    case 'colored-dots': return Array.from(generateColoredDotsSamples(config as ColoredDotsBenchmarkConfig));
    case 'dense-dots': return Array.from(generateDenseDotsSamples(config as DenseDotsBenchmarkConfig));
    case 'ocr': return Array.from(generateOCRSamples(config as OCRBenchmarkConfig));
  }
}

export async function runBenchmark(params: {
  benchmark: BenchType;
  config: BenchConfig;
  models: Model[];
  provider: ProviderConfig;
  onProgress?: (current: number, total: number, info: string) => void;
}): Promise<BenchmarkSummary> {
  const { benchmark, config, models, provider, onProgress } = params;
  const startedAt = new Date().toISOString();

  console.log(`\n[${benchmark}] Generating samples…`);
  const samples = samplesFor(benchmark, config);
  console.log(`  → ${samples.length} samples generated.`);

  const questions = Array.from(generateQuestions(samples));
  const qPerSample = samples.length ? (questions.length / samples.length).toFixed(1) : '0';
  console.log(`  → ${questions.length} questions generated (${qPerSample} per sample).\n`);

  // Cache summary
  let cacheHits = 0, cacheMisses = 0;

  const allResults: EvalResult[] = [];
  let taskIdx = 0;
  const totalTasks = questions.length * models.length;

  for (const model of models) {
    console.log(`[${benchmark}] Testing: ${model.displayName ?? model.id}`);
    for (const question of questions) {
      taskIdx++;
      const sample = samples.find(s => s.id === question.sampleId)!;
      const info = `${model.displayName ?? model.id} → ${question.id} (${taskIdx}/${totalTasks})`;
      onProgress?.(taskIdx, totalTasks, info);

      // Check cache first
      const cached = cacheLookup(model.id, sample.id + "|" + question.id.replace(sample.id + "|", ""));
      if (cached) {
        cacheHits++;
        const mr: ModelResponse = {
          sampleId: sample.id, questionId: question.id,
          modelId: model.id, provider: provider.provider,
          responseText: cached.responseText,
          totalResponseTimeMs: cached.totalResponseTimeMs || 0,
          error: cached.error,
        };
        const result = scoreResponse(mr, sample.groundTruth);
        result.imageDataUrl = `data:image/png;base64,${sample.imageBase64}`;
        allResults.push(result);
        const tag = cached.error ? 'error' : `score=${result.score.toFixed(2)}`;
        console.log(`  ◎ [cache] ${info} [${tag}, ${cached.totalResponseTimeMs}ms]`);
        continue;
      }
      cacheMisses++;

      const t0 = Date.now();
      let responseText = '';
      let error: string | undefined;
      try {
        responseText = await runInference(provider, model, sample.imageBase64, question.prompt);
      } catch (err: unknown) {
        error = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${info}: ${error}`);
      }
      const elapsed = Date.now() - t0;

      // Store in cache
      cacheStore(model.id, sample.id + "|" + question.id.replace(sample.id + "|", ""), {
        responseText, totalResponseTimeMs: elapsed, error,
      });

      const mr: ModelResponse = {
        sampleId: sample.id, questionId: question.id,
        modelId: model.id, provider: provider.provider,
        responseText, totalResponseTimeMs: elapsed, error,
      };
      const result = scoreResponse(mr, sample.groundTruth);
      result.imageDataUrl = `data:image/png;base64,${sample.imageBase64}`;
      allResults.push(result);

      const tag = error ? 'error' : `score=${result.score.toFixed(2)}`;
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
    benchmark, startedAt, endedAt,
    modelCount: models.length, sampleCount: samples.length,
    results: allResults, modelScores,
  };

  console.log('\n' + '='.repeat(80));
  console.log(`Results — ${benchmark}`);
  console.log('='.repeat(80));
  console.log(`${'Model'.padEnd(45)} ${'Score'.padStart(8)} ${'Avg ms'.padStart(10)} ${'Samples'.padStart(8)}`);
  console.log('-'.repeat(80));
  for (const m of models) {
    const ms = modelScores[m.id];
    console.log(`${(m.displayName ?? m.id).padEnd(45)} ${ms.avgScore.toFixed(3).padStart(8)} ${ms.avgTimeMs.toFixed(0).padStart(10)} ${String(ms.sampleCount).padStart(8)}`);
  }
  console.log('='.repeat(80));
  console.log(`  Cache: ${cacheHits} hits, ${cacheMisses} misses (${cacheHits + cacheMisses > 0 ? (cacheHits / (cacheHits + cacheMisses) * 100).toFixed(0) : 0}% hit rate)`);

  return summary;
}
