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
import { resolveProviderConfig, defaultAngleConfig, defaultColoredDotsConfig, defaultDenseDotsConfig, defaultOCRConfig, quickAngleConfig, quickDenseDotsConfig, expandedAngleConfig, expandedColoredDotsConfig, expandedDenseDotsConfig, expandedOCRConfig } from './config.js';
import { makeModel } from './utils/model.js';
import { listAvailableModels } from './providers/index.js';
import { runBenchmark } from './runner.js';
import { writeFileSync, mkdirSync, existsSync as fsExists, rmSync, readdirSync as fsReaddir, unlinkSync } from 'node:fs';
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
  return ids.map((id) => makeModel(id, provider, {
    maxTokens: parseInt(opts.maxTokens), temperature: parseFloat(opts.temperature),
  }));
}

function saveResults(name: string, summary: unknown) {
  const dir = join(process.cwd(), 'results');
  if (!fsExists(dir)) mkdirSync(dir, { recursive: true });
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

// ── bench:ocr ──────────────────────────────────────────────────────────────
program.command('bench:ocr').description('Run the OCR benchmark (read text from images)').action(async () => {
  const provider = providerFromOpts();
  const models = modelsFromOpts(provider);
  const summary = await runBenchmark({
    benchmark: 'ocr', config: defaultOCRConfig,
    models, provider,
  });
  saveResults(`ocr-${models[0].id.replace(/[:/]/g,'_')}`, summary);
});

// ── bench:all  (runs all four benchmarks) ──────────────────────────────────
program.command('bench:all').description('Run all benchmarks (angle, colored-dots, dense-dots)').action(async () => {
  const provider = providerFromOpts();
  const models = modelsFromOpts(provider);
  const quick = program.opts().quick;

  for (const [name, config, prefix] of [
    ['angle', quick ? quickAngleConfig : defaultAngleConfig, quick ? 'angle-quick-' : 'angle-'],
    ['colored-dots', defaultColoredDotsConfig, 'colored-dots-'],
    ['dense-dots', quick ? quickDenseDotsConfig : defaultDenseDotsConfig, quick ? 'dense-dots-quick-' : 'dense-dots-'],
  ]) {
    await runBenchmark({ benchmark: name, config, models, provider });
    // Don't save bench:all results (individual runs already cached and saved)
  }
});

// ── bench:expanded ───────────────────────────────────────────────────────
program.command('bench:expanded').description('Run expanded benchmarks (2x sizes, more samples)').action(async () => {
  const provider = providerFromOpts();
  const models = modelsFromOpts(provider);
  const prefixes = {
    angle: 'angle-expanded-',
    'colored-dots': 'colored-dots-expanded-',
    'dense-dots': 'dense-dots-expanded-',
    ocr: 'ocr-expanded-',
  };
  for (const [name, config] of [
    ['angle', expandedAngleConfig],
    ['colored-dots', expandedColoredDotsConfig],
    ['dense-dots', expandedDenseDotsConfig],
    ['ocr', expandedOCRConfig],
  ] as const) {
    console.log(`\n▶ Running expanded ${name} benchmark...`);
    const summary = await runBenchmark({ benchmark: name, config, models, provider });
    saveResults(`${prefixes[name]}${models[0].id.replace(/[:/]/g,'_')}`, summary);
  }
});

// ── list ───────────────────────────────────────────────────────────────────
program.command('list:models').description('List available vision models').action(async () => {
  const opts = program.opts();
  let cfg;
  try { cfg = resolveProviderConfig(opts.provider, { ollamaUrl: opts.ollamaUrl }); } catch { cfg = { provider: opts.provider }; }
  const models = await listAvailableModels(cfg);
  console.log(`\nAvailable vision models for ${opts.provider}:`);
  models.forEach((m) => console.log(`  • ${m}`));
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

  ocr                 — Text recognition (pseudo-random words, no hints)
                        Questions: "Read every word in order"
                        Cases: single word (tiny/huge), 2-5 words scattered,
                               paragraph columns (left/center/right),
                               paragraph rows (top/center/bottom)
`);
});

program.command('show-config').description('Show default benchmark configurations').action(() => {
  console.log(JSON.stringify({ angle: defaultAngleConfig, 'colored-dots': defaultColoredDotsConfig, 'dense-dots': defaultDenseDotsConfig }, null, 2));
});

// ── bench:repro ────────────────────────────────────────────────────────────
program.command('bench:repro').description('Code-reproduction benchmark: models write drawing code, pixel-level scoring').option('-b, --benchmarks <ids...>', 'Source benchmarks to load samples from (default: all)').action(async () => {
  const provider = providerFromOpts();
  const models = modelsFromOpts(provider);
  const { runReproBenchmark, loadReproSamples } = await import('./benchmarks/repro-runner.js');
  const samples = await loadReproSamples(join(process.cwd(), 'results'));
  if (!samples.length) { console.error('No repro samples found. Run a regular benchmark first.'); return; }
  const unique = samples.filter((s, i, arr) => arr.findIndex(a => a.sampleId === s.sampleId) === i);
  console.log(`Loaded ${unique.length} unique repro samples from existing benchmark results.`);
  const summary = await runReproBenchmark({ samples: unique, models, provider });
  saveResults(`repro-${models[0].id.replace(/[:/]/g,'_')}`, summary);
});

// ── cache:stats ────────────────────────────────────────────────────────────
program.command('cache:stats').description('Show response cache statistics (avoids re-paying for tokens)').action(async () => {
  const { cacheStats } = await import('./cache.js');
  const stats = cacheStats();
  if (!stats.length) {
    console.log('  No cached results yet. Run a benchmark to start caching.');
    return;
  }
  console.log('\nCached model responses:');
  for (const s of stats) {
    const short = s.modelId.includes('/') ? s.modelId.split('/').pop() : s.modelId;
    console.log(`  • ${short.padEnd(32)} ${String(s.entries).padStart(4)} responses`);
  }
});

// ── cache:clear ────────────────────────────────────────────────────────────
program.command('cache:clear').description('Clear the response cache')
  .option('-m, --model <id>', 'Clear cache for a specific model only')
  .action(async (opts) => {
    const CACHE_DIR = join(process.cwd(), 'results', 'cache');
    if (!fsExists(CACHE_DIR)) { console.log('  No cache to clear.'); return; }
    if (opts.model) {
      const fname = join(CACHE_DIR, `${opts.model.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`);
      if (fsExists(fname)) { unlinkSync(fname); console.log(`  Cleared cache for ${opts.model}`); }
      else { console.log(`  No cache found for ${opts.model}`); }
    } else {
      const files = fsReaddir(CACHE_DIR);
      for (const f of files) unlinkSync(join(CACHE_DIR, f));
      console.log(`  Cleared all cache (${files.length} files).`);
    }
  });

program.parse();
