/**
 * Report generator — column-based model comparison layout.
 *
 * Each sample row shows:
 *   [Ground Truth] | [Model A] | [Model B] | [Model C] | ...
 *
 * Leaderboard has checkboxes to toggle model columns.
 * Defaults to top 3 models visible.
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

function buildHtml(summaries: BenchmarkSummary[]) {
  const allResults = summaries.flatMap(s => s.results.map(r => ({ ...r, benchmark: s.benchmark })));
  const modelSet = new Set(allResults.map(r => r.modelId));
  const benchSet = new Set(allResults.map(r => r.benchmark));
  const sortedModels = Array.from(modelSet).sort((a, b) => a.localeCompare(b));

  // Per-model overall average score
  const modelAvg = new Map<string, number>();
  for (const m of sortedModels) {
    const mr = allResults.filter(r => r.modelId === m);
    modelAvg.set(m, mr.reduce((s, r) => s + r.score, 0) / mr.length);
  }
  // Top 3 by avg score
  const top3 = sortedModels.slice().sort((a, b) => (modelAvg.get(b) ?? 0) - (modelAvg.get(a) ?? 0)).slice(0, 3);

  // Per-model per-benchmark scores
  const benchScores: Record<string, Record<string, number[]>> = {};
  for (const r of allResults) {
    if (!benchScores[r.benchmark]) benchScores[r.benchmark] = {};
    if (!benchScores[r.benchmark][r.modelId]) benchScores[r.benchmark][r.modelId] = [];
    benchScores[r.benchmark][r.modelId].push(r.score);
  }

  // Group results by (benchmark, sampleId) so each row shows all models for one sample
  interface RowData {
    benchmark: string;
    key: string;
    gtDescription: string;
    gtImageBase64?: string;   // Original image (before repro)
    models: Record<string, {
      response: string;
      score: number;
      imageDataUrl?: string;  // Side-by-side or original
      dimensionScores?: Record<string, number>;
      timeMs?: number;
      error?: string;
      questionType: string;
    }>;
  }
  const rowMap = new Map<string, RowData>();

  for (const r of allResults) {
    const qType = r.questionId.split('|').pop() || '';
    const isRepro = r.benchmark === 'code-repro';
    const isText = ['describe','angle','length','count','colors','transcribe','positions'].includes(qType);
    const isReproQ = qType === 'repro';

    // For repro: key by sampleId; for text benchmarks: key by sampleId+questionId
    // so each sample appears once per question type
    let key: string;
    if (isRepro) {
      // Only show repro question, not the original benchmark text questions
      if (!isReproQ) continue;
      key = `repro|${r.sampleId}`;
    } else {
      key = `${r.benchmark}|${r.sampleId}|${r.questionId}`;
    }

    if (!rowMap.has(key)) {
      rowMap.set(key, {
        benchmark: r.benchmark,
        key,
        gtDescription: r.groundTruthDescription,
        gtImageBase64: undefined,
        models: {},
      });
    }
    const row = rowMap.get(key)!;

    // Extract the original image for the ground truth column
    // For repro benchmarks, the imageDataUrl is side-by-side; we need just the left half
    // For text benchmarks, the imageDataUrl IS the original image
    if (isText && r.imageDataUrl && !row.gtImageBase64) {
      row.gtImageBase64 = r.imageDataUrl;
    }

    const modelEntry = {
      response: r.modelResponse,
      score: r.score,
      imageDataUrl: isRepro ? r.imageDataUrl : undefined,
      dimensionScores: r.dimensionScores,
      timeMs: r.totalResponseTimeMs,
      error: r.error,
      questionType: qType,
    };

    // Merge models: if same model already has a result for this key, don't overwrite
    if (!row.models[r.modelId]) {
      row.models[r.modelId] = modelEntry;
    } else if (isRepro) {
      // Repro should replace the text result for the same model
      row.models[r.modelId] = modelEntry;
    }

    // For non-repro, attach the original image to the ground truth column
    if (isText && r.imageDataUrl && !row.gtImageBase64) {
      row.gtImageBase64 = r.imageDataUrl;
    }
  }

  // ── Build HTML ──
  let html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>vision-benchmark Report</title><style>
:root{--bg:#0d1117;--surface:#161b22;--border:#30363d;--text:#e6edf3;--text-dim:#8b949e;--accent:#58a6ff;
  --green:#3fb950;--yellow:#d29922;--red:#f85149;--mono:'SF Mono','Fira Code',monospace;--sans:system-ui,sans-serif}
*{margin:0;padding:0;box-sizing:border-box}body{font-family:var(--sans);background:var(--bg);color:var(--text);line-height:1.5}
a{color:var(--accent);text-decoration:none}.wrap{max-width:1600px;margin:0 auto;padding:0 24px}
header{border-bottom:1px solid var(--border);padding:20px 0}header p{color:var(--text-dim);font-size:.85rem;margin-top:4px}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:20px 0}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center}
.stat .val{font-size:1.6rem;font-weight:700}.stat .lbl{font-size:.7rem;color:var(--text-dim);text-transform:uppercase}
h2{margin:24px 0 12px;color:var(--accent)}
/* Leaderboard */
table.lb{width:100%;border-collapse:collapse;margin:16px 0}
table.lb th{text-align:left;font-size:.7rem;color:var(--text-dim);text-transform:uppercase;padding:8px 12px;border-bottom:1px solid var(--border)}
table.lb td{padding:8px 12px;border-bottom:1px solid var(--border);font-size:.85rem}
.badge{display:inline-block;font-family:var(--mono);font-weight:700;font-size:.8rem;padding:2px 8px;border-radius:4px}
.score-good{background:rgba(63,185,80,.15);color:var(--green)}.score-mid{background:rgba(210,153,34,.15);color:var(--yellow)}.score-bad{background:rgba(248,81,73,.15);color:var(--red)}
/* Model column toggle */
.model-toggle{display:flex;gap:16px;flex-wrap:wrap;margin:12px 0 8px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px}
.model-toggle label{display:flex;align-items:center;gap:6px;font-size:.8rem;cursor:pointer;user-select:none}
.model-toggle input{accent-color:var(--accent)}
/* Comparison table */
.comparison{width:100%;border-collapse:separate;border-spacing:0;margin-top:16px}
.comparison th{background:var(--surface);padding:8px 10px;font-size:.7rem;text-transform:uppercase;color:var(--text-dim);border-bottom:2px solid var(--border);position:sticky;top:0;z-index:10;
  min-width:220px;vertical-align:top}
