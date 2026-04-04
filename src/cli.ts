#!/usr/bin/env node

/**
 * vision-benchmark CLI.
 *
 * Usage:
 *   npx vision-bench bench angle [--model <id>] [--provider openrouter|ollama]
 *   npx vision-bench bench dots [--model <id>] [--provider openrouter|ollama]
 *   npx vision-bench list models [--provider openrouter|ollama]
 *   npx vision-bench list datasets
 */

import { Command } from 'commander';
import { resolveProviderConfig, defaultAngleConfig, defaultDotsConfig } from './config.js';
import { makeModel } from './utils/model.js';
import { listAvailableModels } from './providers/index.js';
import { runBenchmark } from './runner.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const program = new Command();
program.name('vision-bench').description('Deterministic synthetic benchmarks for vision-language models').version('0.1.0');

// ── Shared options on the top-level command ─────────────────────────────────
program
  .option('-p, --provider <name>', 'Provider: openrouter or ollama', 'openrouter')
  .option('-k, --api-key <key>', 'API key (openrouter)')
  .option('--ollama-url <url>', 'Ollama base URL (default: http://localhost:11434)')
  .option('-m, --model <ids...>', 'Model ID(s) to test (can be repeated)')
  .option('--max-tokens <n>', 'Max output tokens', '1024')
  .option('--temperature <n>', 'Temperature', '0');

// ── bench angle ─────────────────────────────────────────────────────────────

program
  .command('bench:angle')
  .description('Run the angle/line recognition benchmark')
  .action(async () => {
    const opts = program.opts();
    const provider = resolveProviderConfig(opts.provider, {
      apiKey: opts.apiKey,
      ollamaUrl: opts.ollamaUrl,
    });

    const modelIds = opts.model ?? ['gemini-flash'];
    const models = modelIds.map((id: string) => makeModel(id, provider, {
      maxTokens: parseInt(opts.maxTokens),
      temperature: parseFloat(opts.temperature),
    }));

    const summary = await runBenchmark({
      benchmark: 'angle',
      config: defaultAngleConfig,
      models,
      provider,
    });

    const resultsDir = join(process.cwd(), 'results');
    if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
    const outFile = join(resultsDir, `angle-${Date.now()}.json`);
    writeFileSync(outFile, JSON.stringify(summary, null, 2));
    console.log(`\nResults saved to: ${outFile}`);
  });

// ── bench dots ──────────────────────────────────────────────────────────────

program
  .command('bench:dots')
  .description('Run the dot counting & positioning benchmark')
  .action(async () => {
    const opts = program.opts();
    const provider = resolveProviderConfig(opts.provider, {
      apiKey: opts.apiKey,
      ollamaUrl: opts.ollamaUrl,
    });

    const modelIds = opts.model ?? ['gemini-flash'];
    const models = modelIds.map((id: string) => makeModel(id, provider, {
      maxTokens: parseInt(opts.maxTokens),
      temperature: parseFloat(opts.temperature),
    }));

    const summary = await runBenchmark({
      benchmark: 'dots',
      config: defaultDotsConfig,
      models,
      provider,
    });

    const resultsDir = join(process.cwd(), 'results');
    if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
    const outFile = join(resultsDir, `dots-${Date.now()}.json`);
    writeFileSync(outFile, JSON.stringify(summary, null, 2));
    console.log(`\nResults saved to: ${outFile}`);
  });

// ── list models ─────────────────────────────────────────────────────────────

program
  .command('list:models')
  .description('List available vision models')
  .action(async () => {
    const opts = program.opts();
    let config: any;
    try {
      config = resolveProviderConfig(opts.provider, { ollamaUrl: opts.ollamaUrl });
    } catch {
      config = { provider: opts.provider };
    }

    const models = await listAvailableModels(config);
    console.log(`\nAvailable vision models for ${opts.provider}:`);
    models.forEach((m: string) => console.log(`  • ${m}`));
    console.log(`\n  (${models.length} total)`);
  });

// ── list datasets ───────────────────────────────────────────────────────────

program
  .command('list:datasets')
  .description('List available benchmark datasets')
  .action(() => {
    console.log('\nAvailable benchmark datasets:');
    console.log('');
    console.log('  angle');
    console.log('    Tests line angle/orientation recognition');
    console.log('    Questions: describe, angle, orientation');
    console.log('    Default: 2 sizes × 4 line types × 1 color × 1 bg × 1 width = 8 images');
    console.log('');
    console.log('  dots');
    console.log('    Tests dot counting and position recognition');
    console.log('    Questions: describe, count, positions');
    console.log('    Default: 2 sizes × 7 counts × 1 radius × 1 color × 1 bg = 14 images');
  });

// ── show-config ─────────────────────────────────────────────────────────────

program
  .command('show-config')
  .description('Show default benchmark configurations')
  .action(() => {
    console.log('\nDefault angle config:');
    console.log(JSON.stringify(defaultAngleConfig, null, 2));
    console.log('\nDefault dots config:');
    console.log(JSON.stringify(defaultDotsConfig, null, 2));
  });

program.parse();
