#!/usr/bin/env tsx
/**
 * generate-report.ts
 *
 * Reads benchmark JSON results (with embedded image data URLs),
 * generates a self-contained static report site ready for GitHub Pages.
 *
 * Output:
 *   docs/index.html      — full report with images, scores, responses
 *   docs/results.jsonl   — one JSON line per evaluation result
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BenchmarkSummary, EvalResult } from '../src/types.js';

const RESULTS_DIR = join(process.cwd(), 'results');
const DOCS_DIR = join(process.cwd(), 'docs');

function loadResults(): BenchmarkSummary[] {
  if (!existsSync(RESULTS_DIR)) {
    console.error('No results/ directory. Run benchmarks first.');
    process.exit(1);
  }
  const files = readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json')).sort();
  if (!files.length) {
    console.error('No JSON files in results/.');
    process.exit(1);
  }
  return files.map(f => JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf-8')));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scoreClass(score: number): string {
  if (score >= 0.8) return 'score-good';
  if (score >= 0.5) return 'score-mid';
  return 'score-bad';
}

function fmtMs(ms: number): string {
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
  return Math.round(ms) + 'ms';
}

/** Build the full HTML report */
function buildReport(summaries: BenchmarkSummary[]): { html: string; jsonl: string } {
  // ── Aggregate ──
  const allResults = summaries.flatMap(s => s.results.map(r => ({ ...r, benchmark: s.benchmark })));
  const uniqueModels = [...new Set(allResults.map(r => r.modelId))];
  const totalSamples = new Set(allResults.map(r => r.sampleId + r.questionId)).size;

  // Group by (benchmark, sampleId, questionId)
  interface QuestionGroup {
    benchmark: string;
    sampleId: string;
    questionId: string;
    questionType: string;
    imageDataUrl?: string;
    gtDescription: string;
    responses: EvalResult[];
  }
  const questionMap = new Map<string, QuestionGroup>();
  for (const r of allResults) {
    const key = `${r.benchmark}|${r.sampleId}|${r.questionId}`;
    if (!questionMap.has(key)) {
      questionMap.set(key, {
        benchmark: r.benchmark,
        sampleId: r.sampleId,
        questionId: r.questionId,
        questionType: r.questionId.split('|').pop() || '',
        imageDataUrl: r.imageDataUrl,
        gtDescription: r.groundTruthDescription,
        responses: [],
      });
    }
    questionMap.get(key)!.responses.push(r);
  }

  // Group questions by benchmark then sample
  const benchMap = new Map<string, Map<string, QuestionGroup[]>>();
  for (const q of questionMap.values()) {
    if (!benchMap.has(q.benchmark)) benchMap.set(q.benchmark, new Map());
    const sMap = benchMap.get(q.benchmark)!;
    if (!sMap.has(q.sampleId)) sMap.set(q.sampleId, []);
    sMap.get(q.sampleId)!.push(q);
  }

  // Leaderboard
  const modelStats = uniqueModels.map(id => {
    const ms = allResults.filter(r => r.modelId === id);
    const avgScore = ms.reduce((a, r) => a + r.score, 0) / ms.length;
    const avgTime = ms.reduce((a, r) => a + r.totalResponseTimeMs, 0) / ms.length;
    const errors = ms.filter(r => r.error).length;
    return { id, avgScore, avgTime, count: ms.length, errors };
  }).sort((a, b) => b.avgScore - a.avgScore);

  // Per-benchmark per-model
  const benchModelScores: Record<string, Record<string, number>> = {};
  for (const [bench, sMap] of benchMap) {
    benchModelScores[bench] = {};
    for (const id of uniqueModels) {
      const ms = allResults.filter(r => r.benchmark === bench && r.modelId === id);
      if (ms.length) {
        benchModelScores[bench][id] = ms.reduce((a, r) => a + r.score, 0) / ms.length;
      }
    }
  }

  // ── Build HTML ──
  let body = '';

  // Leaderboard
  body += '<h2>Leaderboard</h2>\n';
  body += '<table class="leaderboard">';
  body += '<thead><tr><th></th><th>Model</th><th>Avg Score</th><th>Avg Latency</th><th>Evals</th><th>Errors</th></tr></thead>\n';
  body += '<tbody>\n';
  for (let i = 0; i < modelStats.length; i++) {
    const m = modelStats[i];
    const shortName = m.id.includes('/') ? m.id.split('/').pop()! : m.id;
    body += '<tr>';
    body += `<td style="font-weight:700;color:var(--accent)">${i === 0 ? '🥇' : i === 1 ? '🥈' : ' ' + (i + 1)}</td>`;
    body += `<td><code>${escapeHtml(shortName)}</code></td>`;
    body += `<td><span class="badge ${scoreClass(m.avgScore)}">${m.avgScore.toFixed(3)}</span></td>`;
    body += `<td style="font-family:var(--mono)">${fmtMs(m.avgTime)}</td>`;
    body += `<td>${m.count}</td><td>${m.errors || '-'}</td>`;
    body += '</tr>\n';

    for (const [bench, scores] of Object.entries(benchModelScores)) {
      if (scores[m.id] !== undefined) {
        body += '<tr class="sub-row">';
        body += `<td></td><td style="padding-left:28px;color:var(--text-dim)">↳ ${bench}</td>`;
        body += `<td><span class="badge ${scoreClass(scores[m.id])}">${scores[m.id].toFixed(3)}</span></td>`;
        body += '<td></td><td></td><td></td></tr>\n';
      }
    }
  }
  body += '</tbody></table>\n';

  // Detailed sample cards
  body += '<h2>Detailed Results</h2>\n';

  for (const [bench, sMap] of benchMap) {
    body += `<h3 style="color:var(--accent);margin-top:32px">${bench}</h3>\n`;
    body += '<div class="sample-grid">\n';

    for (const [sampleId, questions] of sMap) {
      const img = questions[0].imageDataUrl;
      const gtShort = questions[0].gtDescription.split('.')[0];

      body += '<div class="sample-card">\n';

      if (img) {
        body += `<div class="sample-img"><img src="${img}" alt="${escapeHtml(sampleId)}"></div>\n`;
      } else {
        body += `<div class="sample-img" style="padding:32px;color:var(--text-dim);font-size:.85rem">📷 ${escapeHtml(sampleId.split('|').slice(-1)[0])}</div>\n`;
      }

      body += `<div class="gt-info"><code>${escapeHtml(gtShort)}</code></div>\n`;

      // Group by model
      const modelResponses = new Map<string, QuestionGroup[]>();
      for (const q of questions) {
        if (!modelResponses.has(q.questionType)) modelResponses.set(q.questionType, []);
        modelResponses.get(q.questionType)!.push(q);
      }

      for (const [qType, qs] of modelResponses) {
        body += `<div class="response-block">\n`;
        body += `<div class="resp-header"><strong>${escapeHtml(qType)}</strong></div>\n`;

        for (const q of qs) {
          for (const r of q.responses) {
            const shortModel = r.modelId.includes('/') ? r.modelId.split('/').pop()! : r.modelId;
            body += '<div class="resp-item">\n';
            body += `<div class="resp-q">${escapeHtml(shortModel)}</div>\n`;
            const respText = r.modelResponse || '(empty response)';
            body += `<div class="resp-a">${escapeHtml(respText)}</div>\n`;
            body += `<div class="resp-meta"><span class="badge ${scoreClass(r.score)}">${r.score.toFixed(2)}</span><span>${fmtMs(r.totalResponseTimeMs)}</span>${r.error ? '<span class="badge score-bad">error</span>' : ''}</div>\n`;
            body += '</div>\n';
          }
        }
        body += '</div>\n';
      }

      body += '</div>\n';
    }
    body += '</div>\n';
  }

  // JSONL log
  const jsonl = allResults.map(r =>
    JSON.stringify({
      benchmark: r.benchmark,
      modelId: r.modelId,
      score: r.score,
      timeMs: r.totalResponseTimeMs,
      error: r.error || null,
      response: (r.modelResponse || '').slice(0, 500),
      gt: r.groundTruthDescription,
    })
  );

  body += '<div class="jsonl-section"><h2>Session Log (JSON Lines)</h2>\n';
  body += `<p class="note">Download: <a href="results.jsonl" download>results.jsonl</a> (${jsonl.length} lines)</p>\n`;
  body += '<pre class="jsonl">\n';
  for (const line of jsonl) body += escapeHtml(line) + '\n';
  body += '</pre></div>\n';

  // Stats bar
  const now = new Date().toISOString();
  const header = `
  <header><div class="wrap">
    <h1>🔬 vision-benchmark</h1>
    <p>Synthetic deterministic vision-language model benchmarks — ${now}</p>
  </div></header>
  <main class="wrap">
    <div class="stats">
      <div class="stat"><div class="val">${uniqueModels.length}</div><div class="lbl">Models</div></div>
      <div class="stat"><div class="val">${benchMap.size}</div><div class="lbl">Benchmarks</div></div>
      <div class="stat"><div class="val">${questionMap.size}</div><div class="lbl">Questions</div></div>
      <div class="stat"><div class="val">${allResults.length}</div><div class="lbl">Evaluations</div></div>
    </div>`;

  const footer = `
  <footer><div class="wrap">Generated by <a href="https://github.com/nicolas/vision-benchmark">vision-benchmark</a></div></footer>`;

  const style = `
<style>
  :root{--bg:#0d1117;--surface:#161b22;--border:#30363d;--text:#e6edf3;--text-dim:#8b949e;--accent:#58a6ff;--green:#3fb950;--yellow:#d29922;--red:#f85149;--mono:'SF Mono','Fira Code',monospace;--sans:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:var(--sans);background:var(--bg);color:var(--text);line-height:1.6}
  a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
  .wrap{max-width:1200px;margin:0 auto;padding:0 24px}
  header{border-bottom:1px solid var(--border);padding:24px 0}
  header h1{font-size:1.5rem}header p{color:var(--text-dim);font-size:.9rem;margin-top:4px}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:24px 0}
  .stat{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;text-align:center}
  .stat .val{font-size:2rem;font-weight:700}.stat .lbl{font-size:.75rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px}
  table.leaderboard{width:100%;border-collapse:collapse;margin:24px 0}
  table.leaderboard th{text-align:left;font-size:.75rem;color:var(--text-dim);text-transform:uppercase;padding:8px 12px;border-bottom:1px solid var(--border)}
  table.leaderboard td{padding:10px 12px;border-bottom:1px solid var(--border);font-size:.9rem}
  table.leaderboard tr.sub-row td{color:var(--text-dim);font-size:.85rem;background:rgba(88,166,255,.03)}
  .badge{display:inline-block;font-family:var(--mono);font-weight:700;font-size:.85rem;padding:2px 8px;border-radius:4px}
  .score-good{background:rgba(63,185,80,.15);color:var(--green)}.score-mid{background:rgba(210,153,34,.15);color:var(--yellow)}.score-bad{background:rgba(248,81,73,.15);color:var(--red)}
  h2{margin:32px 0 16px}.bench-group{margin:24px 0}.bench-group h3{color:var(--accent);margin-bottom:12px}
  .sample-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:20px}
  .sample-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden}
  .sample-img{background:repeating-conic-gradient(var(--bg) 0% 25%,transparent 0% 50%) 0 0/16px 16px;text-align:center;padding:12px}
  .sample-img img{max-width:100%;max-height:240px;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.4)}
  .gt-info{padding:8px 14px;color:var(--text-dim);font-family:var(--mono);font-size:.8rem;border-bottom:1px solid var(--border)}
  .response-block{border-top:1px solid var(--border)}.resp-header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;font-size:.85rem;background:rgba(88,166,255,.03)}
  .resp-item{padding:8px 14px;border-top:1px solid rgba(48,54,61,.5)}.resp-q{font-size:.75rem;color:var(--accent);font-family:var(--mono);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}
  .resp-a{font-size:.85rem;color:var(--text-dim);white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,.25);padding:8px 10px;border-radius:4px;margin:4px 0;max-height:120px;overflow-y:auto}
  .resp-meta{display:flex;gap:8px;font-size:.75rem;color:var(--text-dim);margin-top:4px}
  .jsonl-section{margin:48px 0}.jsonl-section h2{margin-bottom:16px}.note{color:var(--text-dim);font-size:.85rem;margin-bottom:8px}
  pre.jsonl{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;font-family:var(--mono);font-size:.7rem;overflow-x:auto;max-height:600px;overflow-y:auto;line-height:1.8}
  footer{text-align:center;padding:32px 0;color:var(--text-dim);font-size:.8rem;border-top:1px solid var(--border);margin-top:48px}
  code{background:rgba(88,166,255,.1);padding:1px 6px;border-radius:4px;font-family:var(--mono);font-size:.85em}
  @media(max-width:600px){.stats{grid-template-columns:repeat(2,1fr)}.sample-grid{grid-template-columns:1fr}}
</style>`;

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>vision-benchmark Report</title>${style}</head><body>
${header}
${body}
${footer}
</body></html>`;

  return { html, jsonl: jsonl.join('\n') + '\n' };
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('Loading benchmark results…');
const summaries = loadResults();
console.log(`  ${summaries.length} run files loaded`);

const { html, jsonl } = buildReport(summaries);

mkdirSync(DOCS_DIR, { recursive: true });
writeFileSync(join(DOCS_DIR, 'index.html'), html);
console.log(`  ✓ docs/index.html`);

writeFileSync(join(DOCS_DIR, 'results.jsonl'), jsonl);
console.log(`  ✓ docs/results.jsonl (${jsonl.split('\n').filter(Boolean).length} lines)`);

console.log('\n🌐 Static site ready in docs/ — deploy to GitHub Pages!');
