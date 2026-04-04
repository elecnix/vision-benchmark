#!/usr/bin/env tsx
/** Report generator: loads results + judge cache, writes HTML + JSONL to docs/ */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BenchmarkSummary } from '../src/types.js';

const RESULTS_DIR = join(process.cwd(), 'results');
const JUDGE_DIR = join(RESULTS_DIR, 'judge-cache');
const DOCS_DIR = join(process.cwd(), 'docs');

/* ── helpers ─────────────────────────────────────────────────── */
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function sc(v: number): string { return v >= 0.8 ? 'sg' : v >= 0.5 ? 'sm' : 'sb'; }
function fm(ms: number): string { return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms) + 'ms'; }

/* ── load results ────────────────────────────────────────────── */

interface BenchResult {
  b: string;
  items: Array<{
    mid: string; si: string; qi: string; qt: string;
    score: number; time: number; err?: string;
    resp: string; gt: string; img?: string;
  }>;
}

function loadResults(): BenchResult[] {
  if (!existsSync(RESULTS_DIR)) { console.error('No results/'); process.exit(1); }
  const results: BenchResult[] = [];
  for (const f of readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json') && f !== 'judge-results.json')) {
    try {
      const s: BenchmarkSummary = JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf-8'));
      const b = s.benchmark.replace('-repro', '').replace('-judged:', '').split('-judge')[0];
      results.push({
        b,
        items: s.results.map(r => ({
          mid: r.modelId, si: r.sampleId, qi: r.questionId,
          qt: r.questionId.split('|').pop() || '',
          score: r.score, time: r.totalResponseTimeMs,
          err: r.error, resp: r.modelResponse || '',
          gt: r.groundTruthDescription, img: r.imageDataUrl,
        })),
      });
    } catch { /* skip */ }
  }
  return results;
}

/* ── load judge cache ───────────────────────────────────────── */

/* Cache file naming: {judge}--{bench}--{model}--{batch}.json
   Each file stores an array of {judge, score, reasoning} entries.
   The entries are ordered identically to the responses in the
   corresponding (bench, model) group of results. */

function loadJudgeCache(results: BenchResult[]): {
  data: Array<{ j: string; b: string; mid: string; si: string; qi: string; s: number; r: string }>;
  used: Set<string>;
  avgPer: Record<string, number>;
} {
  if (!existsSync(JUDGE_DIR)) return { data: [], used: new Set(), avgPer: {} };

  // Build ordered lookup for each (bench, mid) combo
  const ordered = new Map<string, Array<{ si: string; qi: string }>>();
  for (const r of results) {
    for (const it of r.items) {
      const k = r.b + '|' + it.mid;
      if (!ordered.has(k)) ordered.set(k, []);
      ordered.get(k)!.push({ si: it.si, qi: it.qi });
    }
  }

  const cursor = new Map<string, number>(); // (judge|bench|mid) → next index
  const all: typeof ordered extends Map<string, infer V> ? Array<{ j: string; b: string; mid: string; si: string; qi: string; s: number; r: string }> : never = [];
  const sums: Record<string, [number, number]> = {};
  const used = new Set<string>();

  for (const fname of readdirSync(JUDGE_DIR)) {
    if (!fname.endsWith('.json')) continue;
    // {judge}--{bench}--{model}--{batch}
    const p = fname.replace('.json', '').split('--');
    if (p.length < 4) continue;
    const jm = p[0].replace(/_free$/, ':free').replace(/_/g, '/');
    const b = p[1].replace(/_/g, '-');
    const mid = p[2].replace(/_/g, '/');
    const ck = jm + '|' + b + '|' + mid;
    let idx = cursor.get(ck) || 0;
    const items = ordered.get(b + '|' + mid) || [];

    try {
      const d: any = JSON.parse(readFileSync(join(JUDGE_DIR, fname), 'utf-8'));
      const entries = Array.isArray(d) ? d : (Object.values(d) as any[]).flat();
      for (const e of entries) {
        if (idx >= items.length) break;
        const it = items[idx++];
        const jFromEntry = e.judge ?? jm; // Prefer judge field from the entry itself
        used.add(jFromEntry);
        all.push({ j: jFromEntry, b, mid, si: it.si, qi: it.qi, s: e.score ?? 0, r: e.reasoning || '' });
        if (!sums[mid]) sums[mid] = [0, 0];
        sums[mid][0] += e.score ?? 0;
        sums[mid][1]++;
      }
    } catch { /* skip bad file */ }
    cursor.set(ck, idx);
  }

  const avgPer: Record<string, number> = {};
  for (const [m, [s, c]] of Object.entries(sums)) avgPer[m] = c > 0 ? s / c : 0;
  return { data: all, used, avgPer };
}

