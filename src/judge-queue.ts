#!/usr/bin/env tsx
/**
 * Parallel judging queue — processes all model responses through all judges
 * concurrently. Retries on failure; stores null on timeout so the report
 * can skip timed-out judges when computing averages.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import https from 'node:https';
import type { BenchmarkSummary } from './types.js';

const RESULTS_DIR = join(process.cwd(), 'results');
const CACHE_DIR = join(RESULTS_DIR, 'judge-cache');
const MAX_BATCH = 30;
const JUDGE_TIMEOUT_MS = 30000;
const MAX_RETRIES = 5;

const DEFAULT_JUDGES = [
  'arcee-ai/trinity-large-preview:free',
  'qwen/qwen3-coder:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'z-ai/glm-4.5-air:free',
];

// ── HTTP ────────────────────────────────────────────────────────────────────

function httpPost(url: string, hdrs: Record<string,string>, body: string, ms: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', headers: hdrs, timeout: ms }, res => {
      let d = ''; res.on('data', (c: Buffer) => d += c);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: d }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); });
    req.write(body); req.end();
  });
}

/** Call judge with retries. Returns raw text or null if all attempts fail. */
async function callJudge(jm: string, key: string, prompt: string): Promise<string|null> {
  const delays = [2000, 5000, 10000, 20000, 40000];
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await httpPost('https://openrouter.ai/api/v1/chat/completions',
        { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        JSON.stringify({ model: jm, messages: [{ role: 'user', content: prompt }], max_tokens: 4096, temperature: 0 }),
        JUDGE_TIMEOUT_MS);
      if (res.status === 200) {
        const obj = JSON.parse(res.body);
        return obj.choices?.[0]?.message?.content ?? null;
      }
      // 429 or other error — retry
    } catch { /* retry */ }
    if (attempt < delays.length) {
      await new Promise(r => setTimeout(r, delays[attempt]));
    }
  }
  return null;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

function parseBatch(text: string, n: number): Array<{ score: number; reasoning: string }> {
  let t = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/m, '').trim();
  try {
    const outer = JSON.parse(t);
    if (typeof outer === 'string') { try { t = JSON.parse(outer); } catch {} }
  } catch {}
  try {
    if (typeof t === 'string') t = t.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/m, '').trim();
    const arr = JSON.parse(t);
    if (Array.isArray(arr) && arr.length > 0) return arr.slice(0,n).map((p: any) => ({ score: clamp(p.score), reasoning: String(p.reasoning||'').slice(0,200) }));
  } catch {}
  const matches = [...t.toString().matchAll(/"score"\s*:\s*(\d+\.?\d*)/g)].map(m => clamp(parseFloat(m[1])));
  if (matches.length > 0) return matches.slice(0,n).map(s => ({ score: s, reasoning: '' }));
  return Array.from({ length: n }, () => ({ score: 0, reasoning: 'parse fail' }));
}

function clamp(v: number) { return typeof v === 'number' && !isNaN(v) ? Math.max(0, Math.min(1, v)) : 0; }

