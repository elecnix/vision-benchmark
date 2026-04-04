#!/usr/bin/env tsx
/** Report generator — benchmark results + multi-judge → HTML + JSONL */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RESULTS_DIR = join(process.cwd(), 'results');
const JUDGE_DIR = join(RESULTS_DIR, 'judge-cache');
const DOCS_DIR = join(process.cwd(), 'docs');
const MAX_BAR = 200;

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function sc(v: number): string { return v >= 0.8 ? 'sg' : v >= 0.5 ? 'sm' : 'sb'; }
function fm(ms: number): string { return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms) + 'ms'; }

/** One horizontal bar, color-coded by score value */
function bar(v: number | null | undefined): string {
  if (v === null || v === undefined) return '<span style="color:var(--text-dim)">—</span>';
  const w = Math.round(v * MAX_BAR);
  const c = v >= 0.8 ? 'var(--green)' : v >= 0.5 ? 'var(--yellow)' : 'var(--red)';
  return '<div class="brow"><div class="btrack"><div class="bfill" style="width:' + w + 'px;background:' + c + '"></div></div><span class="blbl">' + v.toFixed(2) + '</span></div>';
}

/** Avg of non-null values, or null if all null */
function avgNonNull(values: (number | null)[]): number | null {
  const valid = values.filter((x): x is number => x !== null && x !== undefined);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

/* ── load benchmark results ─────────────────────────────────── */
interface BR {
  b: string; // benchmark name
  items: { mid: string; si: string; qi: string; score: number; time: number; err?: string; resp: string; gt: string; img?: string }[];
}

function loadResults(): BR[] {
  if (!existsSync(RESULTS_DIR)) { console.error('No results/'); process.exit(1); }
  return readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json') && !f.startsWith('judge'))
    .map(f => {
      try {
        const s = JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf-8'));
        const b = (s.benchmark || '').replace(/-repro$/, '').replace(/-judged:.*$/, '').split('-judge')[0];
        return {
          b,
          items: (s.results || []).map((r: any) => ({
            mid: r.modelId, si: r.sampleId, qi: r.questionId,
            score: r.score, time: r.totalResponseTimeMs,
            err: r.error, resp: r.modelResponse || '',
            gt: r.groundTruthDescription, img: r.imageDataUrl,
          })),
        } as BR;
      } catch { return null; }
    }).filter(Boolean) as BR[];
}

/* ── load judge cache ───────────────────────────────────────── */
// Cache entries: { judge: string, score: number|null, reasoning: string }
// score = null → timed out after all retries (excluded from avg)
interface JI {
  j: string; b: string; mid: string; si: string; qi: string;
  s: number | null; r: string;
}

function loadJ(results: BR[]): { data: JI[]; used: Set<string>; avgPer: Record<string, number | null>; validCounts: Record<string, number> } {
  if (!existsSync(JUDGE_DIR)) return { data: [], used: new Set(), avgPer: {}, validCounts: {} };

  // Build ordered lookup: (bench|mid) → [{si, qi}, ...]
  const ordered = new Map<string, { si: string; qi: string }[]>();
  for (const r of results) {
    for (const it of r.items) {
      const k = r.b + '|' + it.mid;
      if (!ordered.has(k)) ordered.set(k, []);
      ordered.get(k)!.push({ si: it.si, qi: it.qi });
    }
  }

  const cursor = new Map<string, number>();
  const data: JI[] = [];
  const modelSums: Record<string, [number, number]> = {};
  const used = new Set<string>();

  for (const fname of readdirSync(JUDGE_DIR)) {
    if (!fname.endsWith('.json')) continue;
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
        const jn = e.judge ?? jm;
        const scoreVal: number | null = e.score === null || e.score === undefined ? null : e.score;
        if (scoreVal !== null) {
          if (!modelSums[mid]) modelSums[mid] = [0, 0];
          modelSums[mid][0] += scoreVal;
          modelSums[mid][1]++;
        }
        used.add(jn);
        data.push({ j: jn, b, mid, si: it.si, qi: it.qi, s: scoreVal, r: e.reasoning || '' });
      }
    } catch {}
    cursor.set(ck, idx);
  }

  const avgPer: Record<string, number | null> = {};
  const validCounts: Record<string, number> = {};
  for (const [m, [s, c]] of Object.entries(modelSums)) {
    avgPer[m] = c > 0 ? s / c : null;
    validCounts[m] = c;
  }
  return { data, used, avgPer, validCounts };
}

/* ── judge tooltip lookup ──────────────────────────────────── */
function buildJudgeMap(data: JI[]): Map<string, JI[]> {
  const m = new Map<string, JI[]>();
  for (const j of data) {
    const k = j.mid + '|' + j.b + '|' + j.si + '|' + j.qi;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(j);
  }
  return m;
}