/* ── judge scoring map for the detailed view ────────────────── */

function buildJudgeMap(judgeData: ReturnType<typeof loadJudgeCache>['data']) {
  // key = mid|b|si|qi -> [{j, s, r}, ...]
  const m = new Map<string, Array<{ j: string; s: number; r: string }>>();
  for (const j of judgeData) {
    const k = j.mid + '|' + j.b + '|' + j.si + '|' + j.qi;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(j);
  }
  return m;
}

/* ── build HTML ─────────────────────────────────────────────── */

function buildHtml(results: BenchResult[], jc: ReturnType<typeof loadJudgeCache>): string {
  const all = results.flatMap(r => r.items.map(it => ({ ...it, b: r.b })));
  const mods = [...new Set(all.map(r => r.mid))];
  const hasJ = jc.used.size > 0;
  const jmap = buildJudgeMap(jc.data);

  // Group: bench -> si -> items
  const bm = new Map<string, Map<string, typeof all>>();
  for (const r of all) {
    const k = r.si;
    if (!bm.has(r.b)) bm.set(r.b, new Map());
    if (!bm.get(r.b)!.has(k)) bm.get(r.b)!.set(k, []);
    bm.get(r.b)!.get(k)!.push(r);
  }

  // Rankings (avg across all benches)
  const ranking = mods.map(id => {
    const mr = all.filter(r => r.mid === id);
    return { id, ra: mr.length ? mr.reduce((a, r) => a + r.score, 0) / mr.length : 0, ja: jc.avgPer[id] ?? undefined, at: mr.length ? mr.reduce((a, r) => a + r.time, 0) / mr.length : 0, n: mr.length };
  }).sort((a, b) => ((b.ja ?? b.ra) - (a.ja ?? a.ra)));

  const top3 = new Set(ranking.slice(0, 3).map(m => m.id));
  const benches = Array.from(bm.keys()).sort();

  let h = '';

  // ── Stats ──
  const statsDiv = '<div class="stats">'
    + [
      [mods.length, 'Models'],
      [bm.size, 'Benches'],
      [[...new Set(all.map(r => r.si))].length, 'Questions'],
      [all.length, 'Evals'],
    ].concat(hasJ ? [[jc.used.size, 'Judges']] : [])
    .map(([v, l]: any) => '<div class="stat"><div class="val">' + v + '</div><div class="lbl">' + l + '</div></div>').join('')
    + '</div>';

  // ── Leaderboard ──
  let lb = '<h2>Leaderboard</h2><table class="leaderboard"><thead><tr><th></th><th>Model</th><th>' + (hasJ ? 'Rule / Judge' : 'Score') + '</th><th>ms</th><th>N</th></tr></thead><tbody>';
  for (let i = 0; i < ranking.length; i++) {
    const m = ranking[i];
    const s = m.id.includes('/') ? m.id.split('/').pop()! : m.id;
    const mc = m.id.replace(/[^a-zA-Z0-9]/g, '_');
    lb += '<tr>';
    lb += '<td style="font-weight:700;color:var(--accent)">' + (i === 0 ? '🥇' : i === 1 ? '🥈' : ' ' + (i + 1)) + '</td>';
    lb += '<td><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" ' + (top3.has(m.id) ? 'checked' : '') + ' onclick="t(\'' + mc + '\',this.checked)"> <code>' + esc(s) + '</code></label></td>';
    lb += '<td><span class="badge ' + sc(m.ra) + '">' + m.ra.toFixed(2) + '</span>';
    if (hasJ && m.ja !== undefined) lb += ' <span class="badge ' + sc(m.ja) + '">' + m.ja.toFixed(2) + '</span>';
    lb += '</td><td style="font-family:var(--mono)">' + fm(m.at) + '</td><td>' + m.n + '</td></tr>';
  }
  lb += '</tbody></table>';

  if (hasJ) {
    lb += '<p style="color:var(--text-dim);font-size:.75rem;margin:8px 0 0"><b>Left</b>=rule-based · <b>Right</b>=avg of ' + jc.used.size + ' judges. Hover score → per-judge scores &amp; reasoning.</p>';
  }

  // ── Judge breakdown table ──
  let bt = '';
  if (hasJ) {
    bt = '<h2 style="margin-top:24px">Judged by Benchmark</h2><div style="overflow-x:auto"><table class="leaderboard"><thead><tr><th>Model</th>';
    bt += benches.map(b => '<th>' + esc(b) + '</th>').join('');
    bt += '</tr></thead><tbody>';
    for (const m of ranking) {
      bt += '<tr><td><code>' + esc(m.id.includes('/') ? m.id.split('/').pop()! : m.id) + '</code></td>';
      for (const b of benches) {
        const rs = all.filter(r => r.mid === m.id && r.b === b);
        if (!rs.length) { bt += '<td>—</td>'; continue; }
        const ra = rs.reduce((a, r) => a + r.score, 0) / rs.length;
        const jk = m.id + '|' + b;
        const jscores = jc.data.filter(j => j.mid === m.id && j.b === b);
        const ja = jscores.length ? jscores.reduce((a, j) => a + j.s, 0) / jscores.length : undefined;
        bt += '<td><span class="badge ' + sc(ra) + '">' + ra.toFixed(2) + '</span>';
        if (ja !== undefined) bt += ' <span class="badge ' + sc(ja) + '">' + ja.toFixed(2) + '</span>';
        bt += '</td>';
      }
      bt += '</tr>';
    }
    bt += '</tbody></table></div>';
  }

  // ── Detailed results ──
  let dt = '<h2 style="margin-top:32px">Detailed Results</h2>';
  for (const b of benches) {
    const sMap = bm.get(b)!;
    dt += '<h3 style="color:var(--accent);margin-top:20px">' + esc(b) + '</h3>';
    dt += '<div style="overflow-x:auto"><table class="comparison"><thead><tr><th style="min-width:160px">Ground Truth</th>';
    for (const m of mods) {
      const s = m.includes('/') ? m.split('/').pop()! : m;
      const mc = m.replace(/[^a-zA-Z0-9]/g, '_');
      const hd = top3.has(m) ? '' : ' style="display:none"';
      const mr2 = ranking.find(x => x.id === m);
      const sub = mr2 ? ' <span style="font-size:.65rem;color:var(--text-dim)">' + mr2.ra.toFixed(2) + (hasJ && mr2.ja !== undefined ? '/' + mr2.ja.toFixed(2) : '') + '</span>' : '';
      dt += '<th class="m-' + mc + '"' + hd + '>' + esc(s) + sub + '</th>';
    }
    dt += '</tr></thead><tbody>';

    for (const [sid, items] of sMap) {
      for (const it of items) {
        dt += '<tr>';
        // GT column
        dt += '<td style="vertical-align:top;min-width:160px">';
        if (it.img) dt += '<img src="' + it.img + '" style="max-width:150px;border-radius:6px;margin-bottom:4px;border:1px solid var(--border)" loading="lazy">';
        dt += '<div style="font-size:.7rem;color:var(--text-dim);font-family:var(--mono);word-break:break-all">' + esc((it.gt || '').slice(0, 90)) + '</div></td>';

        for (const m of mods) {
          const mc = m.replace(/[^a-zA-Z0-9]/g, '_');
          const hd = top3.has(m) ? '' : ' style="display:none"';
          dt += '<td class="m-' + mc + '"' + hd + ' style="vertical-align:top;min-width:200px">';
          // Find matching response
          const resp = all.find(r => r.mid === m && r.si === it.si && r.qi === it.qi && r.b === b);
          if (!resp) { dt += '</td>'; continue; }

          const jk = m + '|' + b + '|' + it.si + '|' + it.qi;
          const jscores = jmap.get(jk);

          if (jscores && jscores.length > 0) {
            const avg = jscores.reduce((a, j) => a + j.s, 0) / jscores.length;
            const tip = jscores.map(j => {
              const sh = j.j.includes('/') ? j.j.split('/').pop()! : j.j;
              return '<b>' + esc(sh) + '</b>: ' + j.s.toFixed(2) + (j.r ? ' — ' + esc(j.r.slice(0, 150)) : '');
            }).join('<br>');
            dt += '<span class="st" data-tip="' + esc(tip) + '"><span class="badge ' + sc(avg) + '">' + avg.toFixed(2) + '</span></span> ';
          } else {
            dt += '<span class="badge ' + sc(resp.score) + '">' + resp.score.toFixed(2) + '</span> ';
          }
          dt += '<span style="color:var(--text-dim);font-size:.7rem">' + fm(resp.time) + '</span>';

          if (jscores && jscores[0]?.r) {
            dt += '<div style="font-size:.65rem;color:var(--accent);font-style:italic;margin:2px 0">' + esc(jscores[0].r.slice(0, 120)) + '</div>';
          }
          const t = resp.resp || '(empty)';
          dt += '<div style="font-size:.75rem;color:var(--text-dim);background:rgba(0,0,0,.25);padding:4px 6px;border-radius:4px;max-height:70px;overflow-y:auto;white-space:pre-wrap;word-break:break-word">' + esc(t.slice(0, 200)) + (t.length > 200 ? '…' : '') + '</div>';
          if (resp.err) dt += '<div style="color:var(--red);font-size:.65rem">⚠️ ' + esc((resp.err || '').slice(0, 60)) + '</div>';
          dt += '</td>';
        }
        dt += '</tr>';
      }
    }
    dt += '</tbody></table></div>';
  }

  // ── Artifacts ──
  dt += '<h2 style="margin-top:40px">Artifacts</h2>';
  dt += '<div style="display:flex;gap:16px;flex-wrap:wrap;margin:8px 0">';
  dt += '<a href="results.jsonl" download class="al">📄 results.jsonl</a>';
  dt += '<a href="judge-details.jsonl" download class="al">📄 judge-details.jsonl</a>';
  dt += '</div>';

  const footer = hasJ ? ' | Judges: ' + [...jc.used].sort().map((j: string) => '<code>' + esc(j.includes('/') ? j.split('/').pop()! : j) + '</code>').join(' • ') : '';

  // ── Compose final HTML ──
  const style = [
    ':root{--bg:#06090f;--surface:#0d1117;--border:#21262d;--text:#e6edf3;--text-dim:#8b949e;--accent:#58a6ff;--green:#3fb950;--yellow:#d29922;--red:#f85149;--mono:"SF Mono","Fira Code",monospace;--sans:system-ui,sans-serif}',
    '*{margin:0;padding:0;box-sizing:border-box}body{font-family:var(--sans);background:var(--bg);color:var(--text);line-height:1.5}',
    'a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}',
    '.wrap{max-width:1600px;margin:0 auto;padding:0 24px}',
    '.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:20px 0}',
    '.stat{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center}',
    '.stat .val{font-size:1.6rem;font-weight:700}.stat .lbl{font-size:.7rem;color:var(--text-dim);text-transform:uppercase}',
    'h2{margin:24px 0 12px;color:var(--accent)}h3{margin:20px 0 8px}',
    'table.leaderboard{width:100%;border-collapse:collapse;margin:8px 0}',
    'table.leaderboard th{text-align:left;font-size:.7rem;color:var(--text-dim);text-transform:uppercase;padding:6px 10px;border-bottom:1px solid var(--border)}',
    'table.leaderboard td{padding:6px 10px;border-bottom:1px solid var(--border);font-size:.85rem}',
    '.badge{display:inline-block;font-family:var(--mono);font-weight:700;font-size:.75rem;padding:2px 6px;border-radius:4px}',
    '.sg{background:rgba(63,185,80,.15);color:var(--green)}.sm{background:rgba(210,153,34,.15);color:var(--yellow)}.sb{background:rgba(248,81,73,.15);color:var(--red)}',
    '.comparison{width:100%;border-collapse:separate;border-spacing:0}',
    '.comparison th{position:sticky;top:0;background:var(--surface);padding:8px 10px;font-size:.8rem;border-bottom:2px solid var(--border);z-index:5;min-width:150px}',
    '.comparison td{padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top;font-size:.8rem;min-width:180px}',
    'label{cursor:pointer}input[type="checkbox"]{accent-color:var(--accent);cursor:pointer}',
    'code{background:rgba(88,166,255,.1);padding:1px 5px;border-radius:3px;font-family:var(--mono);font-size:.85em}',
    '.al{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--accent);font-family:var(--mono);font-size:.8rem}.al:hover{background:rgba(88,166,255,.08)}',
    '.st{position:relative;cursor:help;border-bottom:1px dotted var(--text-dim)}',
    '.st::after{content:attr(data-tip);display:none;position:absolute;bottom:100%;left:0;background:#161b22;border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:.7rem;color:var(--text-dim);white-space:pre-wrap;max-width:500px;overflow:hidden;text-overflow:ellipsis;z-index:100;font-family:var(--mono);line-height:1.5;box-shadow:0 4px 16px rgba(0,0,0,.6)}',
    '.st:hover::after{display:block}',
    '.st-footer{margin-top:32px;padding:16px 0;color:var(--text-dim);font-size:.75rem;border-top:1px solid var(--border)}',
    '.st-footer code{margin-right:4px}',
    'footer{text-align:center;padding:24px 0;color:var(--text-dim);font-size:.7rem;border-top:1px solid var(--border);margin-top:60px}',
    '@media(max-width:600px){.stats{grid-template-columns:repeat(3,1fr)}}',
  ].join('');

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>vision-benchmark</title><style>' + style + '</style></head><body><div class="wrap"><main>'
    + statsDiv + lb + bt + dt
    + '</main><div class="st-footer">vision-benchmark | ' + new Date().toISOString().slice(0, 10) + footer + '</div>'
    + '<script>function t(mc,s){document.querySelectorAll(".m-"+mc).forEach(function(el){el.style.display=s?"":"none"})}<\/script>'
    + '</div></body></html>';
}