function buildPrompt(bench: string, items: Array<{ gt: string; response: string; qtype: string }>): string {
  const rubrics: Record<string, string> = {
    'angle': `Score how well the model response matches the Ground Truth (GT).
The GT contains: orientation/angle, length (as % of diagonal), position, canvas size.
Scoring checklist — start at 1.0, deduct for each missing or wrong element:
- Angle/orientation correct → keep; wrong or missing → −0.3
- Length correct (e.g. "30% of diagonal") → keep; missing → −0.2; wrong → −0.3
- Position correct (e.g. "centered") → keep; missing → −0.1
- Canvas size correct → keep; missing → −0.1; wrong → −0.1
- Completely wrong or empty → 0.0
- Minimum score is 0.0. Round to 2 decimals.`,
    'colored-dots': `Score how well the model response matches the Ground Truth (GT).
The GT contains: count of dots, colors (RGB), and positions (x,y normalized 0–1).
For each question Type:
- "describe": model should give count, colors, and positions. All correct=1.0, missing count→−0.2, missing colors→−0.2, missing positions→−0.3, wrong details→−0.2 each.
- "count": model should give the correct number. Exact=1.0, off by 1→0.8, off by 2→0.6, off by >3→0.2, no answer→0.0.
- "colors": model should list correct colors. All correct=1.0, missing one→−0.2 each, wrong color→−0.3 each.
Round to 2 decimals.`,
    'dense-dots': `Score how well the model response matches the Ground Truth (GT).
The GT is a count of black dots on a white canvas.
Exact count=1.0, off by 1=0.9, off by 2=0.8, off by 3=0.7, off by 5=0.5, off by 10=0.3, off by >15=0.1, no answer or unrelated=0.0.
Round to 2 decimals.`,
    'ocr': `Score how well the model response matches the Ground Truth (GT).
The GT describes the canvas and words shown. The model should transcribe the text.
All words correct in exact order and spelling=1.0, one word wrong or missing→−0.15 each, two wrong→−0.3 total, partial/paraphrase (right meaning but wrong words)→0.4–0.6, completely wrong or empty→0.0.
Round to 2 decimals.`,
    'code-repro': `Code correctly reproduces the image=1.0, partial=0.5, wrong=0.0.`,
  };
  const rubric = rubrics[bench] ?? rubrics.angle;
  let p = `You score vision-model responses against a Ground Truth (GT). Be strict and consistent: apply the same deductions for the same errors regardless of wording.\nRubric: ${rubric}\nReturn ONLY JSON: [{"score":0.XX,"reasoning":"one sentence"},...]\n\n`;
  items.forEach((it, i) => { p += `---${i+1}---\nGT: ${it.gt}\nModel: ${it.response||'(empty)'}\nType: ${it.qtype}\n\n`; });
  return p;
}

// ── Cache ───────────────────────────────────────────────────────────────────
// Cache file stores array of entries. Each entry: {judge, score: number|null, reasoning}
// score=null means the judge timed out after all retries (nullified).

function cachePath(jm: string, bench: string, mid: string, batch: string): string {
  return join(CACHE_DIR, jm.replace(/[^a-zA-Z0-9._-]/g, '_') + '--' + bench.replace(/[^a-zA-Z0-9._-]/g, '_') + '--' + mid.replace(/[^a-zA-Z0-9._-]/g, '_') + '--' + batch.replace(/[^a-zA-Z0-9._-]/g, '_') + '.json');
}

function isCached(jm: string, bench: string, mid: string, batch: string): boolean {
  return existsSync(cachePath(jm, bench, mid, batch));
}

function saveCache(jm: string, bench: string, mid: string, batch: string, data: any) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(jm, bench, mid, batch), JSON.stringify(data, null, 2));
}

// ── Build work queue ────────────────────────────────────────────────────────

