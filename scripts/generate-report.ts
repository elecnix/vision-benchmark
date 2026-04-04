#!/usr/bin/env tsx
/** Report generator — benchmark results + multi-judge → HTML + JSONL */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BenchmarkSummary } from '../src/types.js';

const RESULTS_DIR = join(process.cwd(), 'results');
const JUDGE_DIR = join(RESULTS_DIR, 'judge-cache');
const DOCS_DIR = join(process.cwd(), 'docs');
const MAX_BAR = 200;

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function sc(v: number): string { return v >= 0.8 ? 'sg' : v >= 0.5 ? 'sm' : 'sb'; }
function fm(ms: number): string { return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms) + 'ms'; }
function bar(v: number): string {
  const w = Math.round(v * MAX_BAR);
  const c = v >= 0.8 ? 'var(--green)' : v >= 0.5 ? 'var(--yellow)' : 'var(--red)';
  return '<div class="brow"><div class="btrack"><div class="bfill" style="width:' + w + 'px;background:' + c + '"></div></div><span class="blbl">' + v.toFixed(2) + '</span></div>';
}

/* ── load benchmark results ─────────────────────────────────── */
interface BR { b: string; items: Array<{ mid: string; si: string; qi: string; score: number; time: number; err?: string; resp: string; gt: string; img?: string }>; }

function loadResults(): BR[] {
  if (!existsSync(RESULTS_DIR)) { console.error('No results/'); process.exit(1); }
  return readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json') && !f.startsWith('judge'))
    .map(f => {
      try {
        const s: BenchmarkSummary = JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf-8'));
        const b = s.benchmark.replace(/-repro$/, '').replace(/-judged:.*$/, '').split('-judge')[0];
        return { b, items: s.results.map(r => ({ mid: r.modelId, si: r.sampleId, qi: r.questionId, score: r.score, time: r.totalResponseTimeMs, err: r.error, resp: r.modelResponse || '', gt: r.groundTruthDescription, img: r.imageDataUrl })) };
      } catch { return null; }
    }).filter(Boolean) as BR[];
}

/* ── load judge cache ───────────────────────────────────────── */
interface JI { j: string; b: string; mid: string; si: string; qi: string; s: number; r: string; }
function loadJ(results: BR[]): { data: JI[]; used: Set<string>; avgPer: Record<string, number> } {
  if (!existsSync(JUDGE_DIR)) return { data: [], used: new Set(), avgPer: {} };
  const ordered = new Map<string, { si: string; qi: string }[]>();
  for (const r of results) for (const it of r.items) { const k = r.b + '|' + it.mid; if (!ordered.has(k)) ordered.set(k, []); ordered.get(k)!.push({ si: it.si, qi: it.qi }); }
  const cursor = new Map<string, number>();
  const data: JI[] = []; const sums: Record<string, [number, number]> = {}; const used = new Set<string>();
  for (const fname of readdirSync(JUDGE_DIR)) {
    if (!fname.endsWith('.json')) continue;
    const p = fname.replace('.json', '').split('--');
    if (p.length < 4) continue;
    const jm = p[0].replace(/_free$/, ':free').replace(/_/g, '/');
    const b = p[1].replace(/_/g, '-'); const mid = p[2].replace(/_/g, '/');
    const ck = jm + '|' + b + '|' + mid;
    let idx = cursor.get(ck) || 0;
    const items = ordered.get(b + '|' + mid) || [];
    try {
      const d: any = JSON.parse(readFileSync(join(JUDGE_DIR, fname), 'utf-8'));
      for (const e of (Array.isArray(d) ? d : (Object.values(d) as any[]).flat())) {
        if (idx >= items.length) break;
        const it = items[idx++]; const jn = e.judge ?? jm; used.add(jn);
        data.push({ j: jn, b, mid, si: it.si, qi: it.qi, s: e.score ?? 0, r: e.reasoning || '' });
        if (!sums[mid]) sums[mid] = [0, 0]; sums[mid][0] += e.score ?? 0; sums[mid][1]++;
      }
    } catch {}
    cursor.set(ck, idx);
  }
  const avgPer: Record<string, number> = {};
  for (const [m, [s, c]] of Object.entries(sums)) if (c > 0) avgPer[m] = s / c;
  return { data, used, avgPer };
}