/* ── main ───────────────────────────────────────────────────── */

console.log('Loading benchmark results…');
const results = loadResults();
console.log('  ' + results.length + ' runs, ' + results.reduce((n, s) => n + s.items.length, 0) + ' evals');

console.log('Loading judge cache…');
const jc = loadJudgeCache(results);
console.log('  ' + jc.data.length + ' judge scores from ' + jc.used.size + ' judges');

const html = buildHtml(results, jc);
mkdirSync(DOCS_DIR, { recursive: true });
writeFileSync(join(DOCS_DIR, 'index.html'), html);
console.log('✓ docs/index.html (' + (html.length / 1024).toFixed(0) + 'KB)');

// results.jsonl
const allFlat = results.flatMap(r => r.items.map(it => ({ bench: r.b, model: it.mid, score: it.score, timeMs: it.time, error: it.err || null, response: (it.resp || '').slice(0, 300), gt: it.gt })));
writeFileSync(join(DOCS_DIR, 'results.jsonl'), allFlat.map(r => JSON.stringify(r)).join('\n') + '\n');

// judge-details.jsonl
writeFileSync(join(DOCS_DIR, 'judge-details.jsonl'), jc.data.map(j => JSON.stringify({ judge: j.j, benchmark: j.b, model: j.mid, sample: j.si, question: j.qi, score: j.s, reasoning: j.r })).join('\n') + '\n');
console.log('✓ docs/results.jsonl, docs/judge-details.jsonl');
console.log('\n🌐 Static site ready in docs/ — deploy to GitHub Pages!');