/* ── build HTML ─────────────────────────────────────────────── */
function buildHtml(results: BR[], jc: ReturnType<typeof loadJ>): string {
  const all = results.flatMap(r => r.items.map(it => ({ ...it, b: r.b })));
  const mods = [...new Set(all.map(r => r.mid))];
  const hasJ = jc.used.size > 0;
  const jmap = buildJudgeMap(jc.data);

  // Group by bench → si → items
  const bm = new Map<string, Map<string, typeof all>>();
  for (const r of all) {
    if (!bm.has(r.b)) bm.set(r.b, new Map());
    const sm = bm.get(r.b)!;
    if (!sm.has(r.si)) sm.set(r.si, []);
    sm.get(r.si)!.push(r);
  }

  // Rankings: judge avg if available & valid, otherwise rule avg
  const ranking = mods.map(id => {
    const mr: any[] = all.filter((r: any) => r.mid === id);
    const ra = mr.length ? mr.reduce((a: number, r: any) => a + r.score, 0) / mr.length : 0;
    const ja: number | null = jc.avgPer[id] ?? null;
    const vc = jc.validCounts[id] ?? 0;
    const at = mr.length ? mr.reduce((a: number, r: any) => a + r.time, 0) / mr.length : 0;
    const scoreForRank = (ja !== null) ? ja : ra;
    return { id, ra, ja, at, n: mr.length, scoreForRank, vc };
  }).sort((a: any, b: any) => b.scoreForRank - a.scoreForRank);

  const topN = 3;
  const top3 = new Set(ranking.slice(0, topN).map((m: any) => m.id));
  const benches = Array.from(bm.keys()).sort();

  /* ── CSS ─────────────────────────────────────────────────── */
  const css = `:root{--bg:#06090f;--surface:#0d1117;--border:#21262d;--text:#e6edf3;--text-dim:#8b949e;--accent:#58a6ff;--green:#3fb950;--yellow:#d29922;--red:#f85149;--mono:'SF Mono',monospace;--sans:system-ui,sans-serif}
*{margin:0;padding:0;box-sizing:border-box}body{font-family:var(--sans);background:var(--bg);color:var(--text);line-height:1.5}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:2000px;margin:0 auto;padding:0 24px}
h2{margin:24px 0 12px;color:var(--accent)}h3{margin:20px 0 8px}
table{width:100%;border-collapse:separate;border-spacing:0}
th{font-size:.7rem;color:var(--text-dim);padding:6px 10px;border-bottom:2px solid var(--border);text-transform:uppercase;text-align:left}
td{padding:6px 10px;border-bottom:1px solid var(--border);font-size:.85rem;vertical-align:middle}
.brow{display:flex;align-items:center;gap:8px}.btrack{width:${MAX_BAR}px;height:18px;background:rgba(255,255,255,.05);border:1px solid var(--border);border-radius:4px;overflow:hidden}.bfill{height:100%;border-radius:3px}.blbl{font-family:var(--mono);font-size:.8rem;min-width:36px;text-align:right;font-weight:700}
.sg{background:rgba(63,185,80,.15);color:var(--green)}.sm{background:rgba(210,153,34,.15);color:var(--yellow)}.sb{background:rgba(248,81,73,.15);color:var(--red)}
.comp th{position:sticky;top:0;background:var(--surface);z-index:5;min-width:220px}
.comp td{vertical-align:top;min-width:260px}
.hidden-col{display:none !important}
label{cursor:pointer}input[type="checkbox"]{accent-color:var(--accent);cursor:pointer}
code{background:rgba(88,166,255,.1);padding:1px 5px;border-radius:3px;font-family:var(--mono);font-size:.85em}
.al{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--accent);font-family:var(--mono);font-size:.8rem;margin:4px 8px 4px 0}.al:hover{background:rgba(88,166,255,.08)}
.st{position:relative;cursor:help}.st::after{content:attr(data-tip);display:none;position:absolute;bottom:100%;left:0;background:#161b22;border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:.7rem;color:var(--text-dim);white-space:pre-wrap;max-width:540px;z-index:100;font-family:var(--mono);line-height:1.5;box-shadow:0 4px 16px rgba(0,0,0,.6)}.st:hover::after{display:block}
.st-footer{margin-top:32px;padding:16px 0;color:var(--text-dim);font-size:.75rem;border-top:1px solid var(--border)}
.st-footer code{margin-right:6px}
@media(max-width:700px){.wrap{padding:0 12px}}`;

  /* ── Leaderboard: one checkbox + bar per model ──────────── */
  let h = '';
  h += '<h2>Leaderboard</h2>';
  h += '<table class="lb" style="margin-bottom:8px"><thead><tr><th></th>';
  h += '<th style="min-width:240px"><label style="gap:6px;display:flex;align-items:center"><input type="checkbox" checked id="tAll" onchange="toggleAll(this.checked)"> Model</label></th>';
  h += '<th style="min-width:' + (MAX_BAR + 44) + 'px">Judge Avg</th>';
  h += '<th style="min-width:' + (MAX_BAR + 44) + 'px">Rule Avg</th>';
  h += '<th>Latency</th><th style="text-align:center">N</th></tr></thead><tbody>';

  for (let i = 0; i < ranking.length; i++) {
    const m: any = ranking[i];
    const s = m.id.includes('/') ? m.id.split('/').pop()! : m.id;
    const mc = m.id.replace(/[^a-zA-Z0-9_]/g, '_');
    const checked = top3.has(m.id) ? 'checked' : '';
    h += '<tr>';
    h += '<td style="font-weight:700;font-size:1.1rem;width:32px;color:var(--accent)">' + (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : ' ' + (i + 1)) + '</td>';
    h += '<td><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" class="cb" data-mc="' + mc + '" ' + checked + ' onchange="toggleModel(\'' + mc + '\',this.checked)"> <code>' + esc(s) + '</code>';
    if (hasJ && m.vc > 0) h += ' <span style="font-size:.65rem;color:var(--text-dim)">' + m.vc + ' judges</span>';
    h += '</label></td>';
    h += '<td>' + bar(m.ja) + '</td>';
    h += '<td>' + bar(m.ra) + '</td>';
    h += '<td style="font-family:var(--mono);font-size:.8rem">' + fm(m.at) + '</td>';
    h += '<td style="text-align:center">' + m.n + '</td></tr>';
  }
  h += '</tbody></table>';

  if (hasJ) {
    h += '<p style="color:var(--text-dim);font-size:.75rem;margin:0 0 16px">Judge avg excludes timed-out judges (' + jc.used.size + ' total) · Checkboxes toggle model columns below</p>';
  }

  /* ── Detailed Results: one column per model ─────────────── */
  h += '<h2>Detailed Results</h2>';
  for (const b of benches) {
    const sMap = bm.get(b)!;
    h += '<h3 style="color:var(--accent);margin-top:20px">' + esc(b) + '</h3>';
    h += '<div style="overflow-x:auto"><table class="comp"><thead><tr><th style="min-width:130px">Sample</th>';
    for (const m of mods) {
      const s = m.includes('/') ? m.split('/').pop()! : m;
      const mc = m.replace(/[^a-zA-Z0-9_]/g, '_');
      const hide = top3.has(m) ? '' : ' hidden-col';
      const mr2: any = ranking.find((x: any) => x.id === m);
      const sub = mr2 ? ' <span style="font-size:.6rem;color:var(--text-dim)">(' + (mr2.ja !== null ? mr2.ja.toFixed(2) : mr2.ra.toFixed(2)) + ')</span>' : '';
      h += '<th id="th-' + mc + '"' + hide + '>' + esc(s) + sub + '</th>';
    }
    h += '</tr></thead><tbody>';

    for (const [, items] of sMap) {
      for (const it of items) {
        h += '<tr>';
        h += '<td style="vertical-align:top;min-width:130px">';
        if (it.img) h += '<img src="' + it.img + '" style="max-width:120px;border-radius:6px;margin-bottom:4px;border:1px solid var(--border)" loading="lazy">';
        h += '<div style="font-size:.65rem;color:var(--text-dim);font-family:var(--mono)">' + esc((it.gt || '').slice(0, 90)) + '</div></td>';

        for (const m of mods) {
          const mc = m.replace(/[^a-zA-Z0-9_]/g, '_');
          const hide = top3.has(m) ? '' : ' hidden-col';
          h += '<td class="td-' + mc + hide + '">';
          const resp = all.find((r: any) => r.mid === m && r.si === it.si && r.qi === it.qi && r.b === b);
          if (resp) {
            const jk = m + '|' + b + '|' + it.si + '|' + it.qi;
            const js = jmap.get(jk);
            if (js && js.length > 0) {
              const valid = js.filter((j: any) => j.s !== null);
              const avg = valid.length ? valid.reduce((a: number, j: any) => a + j.s, 0) / valid.length : 0;
              const tip = js.map((j: any) => {
                const sh = j.j.includes('/') ? j.j.split('/').pop()! : j.j;
                return j.s === null ? '<b>' + esc(sh) + '</b>: timeout' : '<b>' + esc(sh) + '</b>: ' + j.s.toFixed(2) + (j.r ? ' — ' + esc(j.r.slice(0, 120)) : '');
              }).join('<br>');
              h += '<span class="st" data-tip="' + esc(tip) + '"><span class="badge ' + sc(avg) + '">' + avg.toFixed(2) + '</span></span>';
              if (valid.length < js.length) h += ' <span style="color:var(--text-dim);font-size:.65rem">' + valid.length + '/' + js.length + '</span>';
            } else {
              h += '<span class="badge ' + sc(resp.score) + '">' + resp.score.toFixed(2) + '</span>';
            }
            h += ' <span style="color:var(--text-dim);font-size:.65rem">' + fm(resp.time) + '</span>';
            const t = resp.resp || '(empty)';
            h += '<div style="font-size:.72rem;color:var(--text-dim);background:rgba(0,0,0,.25);padding:4px 6px;border-radius:4px;max-height:80px;overflow-y:auto;margin-top:2px;white-space:pre-wrap;word-break:break-word">' + esc(t.slice(0, 200)) + (t.length > 200 ? '…' : '') + '</div>';
            if (resp.err) h += '<div style="color:var(--red);font-size:.65rem;margin-top:2px">⚠️ ' + esc((resp.err || '').slice(0, 60)) + '</div>';
          }
          h += '</td>';
        }
        h += '</tr>';
      }
    }
    h += '</tbody></table></div>\n';
  }

  /* ── Artifacts ──────────────────────────────────────────── */
  h += '<h2 style="margin-top:40px">Artifacts</h2>';
  h += '<div style="display:flex;flex-wrap:wrap;margin:8px 0"><a href="results.jsonl" download class="al">📄 results.jsonl</a><a href="judge-details.jsonl" download class="al">📄 judge-details.jsonl</a></div>';

  const footer = hasJ ? [ ...jc.used ].sort().map((j: string) => '<code>' + esc(j.includes('/') ? j.split('/').pop()! : j) + '</code>').join(' ') : '';

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>vision-benchmark</title><style>' + css + '</style></head><body><div class="wrap"><main>' + h + '</main><div class="st-footer">vision-benchmark | ' + new Date().toISOString().slice(0, 10) + (footer ? ' | ' + footer : '') + '</div><scr' + 'ipt>function toggleModel(mc,s){var els=document.querySelectorAll(".td-"+mc);els.forEach(function(e){s?e.classList.remove("hidden-col"):e.classList.add("hidden-col")});var th=document.getElementById("th-"+mc);if(th){s?th.classList.remove("hidden-col"):th.classList.add("hidden-col")};document.querySelector("input.cb[data-mc=\'"+mc+"\']")&&(document.querySelector("input.cb[data-mc=\'"+mc+"\']").checked=s)}function toggleAll(s){document.querySelectorAll("input.cb").forEach(function(cb){toggleModel(cb.dataset.mc,s)})}</scr' + 'ipt></div></body></html>';
}

