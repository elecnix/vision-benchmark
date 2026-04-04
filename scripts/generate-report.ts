/**
 * Report generator — reads all results, produces self-contained HTML + JSONL.
 * The report includes:
 *   - Leaderboard (all benchmarks including code-repro)
 *   - Per-sample details with the original/reproduced side-by-side images
 *   - Pixel-level scoring metrics (precision, recall, F1)
 *   - Full JSONL session log
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BenchmarkSummary, EvalResult } from '../types.js';

const RESULTS_DIR = join(process.cwd(), 'results');
const DOCS_DIR = join(process.cwd(), 'docs');

function loadResults(): BenchmarkSummary[] {
  if (!existsSync(RESULTS_DIR)) { console.error('No results/'); process.exit(1); }
  return readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'))
    .sort().map(f => JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf-8')));
}

function esc(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function scoreClass(v: number) { return v >= 0.8 ? 'score-good' : v >= 0.5 ? 'score-mid' : 'score-bad'; }
function fmtMs(ms: number) { return ms >= 1000 ? (ms/1000).toFixed(1)+'s' : Math.round(ms)+'ms'; }

/** Build HTML */
function buildHtml(summaries: BenchmarkSummary[]) {
  const allResults = summaries.flatMap(s => s.results.map(r => ({ ...r, benchmark: s.benchmark })));
  const modelSet = new Set(allResults.map(r => r.modelId));
  const benchSet = new Set(allResults.map(r => r.benchmark));

  // Per-model per-benchmark scores
  const benchScores: Record<string, Record<string, number[]>> = {};
  for (const r of allResults) {
    if (!benchScores[r.benchmark]) benchScores[r.benchmark] = {};
    if (!benchScores[r.benchmark][r.modelId]) benchScores[r.benchmark][r.modelId] = [];
    benchScores[r.benchmark][r.modelId].push(r.score);
  }

  // Overall model ranking by avg across all benchmarks
  const modelRanking = Array.from(modelSet).map(id => {
    const mr = allResults.filter(r => r.modelId === id);
    const avgScore = mr.reduce((s, r) => s + r.score, 0) / mr.length;
    const avgTime = mr.reduce((s, r) => s + r.totalResponseTimeMs, 0) / mr.length;
    return { id, avgScore, avgTime, count: mr.length };
  }).sort((a, b) => b.avgScore - a.avgScore);

  // Group results: for non-repro → group by (benchmark, sampleId, questionId)
  // for repro → each sample has its own row with side-by-side image
  interface SampleGroup {
    benchmark: string;
    sampleId: string;
    questionType: string;
    gtDescription: string;
    imageDataUrl?: string;
    responses: EvalResult[];
  }
  const groupMap = new Map<string, SampleGroup>();
  for (const r of allResults) {
    const qType = r.questionId.split('|').pop() || '';
    const isRepro = r.benchmark === 'code-repro';
    const key = isRepro ? `repro|${r.sampleId}` : `${r.benchmark}|${r.sampleId}|${r.questionId}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        benchmark: r.benchmark, sampleId: r.sampleId, questionType: qType,
        gtDescription: r.groundTruthDescription, imageDataUrl: r.imageDataUrl, responses: [],
      });
    }
    groupMap.get(key)!.responses.push(r);
  }

  // ── HTML ──
  let html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>vision-benchmark Report</title><style>
:root{--bg:#0d1117;--surface:#161b22;--border:#30363d;--text:#e6edf3;--text-dim:#8b949e;--accent:#58a6ff;
  --green:#3fb950;--yellow:#d29922;--red:#f85149;--mono:'SF Mono',monospace;--sans:system-ui,sans-serif}
*{margin:0;padding:0;box-sizing:border-box}body{font-family:var(--sans);background:var(--bg);color:var(--text);line-height:1.6}
a{color:var(--accent);text-decoration:none}.wrap{max-width:1200px;margin:0 auto;padding:0 24px}
header{border-bottom:1px solid var(--border);padding:24px 0}header p{color:var(--text-dim);font-size:.9rem;margin-top:4px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:24px 0}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;text-align:center}
.stat .val{font-size:2rem;font-weight:700}.stat .lbl{font-size:.75rem;color:var(--text-dim);text-transform:uppercase}
table.leaderboard{width:100%;border-collapse:collapse;margin:24px 0}
table.leaderboard th{text-align:left;font-size:.75rem;color:var(--text-dim);text-transform:uppercase;padding:8px 12px;border-bottom:1px solid var(--border)}
table.leaderboard td{padding:10px 12px;border-bottom:1px solid var(--border);font-size:.9rem}
.badge{display:inline-block;font-family:var(--mono);font-weight:700;font-size:.85rem;padding:2px 8px;border-radius:4px}
.score-good{background:rgba(63,185,80,.15);color:var(--green)}.score-mid{background:rgba(210,153,34,.15);color:var(--yellow)}.score-bad{background:rgba(248,81,73,.15);color:var(--red)}
.sample-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));gap:20px}
.sample-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden}
.sample-img{background:repeating-conic-gradient(var(--bg) 0% 25%,transparent 0% 50%) 0 0/16px 16px;text-align:center;padding:12px}
.sample-img img{max-width:100%;max-height:200px;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.4)}
.gt-info{padding:8px 14px;color:var(--text-dim);font-family:var(--mono);font-size:.75rem;border-bottom:1px solid var(--border);word-break:break-word}
.resp{border-top:1px solid var(--border);padding:8px 14px}
.resp-q{font-size:.75rem;color:var(--accent);font-family:var(--mono);margin-bottom:2px}
.resp-a{font-size:.85rem;color:var(--text-dim);background:rgba(0,0,0,.25);padding:8px 10px;border-radius:4px;margin:4px 0;max-height:100px;overflow-y:auto;white-space:pre-wrap}
.resp-meta{display:flex;gap:8px;font-size:.75rem;color:var(--text-dim);margin-top:4px}
.section{margin:32px 0}.section h2{margin-bottom:16px;color:var(--accent)}
.section h3{margin:24px 0 8px;color:var(--text);opacity:.8}
pre.jsonl{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;font-family:var(--mono);font-size:.7rem;overflow-x:auto;max-height:500px;overflow-y:auto}
footer{text-align:center;padding:32px 0;color:var(--text-dim);font-size:.8rem;border-top:1px solid var(--border);margin-top:48px}
code{background:rgba(88,166,255,.1);padding:1px 6px;border-radius:4px;font-family:var(--mono);font-size:.85em}
.side-label{font-size:.7rem;color:var(--text-dim);text-transform:uppercase;font-family:var(--mono);letter-spacing:.5px}
.side-label-right{text-align:right}
img.repro{border:1px solid var(--border)}
@media(max-width:600px){.stats{grid-template-columns:repeat(2,1fr)}.sample-grid{grid-template-columns:1fr}}
</style></head><body><header><div class="wrap">
<h1>🔬 vision-benchmark</h1>
<p>Deterministic synthetic benchmarks — ${new Date().toISOString().slice(0,10)}</p>
</div></header><main class="wrap">`;

  // Stats
  html += `<div class="stats">
    <div class="stat"><div class="val">${modelSet.size}</div><div class="lbl">Models</div></div>
    <div class="stat"><div class="val">${benchSet.size}</div><div class="lbl">Benchmarks</div></div>
    <div class="stat"><div class="val">${groupMap.size}</div><div class="lbl">Samples</div></div>
    <div class="stat"><div class="val">${allResults.length}</div><div class="lbl">Evaluations</div></div>
  </div>`;

  // Leaderboard
  html += '<h2>Leaderboard</h2><table class="leaderboard"><thead><tr><th></th><th>Model</th><th>Avg F1</th><th>Avg ms</th><th>N</th></tr></thead><tbody>\n';
  for (let i = 0; i < modelRanking.length; i++) {
    const m = modelRanking[i];
    html += `<tr><td style="font-weight:700;color:var(--accent)">${i===0?'🥇':i===1?'🥈':i+1}</td>`;
    html += `<td><code>${esc(m.id.includes('/')?m.id.split('/').pop()!:m.id)}</code></td>`;
    html += `<td><span class="badge ${scoreClass(m.avgScore)}">${m.avgScore.toFixed(3)}</span></td>`;
    html += `<td style="font-family:var(--mono)">${fmtMs(m.avgTime)}</td><td>${m.count}</td></tr>\n`;
    for (const bench of Array.from(benchSet).sort()) {
      if (benchScores[bench]?.[m.id]) {
        const avg = benchScores[bench][m.id].reduce((a,b)=>a+b,0)/benchScores[bench][m.id].length;
        html += `<tr style="font-size:.85rem;color:var(--text-dim)"><td></td><td style="padding-left:28px">↳ ${bench}</td>`;
        html += `<td><span class="badge ${scoreClass(avg)}">${avg.toFixed(3)}</span></td><td></td><td></td></tr>\n`;
      }
    }
  }
  html += '</tbody></table>';

  // Detailed samples
  html += '<div class="section"><h2>Detailed Results</h2>';
  const benchMap = new Map<string, SampleGroup[]>();
  for (const g of groupMap.values()) { if (!benchMap.has(g.benchmark)) benchMap.set(g.benchmark, []); benchMap.get(g.benchmark)!.push(g); }

  for (const [bench, groups] of benchMap) {
    html += `<h3>${bench}</h3><div class="sample-grid">`;
    for (const g of groups) {
      html += '<div class="sample-card">';

      // Side-by-side image (repro benchmark has them; others have originals)
      if (g.imageDataUrl) {
        const w = bench === 'code-repro';
        html += `<div class="sample-img"><img src="${g.imageDataUrl}" alt="${esc(g.sampleId)}" loading="lazy"></div>`;
        if (w) html += `<div style="display:flex;justify-content:space-between;padding:0 14px 4px"><span class="side-label">Original</span><span class="side-label side-label-right">Reproduced</span></div>`;
      } else {
        html += `<div class="sample-img" style="padding:32px;color:var(--text-dim)">${esc(g.gtDescription.slice(0,80))}</div>`;
      }

      html += `<div class="gt-info">${esc(g.gtDescription.slice(0,120))}</div>`;

      for (const r of g.responses) {
        const short = r.modelId.includes('/') ? r.modelId.split('/').pop()! : r.modelId;
        html += `<div class="resp"><div class="resp-q">${esc(short)}</div>`;
        const dims = r.dimensionScores;
        if (dims) {
          html += '<div style="font-size:.7rem;color:var(--text-dim);font-family:var(--mono);margin:2px 0">';
          if (dims.precision !== undefined) html += `p=${dims.precision.toFixed(2)} r=${dims.recall.toFixed(2)} f1=${dims.f1.toFixed(2)}`;
          else if (dims.count !== undefined) html += `count=${dims.count}`;
          else if (dims.angle !== undefined) html += `angle=${dims.angle}`;
          if (dims.ocr_accuracy !== undefined) html += ` | ocr=${dims.ocr_accuracy.toFixed(2)} exact=${dims.ocr_exact===1?'✓':'✗'}`;
          html += '</div>';
        }
        html += `<div class="resp-a">${esc(r.modelResponse || '(empty)')}</div>`;
        html += `<div class="resp-meta"><span class="badge ${scoreClass(r.score)}">${r.score.toFixed(2)}</span><span>${fmtMs(r.totalResponseTimeMs)}</span>${r.error?'<span class="badge score-bad">err</span>':''}</div>`;
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
  }
  html += '</div>';

  // JSONL log
  const jsonl = allResults.map(r => JSON.stringify({bench:r.benchmark,model:r.modelId,score:r.score,time:r.totalResponseTimeMs,error:r.error,resp:(r.modelResponse||'').slice(0,300),gt:r.groundTruthDescription}));
  html += `<div class="section"><h2>Session Log (JSONL)</h2><p style="color:var(--text-dim);font-size:.85rem;margin-bottom:8px"><a href="results.jsonl" download>Download results.jsonl</a> (${jsonl.length} lines)</p><pre class="jsonl">${jsonl.map(l=>esc(l)).join('\n')}</pre></div>`;

  html += `</main><footer><div class="wrap">Generated by <a href="https://github.com/nicolas/vision-benchmark">vision-benchmark</a></div></footer></body></html>`;
  return { html, jsonl: jsonl.join('\n')+'\n' };
}

// ── Main ──
console.log('Loading results…');
const summaries = loadResults();
console.log(`  ${summaries.length} run files, ${summaries.reduce((n,s)=>n+s.results.length,0)} evals`);

const { html, jsonl } = buildHtml(summaries);
mkdirSync(DOCS_DIR, { recursive: true });
writeFileSync(join(DOCS_DIR, 'index.html'), html);
writeFileSync(join(DOCS_DIR, 'results.jsonl'), jsonl);
console.log(`✓ docs/index.html, docs/results.jsonl (${jsonl.split('\n').filter(Boolean).length} lines)`);
