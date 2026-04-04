#!/usr/bin/env npx tsx
/**
 * run-local.ts — Run quick benchmarks against local Ollama models.
 * Small config (256×256 only), 30s timeout, 2 vision models.
 */

import { resolveProviderConfig } from './src/config.js';
import { makeModel } from './src/utils/model.js';
import { runBenchmark } from './src/runner.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Quick minimal config
const quickAngle = {
  sizes: [{ width: 256, height: 256 }],
  lines: ['horizontal', 'vertical', 'diagonal-45', 'diagonal-135'] as const,
  lineColors: [[0, 0, 0] as [number, number, number]],
  backgroundColors: [[255, 255, 255] as [number, number, number]],
  lineWidths: [8],
};

const quickDots = {
  sizes: [{ width: 256, height: 256 }],
  dotCounts: [1, 2, 3, 4, 5],
  dotRadii: [16],
  dotColors: [[255, 0, 0] as [number, number, number]],
  backgroundColors: [[255, 255, 255] as [number, number, number]],
  layout: 'scattered' as const,
};

const provider = resolveProviderConfig('ollama');
const models = ['llava-llama3'].map((id: string) => makeModel(id, provider, {
  maxTokens: 128,
  temperature: 0,
}));

async function run() {
  // Run angle benchmark
  console.log('=== ANGLE BENCHMARK ===');
  const angleSummary = await runBenchmark({
    benchmark: 'angle',
    config: quickAngle,
    models,
    provider,
  });
  saveResult('angle-llava-llama3', angleSummary);

  // Run dots benchmark
  console.log('\n=== DOTS BENCHMARK ===');
  const dotsSummary = await runBenchmark({
    benchmark: 'dots',
    config: quickDots,
    models,
    provider,
  });
  saveResult('dots-llava-llama3', dotsSummary);
}

function saveResult(name: string, summary: any) {
  const dir = join(process.cwd(), 'results');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(summary, null, 2));
  console.log(`→ Saved: ${file}`);
}

run().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