.comparison th.gt-col{min-width:160px;width:160px}
.comparison td{padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top;min-width:220px}
.comparison tr.bench-header td{background:var(--surface);font-weight:600;color:var(--accent);font-size:.85rem;
  border-bottom:2px solid var(--accent);padding:6px 10px}
.gt-desc{font-family:var(--mono);font-size:.7rem;color:var(--text-dim);padding:6px;background:rgba(88,166,255,.05);border-radius:4px;margin-bottom:6px;word-break:break-word}
.gt-img{max-width:160px;max-height:160px;border-radius:4px;border:1px solid var(--border)}
.model-score{text-align:center;font-family:var(--mono);font-size:.8rem;margin-bottom:4px}
.model-dims{font-size:.65rem;color:var(--text-dim);font-family:var(--mono);margin-bottom:4px}
.model-code{font-size:.75rem;color:var(--text-dim);background:rgba(0,0,0,.3);padding:6px 8px;border-radius:4px;
  max-height:80px;overflow-y:auto;white-space:pre-wrap;word-break:break-word}
.model-img{max-width:100%;max-height:120px;border-radius:4px;border:1px solid var(--border);display:block;margin-top:6px}
.side-label{display:flex;justify-content:space-between;font-size:.6rem;color:var(--text-dim);font-family:var(--mono);margin-top:2px}
.hidden-col{display:none}
code{background:rgba(88,166,255,.1);padding:1px 4px;border-radius:3px;font-family:var(--mono);font-size:.8em}
pre.jsonl{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;font-family:var(--mono);font-size:.65rem;overflow-x:auto;max-height:400px;overflow-y:auto}
section{margin:32px 0}
footer{text-align:center;padding:24px 0;color:var(--text-dim);font-size:.75rem;border-top:1px solid var(--border);margin-top:40px}
@media(max-width:800px){.stats{grid-template-columns:repeat(3,1fr)}.comparison{display:block}.comparison th,.comparison td{display:block;width:100%;min-width:unset}}
</style></head><body>
<div class="wrap">
<header><h1>🔬 vision-benchmark</h1><p>Deterministic synthetic benchmarks — ${new Date().toISOString().slice(0,10)}</p></header>`;

  // Stats
  html += `<div class="stats">
    <div class="stat"><div class="val">${modelSet.size}</div><div class="lbl">Models</div></div>
    <div class="stat"><div class="val">${benchSet.size}</div><div class="lbl">Benches</div></div>
    <div class="stat"><div class="val">${rowMap.size}</div><div class="lbl">Samples</div></div>
    <div class="stat"><div class="val">${allResults.length}</div><div class="lbl">Evals</div></div>
  </div>`;

  // Leaderboard
  const ranked = Array.from(modelSet).map(id => {
    const mr = allResults.filter(r => r.modelId === id);
    return { id, avg: mr.reduce((s,r)=>s+r.score,0)/mr.length, time: mr.reduce((s,r)=>s+r.totalResponseTimeMs,0)/mr.length, n: mr.length };
  }).sort((a,b)=>b.avg-a.avg);

  html += '<h2>Leaderboard</h2>';
  html += '<div class="model-toggle" id="modelToggle">';
  for (const m of sortedModels) {
    const short = m.includes('/') ? m.split('/').pop()! : m;
    const checked = top3.includes(m) ? 'checked' : '';
    const avg = (modelAvg.get(m) ?? 0).toFixed(3);
    html += `<label><input type="checkbox" ${checked} data-model="${esc(m)}" onchange="toggleCol(this)"> ${esc(short)} <span class="badge ${scoreClass(+avg)}">${avg}</span></label>`;
  }
  html += '</div>';

  html += '<table class="lb"><thead><tr><th></th><th>Model</th><th>Avg</th><th>';
  for (const b of Array.from(benchSet).sort()) html += `${esc(b)}`;
  html += '</th><th>ms</th><th>N</th></tr></thead><tbody>';
  for (let i = 0; i < ranked.length; i++) {
    const m = ranked[i];
    const short = m.id.includes('/') ? m.id.split('/').pop()! : m.id;
    html += `<tr><td style="font-weight:700;color:var(--accent)">${i===0?'🥇':i===1?'🥈':' '+(i+1)}</td>`;
    html += `<td><code>${esc(short)}</code></td><td><span class="badge ${scoreClass(m.avg)}">${m.avg.toFixed(3)}</span></td><td>`;
    for (const b of Array.from(benchSet).sort()) {
      if (benchScores[b]?.[m.id]) {
        const a = benchScores[b][m.id].reduce((s,v)=>s+v,0)/benchScores[b][m.id].length;
        html += `<span class="badge ${scoreClass(a)}" style="margin:2px">${b}:${a.toFixed(2)}</span>`;
      }
    }
    html += `</td><td style="font-family:var(--mono)">${fmtMs(m.time)}</td><td>${m.n}</td></tr>`;
  }
  html += '</tbody></table>';

  // ── Comparison table ──
  html += '<h2>Detailed Results</h2>';
  html += '<div style="overflow-x:auto">';
  html += '<table class="comparison" id="cmpTable">';

  // Header row
  html += '<thead><tr><th class="gt-col">Ground Truth</th>';
  for (const m of sortedModels) {
    const short = m.includes('/') ? m.split('/').pop()! : m;
    const checked = top3.includes(m) ? '' : ' class="hidden-col"';
    html += `<th data-model="${esc(m)}"${checked}>${esc(short)}<br><span style="font-size:.65rem;opacity:.6">${(modelAvg.get(m) ?? 0).toFixed(3)}</span></th>`;
  }
  html += '</tr></thead><tbody>';

  // Group by benchmark
  const benchMap = new Map<string, RowData[]>();
  for (const r of rowMap.values()) { if (!benchMap.has(r.benchmark)) benchMap.set(r.benchmark, []); benchMap.get(r.benchmark)!.push(r); }

  for (const [bench, rows] of benchMap) {
    // Bench header row
    html += `<tr class="bench-header"><td colspan="${1+sortedModels.length}">${esc(bench)} <span style="opacity:.6">(${rows.length} samples)</span></td></tr>`;

    for (const row of rows) {
      html += '<tr>';
      // Ground truth column
      html += '<td class="gt-col">';
      if (row.gtImageBase64) {
        html += `<img class="gt-img" src="${row.gtImageBase64}" loading="lazy" alt="GT">`;
      }
      html += `<div class="gt-desc">${esc(row.gtDescription.slice(0,120))}</div>`;
      html += '</td>';
      // Model columns
      for (const m of sortedModels) {
        const entry = row.models[m];
        const hidden = top3.includes(m) ? '' : ' class="hidden-col"';
        html += `<td data-model="${esc(m)}"${hidden}>`;
        if (entry) {
          html += `<div class="model-score"><span class="badge ${scoreClass(entry.score)}">${entry.score.toFixed(2)}</span> ${entry.timeMs ? fmtMs(entry.timeMs) : ''}</div>`;
          if (entry.dimensionScores) {
            const ds = entry.dimensionScores;
            let dimText = '';
            if (ds.pixel_precision !== undefined) dimText = `p=${ds.pixel_precision.toFixed(2)} r=${ds.recall?.toFixed(2) ?? '?'} f1=${ds.f1?.toFixed(2) ?? '?'}`;
            else if (ds.count !== undefined) dimText = `count=${ds.count}`;
            else if (ds.angle !== undefined) dimText = `angle=${ds.angle}`;
            else if (ds.ocr_accuracy !== undefined) dimText = `ocr=${ds.ocr_accuracy.toFixed(2)} exact=${ds.ocr_exact?'✓':'✗'}`;
            if (dimText) html += `<div class="model-dims">${esc(dimText)}</div>`;
          }
          if (entry.imageDataUrl) {
            html += `<img class="model-img" src="${entry.imageDataUrl}" loading="lazy" alt="repro">`;
            if (bench === 'code-repro') html += `<div class="side-label"><span>original</span><span>reproduced</span></div>`;
          }
          if (entry.response) html += `<div class="model-code">${esc(entry.response.slice(0,200))}${entry.response.length > 200 ? '…' : ''}</div>`;
          if (entry.error) html += `<div class="model-dims" style="color:var(--red)">⚠️ ${esc(entry.error?.slice(0,60) ?? '')}</div>`;
        }
        html += '</td>';
      }
      html += '</tr>';
    }
  }

  html += '</tbody></table></div>';

  // JSONL
  const jsonl = allResults.map(r => JSON.stringify({bench:r.benchmark,model:r.modelId,score:r.score,time:r.totalResponseTimeMs,error:r.error,resp:(r.modelResponse||'').slice(0,300),gt:r.groundTruthDescription}));
  html += `<section><h2>Session Log (JSONL)</h2><p style="color:var(--text-dim);font-size:.8rem;margin-bottom:8px"><a href="results.jsonl" download>results.jsonl</a> (${jsonl.length} lines)</p><pre class="jsonl">${jsonl.map(l=>esc(l)).join('\\n')}</pre></section>`;

  html += '</div>';
  html += `<footer>Generated by <a href="https://github.com/nicolas/vision-benchmark">vision-benchmark</a></footer>`;

  // ── JS for toggle ──
  html += `<script>
function toggleCol(cb) {
  const m = cb.dataset.model;
  const vis = cb.checked;
  document.querySelectorAll('th[data-model="'+m+'"], td[data-model="'+m+'"]').forEach(el => {
    if (vis) el.classList.remove('hidden-col'); else el.classList.add('hidden-col');
  });
}
</script></body></html>`;

  return { html, jsonl: jsonl.join('\n')+'\n' };
}

console.log('Loading results…');
const summaries = loadResults();
console.log(`  ${summaries.length} runs, ${summaries.reduce((n,s) => n + s.results.length, 0)} evals`);
const { html, jsonl } = buildHtml(summaries);
mkdirSync(DOCS_DIR, { recursive: true });
writeFileSync(join(DOCS_DIR, 'index.html'), html);
writeFileSync(join(DOCS_DIR, 'results.jsonl'), jsonl);
console.log(`✓ docs/index.html, docs/results.jsonl (${jsonl.split('\\n').filter(Boolean).length} lines)`);