function loadResults(): BenchmarkSummary[] {
  if (!existsSync(RESULTS_DIR)) return [];
  return readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('judge') && !f.includes('cache'))
    .map(f => { try { return JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf-8')) as BenchmarkSummary; } catch { return null; } })
    .filter(Boolean) as BenchmarkSummary[];
}

function buildQueue(summaries: BenchmarkSummary[], judges: string[]): { judgeModel: string; benchmark: string; modelId: string; batchKey: string; prompt: string; itemCount: number }[] {
  const queue: typeof arguments[0] = [];
  for (const summary of summaries) {
    const bench = summary.benchmark.replace('-repro','').replace('-judged:','').split('-judge')[0];
    const byModel = new Map<string, Array<{ sampleId: string; questionId: string; gt: string; response: string; qtype: string }>>();
    for (const r of summary.results) {
      if (!byModel.has(r.modelId)) byModel.set(r.modelId, []);
      byModel.get(r.modelId)!.push({
        sampleId: r.sampleId, questionId: r.questionId,
        gt: r.groundTruthDescription, response: r.modelResponse || '',
        qtype: r.questionId.split('|').pop() ?? '',
      });
    }
    for (const [modelId, items] of byModel) {
      for (let b = 0; b < items.length; b += MAX_BATCH) {
        const sub = items.slice(b, b + MAX_BATCH);
        const batchKey = 'b' + b;
        const prompt = buildPrompt(bench, sub.map(it => ({ gt: it.gt, response: it.response, qtype: it.qtype })));
        for (const jm of judges) {
          if (!isCached(jm, bench, modelId, batchKey)) {
            queue.push({ judgeModel: jm, benchmark: bench, modelId, batchKey, prompt, itemCount: sub.length });
          }
        }
      }
    }
  }
  return queue;
}

// ── Process queue with concurrency control ──────────────────────────────────

interface WorkResult {
  judgeModel: string;
  benchmark: string;
  modelId: string;
  batchKey: string;
  scores: Array<{ score: number | null; reasoning: string }>;
  ok: boolean;
  error?: string;
}

async function processQueue(
  queue: WorkResult[],
  apiKey: string,
  concurrency: number,
  onProgress?: (done: number, total: number, speed: number) => void,
): Promise<WorkResult[]> {
  const results: WorkResult[] = [];
  let done = 0;
  let idx = 0;
  const t0 = Date.now();

  async function worker(): Promise<void> {
    while (idx < queue.length) {
      const item = queue[idx++];
      const resp = await callJudge(item.judgeModel, apiKey, item.prompt);
      const scores = resp
        ? parseBatch(resp, item.itemCount).map(s => ({ score: s.score, reasoning: s.reasoning }))
        : Array.from({ length: item.itemCount }, () => ({ score: null as number | null, reasoning: 'timeout after retries' }));
      saveCache(item.judgeModel, item.benchmark, item.modelId, item.batchKey, scores.map(s => ({ judge: item.judgeModel, score: s.score, reasoning: s.reasoning })));
      results.push({
        judgeModel: item.judgeModel, benchmark: item.benchmark, modelId: item.modelId,
        batchKey: item.batchKey, scores, ok: resp !== null,
        error: resp === null ? 'All retries failed' : undefined,
      });
      done++;
      const elapsed = (Date.now() - t0) / 1000;
      const speed = done / elapsed;
      onProgress?.(done, queue.length, speed);
      // Rate-limit: pause between requests to avoid 429 on free tier
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const concurrencyArg = args.findIndex(a => a === '--concurrency' || a === '-c');
  const concurrency = concurrencyArg >= 0 ? parseInt(args[concurrencyArg + 1]) : 5;
  const judgesArg = args.findIndex(a => a === '--judges');
  const judges = judgesArg >= 0 ? args[judgesArg + 1].split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_JUDGES;
  const apiKey = process.env.OPENROUTER_API_KEY ?? '';
  if (!apiKey) { console.error('Set OPENROUTER_API_KEY'); process.exit(1); }

  const summaries = loadResults();
  console.log(`Loaded ${summaries.length} benchmark files, ${summaries.reduce((n,s) => n + s.results.length, 0)} evals`);
  console.log(`Using ${judges.length} judges (${MAX_RETRIES} retries, ${JUDGE_TIMEOUT_MS/1000}s timeout each), concurrency=${concurrency}`);

  const queue = buildQueue(summaries, judges);
  const totalSlots = judges.length * summaries.reduce((n,s) => n + Math.ceil(s.results.length / MAX_BATCH), 0);
  const cached = totalSlots - queue.length;
  console.log(`Work queue: ${queue.length} items (${cached} cached, ${queue.length} to process)`);

  if (queue.length === 0) { console.log('All items cached. Done.'); process.exit(0); }

  await processQueue(queue, apiKey, concurrency, (done, total, speed) => {
    const pct = ((done/total)*100).toFixed(1);
    const remaining = Math.round((total - done) / speed);
    const barW = 40;
    const filled = Math.round((done/total) * barW);
    const bar = '█'.repeat(filled) + '░'.repeat(barW - filled);
    process.stdout.write(`\r[${bar}] ${done}/${total} (${pct}%) | ${speed.toFixed(1)}/s | ETA: ${remaining}s    `);
  });
  process.stdout.write('\n');
  console.log(`Done! Processed ${queue.length} items.`);
}

main().catch(e => { console.error(e); process.exit(1); });