/* ── build judge lookup ─────────────────────────────────────── */
function buildJudgeMap(data: JI[]): Map<string, { j: string; s: number; r: string }[]> {
  const m = new Map<string, { j: string; s: number; r: string }[]>();
  for (const j of data) { const k = j.mid + '|' + j.b + '|' + j.si + '|' + j.qi; if (!m.has(k)) m.set(k, []); m.get(k)!.push(j); }
  return m;
}

/* ── build HTML ─────────────────────────────────────────────── */
function buildHtml(results: BR[], jc: ReturnType<typeof loadJ>): string {
  const all = results.flatMap(r => r.items.map(it => ({ ...it, b: r.b })));
  const mods = [...new Set(all.map(r => r.mid))];
  const hasJ = jc.used.size > 0;
  const jmap = buildJudgeMap(jc.data);
  const bm = new Map<string, Map<string, typeof all>>();
  for (const r of all) { if (!bm.has(r.b)) bm.set(r.b, new Map()); if (!bm.get(r.b)!.has(r.si)) bm.get(r.b)!.set(r.si, []); bm.get(r.b)!.get(r.si)!.push(r); }
  const ranking = mods.map(id => {
    const mr = all.filter(r => r.mid === id);
    const judgeAvg = jc.avgPer[id];
    const scoreForRank = hasJ && judgeAvg !== undefined ? judgeAvg : (mr.length ? mr.reduce((a, r) => a + r.score, 0) / mr.length : 0);
    return { id, ra: mr.length ? mr.reduce((a: number, r: any) => a + r.score, 0) / mr.length : 0, ja: judgeAvg, at: mr.length ? mr.reduce((a: number, r: any) => a + r.time, 0) / mr.length : 0, n: mr.length, scoreForRank };
  }).sort((a, b) => b.scoreForRank - a.scoreForRank);
  const top3 = new Set(ranking.slice(0, 3).map(m => m.id));
  const benches = Array.from(bm.keys()).sort();
  const nBench = benches.length;

  // CSS
  const css = ':root{--bg:#06090f;--surface:#0d1117;--border:#21262d;--text:#e6edf3;--text-dim:#8b949e;--accent:#58a6ff;--green:#3fb950;--yellow:#d29922;--red:#f85149;--mono:"SF Mono","Fira Code",monospace;--sans:system-ui,sans-serif}'
    + '*{margin:0;padding:0;box-sizing:border-box}body{font-family:var(--sans);background:var(--bg);color:var(--text);line-height:1.5}'
    + 'a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}'
    + '.wrap{max-width:1800px;margin:0 auto;padding:0 24px}'
    + '.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:20px 0}'
    + '.stat{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center}'
    + '.stat .val{font-size:1.6rem;font-weight:700}.stat .lbl{font-size:.7rem;color:var(--text-dim);text-transform:uppercase}'
    + 'h2{margin:24px 0 12px;color:var(--accent)}h3{margin:20px 0 8px}'
    + 'table.lb{width:100%;border-collapse:separate;border-spacing:0}'
    + 'table.lb th{text-align:left;font-size:.7rem;color:var(--text-dim);padding:6px 10px;border-bottom:2px solid var(--border);text-transform:uppercase}'
    + 'table.lb td{padding:6px 10px;border-bottom:1px solid var(--border);font-size:.85rem;vertical-align:middle}'
    + '.brow{display:flex;align-items:center;gap:8px}.btrack{width:' + MAX_BAR + 'px;height:20px;background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden}.bfill{height:100%;border-radius:3px}.blbl{font-family:var(--mono);font-size:.8rem;min-width:36px;text-align:right;font-weight:700}'
    + '.badge{display:inline-block;font-family:var(--mono);font-weight:700;font-size:.75rem;padding:1px 5px;border-radius:3px}'
    + '.sg{background:rgba(63,185,80,.15);color:var(--green)}.sm{background:rgba(210,153,34,.15);color:var(--yellow)}.sb{background:rgba(248,81,73,.15);color:var(--red)}'
    + 'table.comp{width:100%;border-collapse:separate;border-spacing:0}'
    + 'table.comp th{position:sticky;top:0;background:var(--surface);padding:8px 10px;font-size:.8rem;border-bottom:2px solid var(--border);z-index:5;min-width:120px}'
    + 'table.comp td{padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top;font-size:.8rem;min-width:220px}'
    + 'label{cursor:pointer}input[type="checkbox"]{accent-color:var(--accent);cursor:pointer}'
    + 'code{background:rgba(88,166,255,.1);padding:1px 5px;border-radius:3px;font-family:var(--mono);font-size:.85em}'
    + '.al{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--accent);font-family:var(--mono);font-size:.8rem;margin:4px 8px 4px 0}.al:hover{background:rgba(88,166,255,.08)}'
    + '.st{position:relative;cursor:help;border-bottom:1px dotted var(--text-dim)}.st::after{content:attr(data-tip);display:none;position:absolute;bottom:100%;left:0;background:#161b22;border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:.7rem;color:var(--text-dim);white-space:pre-wrap;max-width:520px;overflow:hidden;z-index:100;font-family:var(--mono);line-height:1.5;box-shadow:0 4px 16px rgba(0,0,0,.6)}.st:hover::after{display:block}'
    + '.st-footer{margin-top:32px;padding:16px 0;color:var(--text-dim);font-size:.75rem;border-top:1px solid var(--border)}'
    + '.st-footer code{margin-right:4px}'
    + 'footer{text-align:center;padding:24px 0;color:var(--text-dim);font-size:.7rem;border-top:1px solid var(--border);margin-top:60px}'
    + '@media(max-width:600px){.stats{grid-template-columns:repeat(3,1fr)}}';

  // ── Stats ──
  let h = '<div class="stats">';
  h += '<div class="stat"><div class="val">' + mods.length + '</div><div class="lbl">Models</div></div>';
  h += '<div class="stat"><div class="val">' + bm.size + '</div><div class="lbl">Benches</div></div>';
  h += '<div class="stat"><div class="val">' + [...new Set(all.map(r => r.si))].length + '</div><div class="lbl">Questions</div></div>';
  h += '<div class="stat"><div class="val">' + all.length + '</div><div class="lbl">Evals</div></div>';
  if (hasJ) h += '<div class="stat"><div class="val">' + jc.used.size + '</div><div class="lbl">Judges</div></div>';
  h += '</div>';

  // ── Leaderboard with bars + checkboxes ──
  h += '<h2>Leaderboard</h2>';
  h += '<table class="lb"><thead><tr><th></th><th style="min-width:220px"><label style="gap:6px;cursor:pointer;display:flex;align-items:center"><input type="checkbox" checked id="toggleAll" onchange="toggleAllCheckboxes(this.checked)"> Model</label></th><th style="min-width:' + (MAX_BAR + 44) + 'px">Avg F1</th><th>Latency</th><th>N</th></tr></thead><tbody>';
  for (let i = 0; i < ranking.length; i++) {
    const m: any = ranking[i];
    const s = m.id.includes('/') ? m.id.split('/').pop()! : m.id;
    const mc = m.id.replace(/[^a-zA-Z0-9]/g, '_');
    const scoreVal = (hasJ && m.ja !== undefined) ? m.ja : m.ra;
    h += '<tr data-mc="' + mc + '">';
    h += '<td style="font-weight:700;font-size:1rem;width:28px;color:var(--accent)">' + (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : ' ' + (i + 1)) + '</td>';
    h += '<td><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.9rem"><input type="checkbox" class="model-cb" data-mc="' + mc + '" ' + (top3.has(m.id) ? 'checked' : '') + ' onchange="t(\'' + mc + '\',this.checked)"> <code>' + esc(s) + '</code></label></td>';
    h += '<td>' + bar(scoreVal) + '</td>';
    h += '<td style="font-family:var(--mono);font-size:.8rem">' + fm(m.at) + '</td><td style="width:32px">' + m.n + '</td></tr>';
  }
  h += '</tbody></table>';
  if (hasJ) h += '<p style="color:var(--text-dim);font-size:.75rem;margin:8px 0 16px">Score = judge avg of ' + jc.used.size + ' judges across ' + nBench + ' benchmarks · Check boxes to toggle model columns in detailed results</p>';

  // ── Per-benchmark judge scores ──
  if (hasJ) {
    const barColWidth = (MAX_BAR + 44);
    h += '<h2>Per-Benchmark Scores</h2>';
    h += '<div style="overflow-x:auto"><table class="lb"><thead><tr><th style="min-width:220px">Model</th>';
    for (const b of benches) h += '<th style="min-width:' + barColWidth + '">' + esc(b) + '</th>';
    h += '</tr></thead><tbody>';
    for (const m of ranking) {
      h += '<tr><td><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem"><input type="checkbox" class="model-cb" data-mc="' + m.id.replace(/[^a-zA-Z0-9]/g, '_') + '" ' + (top3.has(m.id) ? 'checked' : '') + ' onchange="t(\'' + m.id.replace(/[^a-zA-Z0-9]/g, '_') + '\',this.checked)"> <code>' + esc(m.id.includes('/') ? m.id.split('/').pop()! : m.id) + '</code></label></td>';
      for (const b of benches) {
        const rs = all.filter(r => r.mid === m.id && r.b === b);
        if (!rs.length) { h += '<td>—</td>'; continue; }
        const ra = rs.reduce((a: number, r: any) => a + r.score, 0) / rs.length;
        const jscores = jc.data.filter(j => j.mid === m.id && j.b === b);
        const ja = jscores.length ? jscores.reduce((a: number, j: any) => a + j.s, 0) / jscores.length : undefined;
        const scoreVal = hasJ && ja !== undefined ? ja : ra;
        h += '<td>' + bar(scoreVal) + '</td>';
      }
      h += '</tr>';
    }
    h += '</tbody></table></div>';
  }

  // ── Detailed results ──
  h += '<h2 style="margin-top:32px">Detailed Results</h2>';
  for (const b of benches) {
    const sMap = bm.get(b)!;
    h += '<h3 style="color:var(--accent);margin-top:20px">' + esc(b) + '</h3>';
    h += '<div style="overflow-x:auto"><table class="comp"><thead><tr><th style="min-width:150px">Sample</th>';
    for (const m of mods) {
      const s = m.includes('/') ? m.split('/').pop()! : m;
      const mc = m.replace(/[^a-zA-Z0-9]/g, '_');
      const hd = top3.has(m) ? '' : ' style="display:none"';
      const mr2 = ranking.find((x: any) => x.id === m);
      const sub = mr2 ? ' <span style="font-size:.65rem;color:var(--text-dim)">' + ((hasJ && mr2.ja !== undefined) ? mr2.ja.toFixed(2) : mr2.ra.toFixed(2)) + '</span>' : '';
      h += '<th class="mc-' + mc + '"' + hd + '>' + esc(s) + sub + '</th>';
    }
    h += '</tr></thead><tbody>';

    for (const [sid, items] of sMap) {
      for (const it of items) {
        h += '<tr>';
        h += '<td style="vertical-align:top;min-width:150px">';
        if (it.img) h += '<img src="' + it.img + '" style="max-width:140px;border-radius:6px;margin-bottom:4px;border:1px solid var(--border)" loading="lazy">';
        h += '<div style="font-size:.7rem;color:var(--text-dim);font-family:var(--mono);word-break:break-all">' + esc((it.gt || '').slice(0, 90)) + '</div></td>';

        for (const m of mods) {
          const mc = m.replace(/[^a-zA-Z0-9]/g, '_');
          const hd = top3.has(m) ? '' : ' style="display:none"';
          h += '<td class="mc-' + mc + '"' + hd + ' style="vertical-align:top;min-width:220px">';
          const resp = all.find(r => r.mid === m && r.si === it.si && r.qi === it.qi && r.b === b);
          if (resp) {
            const jk = m + '|' + b + '|' + it.si + '|' + it.qi;
            const js = jmap.get(jk);
            if (js && js.length > 0) {
              const avg = js.reduce((a: number, j: any) => a + j.s, 0) / js.length;
              const tip = js.map((j: any) => { const sh = j.j.includes('/') ? j.j.split('/').pop()! : j.j; return '<b>' + esc(sh) + '</b>: ' + j.s.toFixed(2) + (j.r ? ' — ' + esc(j.r.slice(0, 150)) : ''); }).join('<br>');
              h += '<span class="st" data-tip="' + esc(tip) + '"><span class="badge ' + sc(avg) + '">' + avg.toFixed(2) + '</span></span> ';
            } else {
              h += '<span class="badge ' + sc(resp.score) + '">' + resp.score.toFixed(2) + '</span> ';
            }
            h += '<span style="color:var(--text-dim);font-size:.7rem">' + fm(resp.time) + '</span>';
            if (js && js[0]?.r) h += '<div style="font-size:.65rem;color:var(--accent);font-style:italic;margin:2px 0">' + esc(js[0].r.slice(0, 100)) + '</div>';
            const t = resp.resp || '(empty)';
            h += '<div style="font-size:.75rem;color:var(--text-dim);background:rgba(0,0,0,.25);padding:4px 6px;border-radius:4px;max-height:70px;overflow-y:auto;white-space:pre-wrap;word-break:break-word">' + esc(t.slice(0, 180)) + (t.length > 180 ? '…' : '') + '</div>';
            if (resp.err) h += '<div style="color:var(--red);font-size:.65rem">⚠️ ' + esc((resp.err || '').slice(0, 60)) + '</div>';
          }
          h += '</td>';
        }
        h += '</tr>';
      }
    }
    h += '</tbody></table></div>';
  }

  h += '<h2 style="margin-top:40px">Artifacts</h2>';
  h += '<div style="display:flex;flex-wrap:wrap;gap:0;margin:8px 0"><a href="results.jsonl" download class="al">📄 results.jsonl</a><a href="judge-details.jsonl" download class="al">📄 judge-details.jsonl</a></div>';

  const footer = hasJ ? ' | Judges: ' + [...jc.used].sort().map((j: string) => '<code>' + esc(j.includes('/') ? j.split('/').pop()! : j) + '</code>').join(' • ') : '';

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>vision-benchmark</title><style>' + css + '</style></head><body><div class="wrap"><main>' + h + '</main><div class="st-footer">vision-benchmark | ' + new Date().toISOString().slice(0, 10) + footer + '</div><scr' + 'ipt>function t(mc,s){\'use strict\';document.querySelectorAll(\'.mc-\'+mc).forEach(function(el){el.style.display=s?\'\' : \'none\'});document.querySelectorAll(\'tr[data-mc="\'+mc+\'"]\').forEach(function(tr){var cbs=tr.querySelectorAll(\'.model-cb\');if(cbs.length)cbs[0].checked=s});document.querySelectorAll(\'input.model-cb[data-mc="\'+mc+\'"]\').forEach(function(cb){cb.checked=s})}function toggleAllCheckboxes(checked){\'use strict\';document.querySelectorAll(\'input.model-cb\').forEach(function(cb){cb.checked=checked;t(cb.dataset.mc,checked)})}</scr' + 'ipt></div></body></html>';
}

/* ── main ────────────────────────────────────────────────────── */
console.log('Loading benchmark results…');
const results = loadResults();
console.log('  ' + results.length + ' runs, ' + results.reduce((n, s) => n + s.items.length, 0) + ' evals');
console.log('Loading judge cache…');
const jc = loadJ(results);
console.log('  ' + jc.data.length + ' judge scores from ' + jc.used.size + ' judges');

const html = buildHtml(results, jc) || '';
mkdirSync(DOCS_DIR, { recursive: true });
writeFileSync(join(DOCS_DIR, 'index.html'), html);
console.log('✓ docs/index.html (' + (html.length / 1024).toFixed(0) + 'KB)');

const jl = jc.data.map(j => JSON.stringify({ judge: j.j, bench: j.b, model: j.mid, sample: j.si, question: j.qi, score: j.s, reasoning: j.r }));
const rj = results.flatMap(r => r.items.map(it => JSON.stringify({ bench: r.b, model: it.mid, score: it.score, timeMs: it.time, error: it.err || null, response: (it.resp || '').slice(0, 300), gt: it.gt })));
writeFileSync(join(DOCS_DIR, 'results.jsonl'), rj.join('\n') + '\n');
writeFileSync(join(DOCS_DIR, 'judge-details.jsonl'), jl.join('\n') + '\n');
console.log('✓ docs/results.jsonl, docs/judge-details.jsonl');
