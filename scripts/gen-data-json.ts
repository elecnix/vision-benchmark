#!/usr/bin/env tsx
/** Extract benchmark results + judge cache → src/data.json for Astro */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const RESULTS_DIR = join(process.cwd(), 'results');
const JUDGE_DIR = join(RESULTS_DIR, 'judge-cache');
const DATA_FILE = join(process.cwd(), 'src', 'data.json');

// ── Types ─────────────────────────────────────────────────────────────
interface RI {
  mid: string; si: string; qi: string;
  score: number; time: number; err?: string;
  resp: string; gt: string; img?: string;
}
interface BR { b: string; items: RI[]; }

// ── Load benchmark results from results/*.json ────────────────────────
function loadResults(): BR[] {
  if (!existsSync(RESULTS_DIR)) return [];
  return readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json') && !f.startsWith('judge'))
    .map(f => {
      try {
        const s = JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf-8'));
        const b = (s.benchmark || '').replace(/-repro$/, '').replace(/-judged:.*$/, '').split('-judge')[0];
        const items = (Array.isArray(s.results) ? s.results : Object.values(s.results || {}))
          .map((r: any) => ({
            mid: r.modelId, si: r.sampleId, qi: r.questionId,
            score: r.score, time: r.totalResponseTimeMs,
            err: r.error, resp: r.modelResponse || '',
            gt: r.groundTruthDescription, img: r.imageDataUrl,
          }));
        return { b, items };
      } catch { return null; }
    }).filter(Boolean) as BR[];
}

// ── Load judge cache ──────────────────────────────────────────────────
interface JI { j: string; b: string; mid: string; si: string; qi: string; s: number | null; r: string; }

function loadJ(results: BR[]): { data: JI[]; used: Set<string>; avgPer: Record<string, number | null>; validCounts: Record<string, number> } {
  if (!existsSync(JUDGE_DIR)) return { data: [], used: new Set(), avgPer: {}, validCounts: {} };

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
        const reason: string = e.reasoning ?? '';
        data.push({ j: jn, b, mid, si: it.si, qi: it.qi, s: scoreVal, r: reason });
        if (typeof scoreVal === 'number') {
          if (!modelSums[mid]) modelSums[mid] = [0, 0];
          modelSums[mid][0] += scoreVal;
          modelSums[mid][1]++;
        }
        used.add(jn);
      }
      cursor.set(ck, idx);
    } catch {}
  }

  const avgPer: Record<string, number | null> = {};
  const validCounts: Record<string, number> = {};
  for (const [m, [sum, cnt]] of Object.entries(modelSums)) {
    avgPer[m] = cnt > 0 ? sum / cnt : null;
    validCounts[m] = cnt;
  }
  return { data, used, avgPer, validCounts };
}

// ── Build judge lookup map ────────────────────────────────────────────
function buildJudgeMap(data: JI[]): Map<string, JI[]> {
  const m = new Map<string, JI[]>();
  for (const d of data) {
    const k = d.mid + '|' + d.b + '|' + d.si + '|' + d.qi;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(d);
  }
  return m;
}

// ── Build report data ─────────────────────────────────────────────────
function buildReportData(results: BR[], jc: ReturnType<typeof loadJ>) {
  const all: Array<RI & { b: string }> = [];
  const bm = new Map<string, Map<string, { si: string; qi: string }[]>>();
  for (const r of results) {
    if (!bm.has(r.b)) bm.set(r.b, new Map());
    const sm = bm.get(r.b)!;
    for (const it of r.items) {
      all.push({ ...it, b: r.b });
      if (!sm.has(it.si)) sm.set(it.si, []);
      sm.get(it.si)!.push({ si: it.si, qi: it.qi });
    }
  }

  const mods = [...new Set(all.map(r => r.mid))];
  const hasJ = jc.used.size > 0;
  const jmap = buildJudgeMap(jc.data);

  const ranking = mods.map(id => {
    const mr = all.filter(r => r.mid === id);
    const ra = mr.length ? mr.reduce((a: number, r) => a + r.score, 0) / mr.length : 0;
    const ja: number | null = jc.avgPer[id] ?? null;
    const vc = jc.validCounts[id] ?? 0;
    const at = mr.length ? mr.reduce((a: number, r) => a + r.time, 0) / mr.length : 0;
    return { id, ra, ja, at, n: mr.length, scoreForRank: (ja !== null) ? ja : ra, vc };
  }).sort((a, b) => b.scoreForRank - a.scoreForRank);

  const top3 = new Set(ranking.slice(0, 3).map((m: any) => m.id));

  const benches = Array.from(bm.keys()).sort();
  const benchData: any[] = [];
  for (const b of benches) {
    const sMap = bm.get(b)!;
    const rows: any[] = [];
    for (const [si, items] of sMap) {
      for (const it of items) {
        const row: any = { si: it.si, qi: it.qi };
        const first = all.find(r => r.si === it.si && r.qi === it.qi && r.b === b);
        if (first) { row.img = first.img; row.gt = first.gt; }
        for (const m of mods) {
          const resp = all.find(r => r.mid === m && r.si === it.si && r.qi === it.qi && r.b === b);
          if (resp) {
            const cell: any = { score: resp.score, time: resp.time, resp: resp.resp, err: resp.err };
            if (hasJ) {
              const jk = m + '|' + b + '|' + it.si + '|' + it.qi;
              const js = jmap.get(jk);
              if (js && js.length > 0) {
                cell.judges = js.map(j => ({
                  j: j.j.includes('/') ? j.j.split('/').pop()! : j.j,
                  s: j.s, r: j.r
                }));
              }
            }
            row[m] = cell;
          }
        }
        rows.push(row);
      }
    }
    const modelAvgs: Record<string, number> = {};
    for (const m of mods) {
      const vals = rows.map(r => r[m]).filter(Boolean);
      modelAvgs[m] = vals.length ? vals.reduce((a, c) => a + c.score, 0) / vals.length : 0;
    }
    benchData.push({ name: b, evalCount: rows.length, modelAvgs, rows });
  }

  const judgesUsed = [...jc.used].sort().map(j => j.includes('/') ? j.split('/').pop()! : j);
  return {
    ranking: ranking.map(r => ({
      id: r.id,
      label: r.id.includes('/') ? r.id.split('/').pop()! : r.id,
      ja: r.ja, ra: r.ra, at: r.at, n: r.n, vc: r.vc
    })),
    mods,
    modLabels: mods.map(m => m.includes('/') ? m.split('/').pop()! : m),
    top3: [...top3],
    benches: benchData,
    judgesUsed,
    date: new Date().toISOString().slice(0, 10)
  };
}

// ── Main ──────────────────────────────────────────────────────────────
console.log('Loading benchmark results…');
const results = loadResults();
console.log(`  ${results.length} runs, ${results.reduce((n, s) => n + s.items.length, 0)} evals`);
console.log('Loading judge cache…');
const jc = loadJ(results);
const nn = jc.data.filter((j: any) => j.s !== null).length;
console.log(`  ${jc.data.length} judge entries (${nn} scored, ${jc.data.length - nn} timed out)`);
console.log(`  ${jc.used.size} judges`);

const data = buildReportData(results, jc);
mkdirSync(dirname(DATA_FILE), { recursive: true });
writeFileSync(DATA_FILE, JSON.stringify(data));
console.log(`✓ ${DATA_FILE} (${(JSON.stringify(data).length / 1024).toFixed(0)}KB)`);
