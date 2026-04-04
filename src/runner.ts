import type {
  AngleBenchmarkConfig,
  DotsBenchmarkConfig,
  GroundTruth,
  Model,
  EvalResult,
  BenchmarkSummary,
  ProviderConfig,
  ModelResponse,
} from './types.js';
import { generateAngleSamples, generateDotsSamples } from './generators/index.js';
import { generateQuestions } from './benchmarks/questions.js';
import { scoreResponse } from './benchmarks/evaluator.js';
import { runInference } from './providers/index.js';

/**
 * Run a single benchmark against one or more models.
 *
 * Flow: generate samples → generate questions → call models → score → summarize.
 * Each sample→question→model is handled sequentially to avoid rate-limit issues.
 * Progress is logged to stdout.
 */
export async function runBenchmark(params: {
  benchmark: 'angle' | 'dots';
  config: AngleBenchmarkConfig | DotsBenchmarkConfig;
  models: Model[];
  provider: ProviderConfig;
  onProgress?: (current: number, total: number, info: string) => void;
}): Promise<BenchmarkSummary> {
  const { benchmark, config, models, provider, onProgress } = params;

  const startedAt = new Date().toISOString();

  // ── Step 1: Generate samples ──
  console.log(`\n[${benchmark}] Generating samples…`);
  const samples: Array<{ id: string; imageBase64: string; groundTruth: GroundTruth }> = [];
  if (benchmark === 'angle') {
    for (const s of generateAngleSamples(config as AngleBenchmarkConfig)) {
      samples.push(s);
    }
  } else {
    for (const s of generateDotsSamples(config as DotsBenchmarkConfig)) {
      samples.push(s);
    }
  }
  console.log(`  → ${samples.length} samples generated.`);

  // ── Step 2: Generate questions ──
  const questions = Array.from(generateQuestions(samples));
  console.log(`  → ${questions.length} questions generated (${questions.length / samples.length} per sample).\n`);

  // ── Step 3: Run inference ──
  const allResults: EvalResult[] = [];
  let taskIndex = 0;
  const totalTasks = questions.length * models.length;

  for (const model of models) {
    console.log(`[${benchmark}] Testing model: ${model.displayName ?? model.id}`);

    for (const question of questions) {
      taskIndex++;
      const sample = samples.find((s) => s.id === question.sampleId)!;
      const info = `${model.displayName ?? model.id} → ${question.id} (${taskIndex}/${totalTasks})`;

      onProgress?.(taskIndex, totalTasks, info);

      const startTime = Date.now();
      let responseText = '';
      let error: string | undefined;

      try {
        responseText = await runInference(provider, model, sample.imageBase64, question.prompt);
      } catch (err: any) {
        error = err.message;
        console.error(`  ✗ Error on ${info}: ${error}`);
      }

      const totalResponseTimeMs = Date.now() - startTime;

      const modelResponse: ModelResponse = {
        sampleId: sample.id,
        questionId: question.id,
        modelId: model.id,
        provider: provider.provider,
        responseText,
        totalResponseTimeMs,
        error,
      };

      const result = scoreResponse(modelResponse, sample.groundTruth);
      result.imageDataUrl = `data:image/png;base64,${sample.imageBase64}`;
      allResults.push(result);

      const scoreStr = error ? `error` : `score=${result.score.toFixed(2)}`;
      console.log(`  ✓ ${info} [${scoreStr}, ${totalResponseTimeMs}ms]`);
    }
  }

  // ── Step 4: Summarize ──
  const endedAt = new Date().toISOString();
  const modelScores: Record<string, { avgScore: number; avgTimeMs: number; sampleCount: number }> = {};

  for (const model of models) {
    const modelResults = allResults.filter((r) => r.modelId === model.id);
    const avgScore =
      modelResults.length > 0 ? modelResults.reduce((sum, r) => sum + r.score, 0) / modelResults.length : 0;
    const avgTimeMs =
      modelResults.length > 0 ? modelResults.reduce((sum, r) => sum + r.totalResponseTimeMs, 0) / modelResults.length : 0;
    modelScores[model.id] = {
      avgScore,
      avgTimeMs,
      sampleCount: modelResults.length,
    };
  }

  const summary: BenchmarkSummary = {
    benchmark,
    startedAt,
    endedAt,
    modelCount: models.length,
    sampleCount: samples.length,
    results: allResults,
    modelScores,
  };

  // Print table
  console.log('\n' + '='.repeat(80));
  console.log(`Results — ${benchmark} benchmark`);
  console.log('='.repeat(80));
  console.log(
    `${'Model'.padEnd(45)} ${'Score'.padStart(8)} ${'Avg ms'.padStart(10)} ${'Samples'.padStart(8)}`
  );
  console.log('-'.repeat(80));
  for (const model of models) {
    const ms = modelScores[model.id];
    console.log(
      `${(model.displayName ?? model.id).padEnd(45)} ${ms.avgScore.toFixed(3).padStart(8)} ${ms.avgTimeMs.toFixed(0).padStart(10)} ${String(ms.sampleCount).padStart(8)}`
    );
  }
  console.log('='.repeat(80));

  return summary;
}