/* ── main ────────────────────────────────────────────────────── */
console.log('Loading benchmark results…');
const results = loadResults();
console.log('  ' + results.length + ' runs, ' + results.reduce((n: number, s: any) => n + s.items.length, 0) + ' evals');
console.log('Loading judge cache…');
const jc = loadJ(results);
const nn = jc.data.filter((j: any) => j.s !== null).length;
console.log('  ' + jc.data.length + ' judge entries (' + nn + ' scored, ' + (jc.data.length - nn) + ' timed out)');
console.log('  ' + jc.used.size + ' judges');

const html = buildHtml(results, jc) || '';
mkdirSync(DOCS_DIR, { recursive: true });
writeFileSync(join(DOCS_DIR, 'index.html'), html);
console.log('✓ docs/index.html (' + (html.length / 1024).toFixed(0) + 'KB)');

const jl = jc.data.map((j: any) => JSON.stringify({ judge: j.j, bench: j.b, model: j.mid, sample: j.si, question: j.qi, score: j.s, reasoning: j.r }));
const rj = results.flatMap((r: any) => r.items.map((it: any) => JSON.stringify({ bench: r.b, model: it.mid, score: it.score, timeMs: it.time, error: it.err || null, response: (it.resp || '').slice(0, 300), gt: it.gt })));
writeFileSync(join(DOCS_DIR, 'results.jsonl'), rj.join('\n') + '\n');
writeFileSync(join(DOCS_DIR, 'judge-details.jsonl'), jl.join('\n') + '\n');
console.log('✓ docs/results.jsonl, judge-details.jsonl');
