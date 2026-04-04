#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [k, ...rest] = trimmed.split('=');
      if (k && rest.length) process.env[k.trim()] = rest.join('=').trim();
    }
  }
}
import { Command } from 'commander';
import { resolveProviderConfig, defaultAngleConfig, defaultColoredDotsConfig, defaultDenseDotsConfig, quickAngleConfig, quickDenseDotsConfig } from './config.js';
import { makeModel } from './utils/model.js';
import { listAvailableModels } from './providers/index.js';
import { runBenchmark } from './runner.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const program = new Command();
program.name('vision-bench').description('Deterministic synthetic benchmarks for vision-language models').version('0.2.0');
program
  .option('-p, --provider <name>', 'openrouter | ollama', 'openrouter')
  .option('-k, --api-key <key>', 'API key (openrouter)')
  .option('--ollama-url <url>', 'Ollama base URL')
  .option('-m, --model <ids...>', 'Model ID(s) to test')
  .option('--max-tokens <n>', 'Max output tokens', '512')
  .option('--temperature <n>', 'Temperature', '0')
  .option('--quick', 'Use reduced sample count (faster)');

function providerFromOpts() {
  const opts = program.opts();
  return resolveProviderConfig(opts.provider, { apiKey: opts.apiKey, ollamaUrl: opts.ollamaUrl });
}

function modelsFromOpts(provider: ReturnType<typeof providerFromOpts>) {
  const opts = program.opts();
  const ids = opts.model ?? [];
  if (!ids.length) throw new Error('No model specified. Use -m <id>');
  return ids.map((id: string) => makeModel(id, provider, {
    maxTokens: parseInt(opts.maxTokens), temperature: parseFloat(opts.temperature),
  }));
}

function saveResults(name: string, summary: unknown) {
  const dir = join(process.cwd(), 'results');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(summary, null, 2));
  console.log(`\n  → Saved: ${file}`);
}

// ── bench:angle ────────────────────────────────────────────────────────────
program.command('bench:angle').description('Run the angle/line recognition benchmark').action(async () => {
  const provider = providerFromOpts();
  const models = modelsFromOpts(provider);
  const quick = program.opts().quick;
  const summary = await runBenchmark({
    benchmark: 'angle', config: quick ? quickAngleConfig : defaultAngleConfig,
    models, provider,
  });
  saveResults(`angle-${quick ? 'quick-' : ''}${models[0].id.replace(/[:/]/g,'_')}`, summary);
});

// ── bench:colored-dots ─────────────────────────────────────────────────────
program.command('bench:colored-dots').description('Run the colored dots benchmark (multicolored)').action(async () => {
  const provider = providerFromOpts();
  const models = modelsFromOpts(provider);
  const summary = await runBenchmark({
    benchmark: 'colored-dots', config: defaultColoredDotsConfig,
    models, provider,
  });
  saveResults(`colored-dots-${models[0].id.replace(/[:/]/g,'_')}`, summary);
});

// ── bench:dense-dots ───────────────────────────────────────────────────────
program.command('bench:dense-dots').description('Run the dense black dots benchmark').action(async () => {
  const provider = providerFromOpts();
  const models = modelsFromOpts(provider);
  const quick = program.opts().quick;
  const summary = await runBenchmark({
    benchmark: 'dense-dots', config: quick ? quickDenseDotsConfig : defaultDenseDotsConfig,
    models, provider,
  });
  saveResults(`dense-dots-${quick ? 'quick-' : ''}${models[0].id.replace(/[:/]/g,'_')}`, summary);
});

// ── bench:all  (runs all four benchmarks) ──────────────────────────────────
program.command('bench:all').description('Run all benchmarks (angle, colored-dots, dense-dots)').action(async () => {
  const provider = providerFromOpts();
  const models = modelsFromOpts(provider);
  const quick = program.opts().quick;

  for (const [name, config] of [
    ['angle', quick ? quickAngleConfig : defaultAngleConfig] as const,
    ['colored-dots', defaultColoredDotsConfig] as const,
    ['dense-dots', quick ? quickDenseDotsConfig : defaultDenseDotsConfig] as const,
  ]) {
    await runBenchmark({ benchmark: name as any, config, models, provider });
  }
});

// ── list ───────────────────────────────────────────────────────────────────
program.command('list:models').description('List available vision models').action(async () => {
  const opts = program.opts();
  let cfg: any;
  try { cfg = resolveProviderConfig(opts.provider, { ollamaUrl: opts.ollamaUrl }); } catch { cfg = { provider: opts.provider }; }
  const models = await listAvailableModels(cfg);
  console.log(`\nAvailable vision models for ${opts.provider}:`);
  models.forEach((m: string) => console.log(`  • ${m}`));
  console.log(`\n  (${models.length} total)`);
});

program.command('list:datasets').description('List available benchmark datasets').action(() => {
  console.log(`
Available benchmarks:

  angle               — Line/orientation recognition
                        Questions: describe, angle (°), bar length (short/med/long)
                        Default config: 18 angles × 3 bar lengths × 1 size = 54 images

  colored-dots        — Multicolored dots counting & color identification
                        Questions: describe, count, colors
                        Default: 6 counts × 1 size = 6 images

  dense-dots          — Many small black dots (counting challenge)
                        Questions: count
                        Default: 6 counts (10-200) × 1 size = 6 images
`);
});

program.command('show-config').description('Show default benchmark configurations').action(() => {
  console.log(JSON.stringify({ angle: defaultAngleConfig, 'colored-dots': defaultColoredDotsConfig, 'dense-dots': defaultDenseDotsConfig }, null, 2));
});

program.parse();
