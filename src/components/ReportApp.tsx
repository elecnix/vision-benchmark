// ── Single React island: entire dashboard with shared visibility state ──
import React, { useState, useCallback, useContext, createContext, type ReactNode } from 'react';

// ─── Shared Context ───────────────────────────────────────────────────
interface CtxValue {
  vis: Set<string>;
  tog: (m: string) => void;
  togA: (s: boolean) => void;
  all: boolean;
  none: boolean;
}

const VisCtx = createContext<CtxValue>({
  vis: new Set(),
  tog: () => {},
  togA: () => {},
  all: false,
  none: true,
});

function ModelProvider({ top3, mods, children }: { top3: string[]; mods: string[]; children: ReactNode }) {
  const [vis, setVis] = useState<Set<string>>(() => new Set(top3));
  const tog = useCallback((m: string) =>
    setVis(p => { const n = new Set(p); n.has(m) ? n.delete(m) : n.add(m); return n; }), []);
  const togA = useCallback((s: boolean) => setVis(s ? new Set(mods) : new Set()), [mods]);
  return (
    <VisCtx.Provider value={{ vis, tog, togA, all: mods.every(m => vis.has(m)), none: mods.every(m => !vis.has(m)) }}>
      {children}
    </VisCtx.Provider>
  );
}
function useVis() { return useContext(VisCtx); }

// ─── Helpers ──────────────────────────────────────────────────────────
function sc(s: number) { return s >= .75 ? 'sg' : s >= .5 ? 'sm' : 'sb'; }
function scol(s: number) { return s >= .75 ? 'var(--green)' : s >= .5 ? 'var(--yellow)' : 'var(--red)'; }
function fmt(ms: number) { return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(1)}s`; }
function esc(s: string) { if (!s) return ''; return s.replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
const h = React.createElement;

// ─── CSS ─────────────────────────────────────────────────────────────
const CSS = `
.lb{width:100%;border-collapse:collapse;margin-bottom:8px}
.lb th{font-size:.7rem;color:var(--text-dim);padding:8px 10px;text-transform:uppercase;text-align:left}
.lb td{padding:8px 10px;vertical-align:middle;font-size:.85rem}
.badge{padding:1px 6px;border-radius:3px;font-family:var(--mono);font-size:.78rem;font-weight:600;display:inline-block}
.badge.sg{background:rgba(63,185,80,.15);color:var(--green)}.badge.sm{background:rgba(210,153,34,.15);color:var(--yellow)}.badge.sb{background:rgba(248,81,73,.15);color:var(--red)}
.brow{display:flex;align-items:center;gap:8px}
.btrk{width:200px;height:18px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:4px;overflow:hidden}
.bfl{height:100%;border-radius:3px}
.blbl{font-family:var(--mono);font-size:.8rem;min-width:36px;text-align:right;font-weight:700}
.mcode{background:rgba(88,166,255,.1);padding:1px 6px;border-radius:3px;font-family:var(--mono);font-size:.85em}
.mavg{display:flex;gap:12px;margin-left:auto;flex-wrap:wrap;align-items:center;font-family:var(--mono)}
.mavg span{display:inline-flex;align-items:center;gap:4px;cursor:pointer}
.mavg .lbl{color:var(--text-dim);font-size:.65rem}.mavg .bar{border-radius:2px;display:inline-block}.mavg .val{font-size:.75rem}
.comp-t{width:100%;border-collapse:separate;border-spacing:0;margin-top:8px}
.comp-t th{font-size:.7rem;color:var(--text-dim);padding:8px 10px;border-bottom:2px solid var(--border);text-transform:uppercase;text-align:left;position:sticky;top:0;background:var(--surface);z-index:2}
.comp-t td{vertical-align:top;padding:8px 12px;border-bottom:1px solid var(--border);font-size:.85rem}
.comp-t td:first-child{position:sticky;left:0;background:var(--surface);z-index:1;min-width:120px}
.tip{position:relative;cursor:help}.tip::after{content:attr(data-tip);display:none;position:absolute;bottom:100%;left:0;background:#161b22;border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:.7rem;color:var(--text-dim);white-space:pre-wrap;max-width:480px;z-index:100;font-family:var(--mono);line-height:1.5;box-shadow:0 4px 16px rgba(0,0,0,.6)}.tip:hover::after{display:block}
.hid{display:none !important}
.grp-h{display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;cursor:pointer;user-select:none;flex-wrap:wrap;transition:background .15s}
.grp-h:hover{background:rgba(255,255,255,.03)}
.art{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--accent);font-family:var(--mono);font-size:.8rem;text-decoration:none}.art:hover{background:rgba(88,166,255,.08);text-decoration:none}
.ft{margin-top:32px;padding:16px 0;color:var(--text-dim);font-size:.75rem;border-top:1px solid var(--border)}
.ft code{background:rgba(88,166,255,.1);padding:1px 5px;border-radius:3px;font-family:var(--mono);font-size:.85em;margin-right:6px}
`;

// ─── Leaderboard ──────────────────────────────────────────────────────
function LB({ d }: { d: any[] }) {
  const { vis, tog, togA, all, none } = useVis();

  return h('table', { className: 'lb' },
    h('thead', null, h('tr', null,
      h('th', { style: { minWidth: 38 } }),
      // Model toggle checkbox — " Model" is a sibling, not a child of <input>
      h('th', { style: { minWidth: 300 } },
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' } },
          h('input', {
            type: 'checkbox',
            checked: all,
            ref: (el: any) => { if (el) el.indeterminate = !all && !none; },
            onChange: (e: any) => togA(e.target.checked),
          }),
          h('span', null, ' Model')
        )
      ),
      h('th', { style: { minWidth: 240 } }, 'Judge Avg'),
      h('th', { style: { minWidth: 240 } }, 'Rule Avg'),
      h('th', { style: { minWidth: 80 } }, 'Latency'),
      h('th', { style: { textAlign: 'center', minWidth: 40 } }, 'N')
    )),
    h('tbody', null, d.map((m: any, i: number) => {
      const medal = i === 0 ? '\ud83e\udd47' : i === 1 ? '\ud83e\udd48' : i === 2 ? '\ud83e\udd49' : '  ' + (i + 1);
      const on = vis.has(m.id);
      return h('tr', {
        key: m.id, onClick: () => tog(m.id),
        style: { cursor: 'pointer', opacity: on ? 1 : 0.32, transition: 'opacity .15s' }
      },
        h('td', { style: { fontWeight: 700, fontSize: 20, width: 32 }, onClick: (e: any) => e.stopPropagation() }, medal),
        h('td', null,
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }, onClick: (e: any) => e.stopPropagation() },
            h('input', { type: 'checkbox', checked: on, onChange: () => tog(m.id) }),
            h('code', { className: 'mcode' }, m.label),
            m.vc > 0 ? h('span', { style: { fontSize: '.65rem', color: 'var(--text-dim)' } }, m.vc + ' judges') : null
          )
        ),
        m.ja !== null
          ? h('td', null, h('span', { className: 'badge ' + sc(m.ja) }, m.ja.toFixed(2)))
          : h('td', null, '\u2014'),
        h('td', null, h('div', { className: 'brow' },
          h('div', { className: 'btrk' },
            h('div', { className: 'bfl', style: { width: Math.min(m.ra * 200, 200) + 'px', background: scol(m.ra) } })
          ),
          h('span', { className: 'blbl' }, m.ra.toFixed(2))
        )),
        h('td', { style: { fontFamily: 'var(--mono)', fontSize: '.8rem' } }, fmt(m.at)),
        h('td', { style: { textAlign: 'center' } }, m.n)
      );
    }))
  );
}

// ─── BenchmarkGroup ───────────────────────────────────────────────────
function BG({ bench, mods, modLabels, ranking }: any) {
  const { vis, tog } = useVis();
  const [open, setOpen] = useState(false);

  return h('div', { style: { marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 16 } },
    // Header bar
    h('div', {
      className: 'grp-h',
      onClick: () => setOpen((p: boolean) => !p),
      role: 'button', 'aria-expanded': open,
      style: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, width: '100%', userSelect: 'none', flexWrap: 'wrap' }
    },
      h('span', { style: { display: 'inline-flex', transition: 'transform .2s ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', fontSize: '.7rem', color: 'var(--accent)', width: 16, flexShrink: 0 } }, '\u25B6'),
      h('span', { style: { fontWeight: 600, color: 'var(--accent)' } }, bench.name),
      h('span', { style: { color: 'var(--text-dim)', fontSize: '.75rem' } }, bench.evalCount + ' evals'),
      h('div', { className: 'mavg' },
        mods.map((m: string, i: number) => {
          if (!vis.has(m)) return null;
          const avg = bench.modelAvgs[m] ?? 0;
          const lbl = modLabels[i];
          return [
            h('span', { key: lbl, onClick: (e: any) => { e.stopPropagation(); tog(m); }, title: 'Toggle' },
              h('span', { className: 'lbl' }, lbl),
              h('span', { className: 'bar', style: { width: Math.round(avg * 200) + 'px', height: 10, background: scol(avg) } }),
              h('span', { className: 'val' }, avg.toFixed(2))
            ),
          ];
        })
      )
    ),

    // Collapsible detail table  (only render when open for perf)
    open ? h('div', { style: { overflowX: 'auto' } },
      h('table', { className: 'comp-t' },
        h('thead', null,
          h('tr', null,
            h('th', { style: { minWidth: 120 } }, 'Sample'),
            mods.map((m: string, i: number) => {
              const mr = ranking.find((r: any) => r.id === m);
              const sub = mr ? ' (' + (mr.ja !== null ? mr.ja : mr.ra).toFixed(2) + ')' : '';
              return h('th', {
                key: m,
                className: vis.has(m) ? '' : 'hid',
                style: { minWidth: 220 }
              }, modLabels[i] + sub);
            })
          )
        ),
        h('tbody', null, bench.rows.map((row: any, ri: number) => {
          const modelCells: any[] = [];
          for (const m of mods) {
            const c = row[m];
            if (!c) {
              modelCells.push(h('td', { key: m, className: vis.has(m) ? '' : 'hid', style: { color: 'var(--text-dim)', verticalAlign: 'top' } }, '\u2014'));
              continue;
            }

            const parts: any[] = [];

            // Score + tooltip
            if (c.judges && c.judges.length > 0) {
              const valid = c.judges.filter((j: any) => j.s !== null);
              const avg = valid.length ? valid.reduce((a: number, j: any) => a + j.s, 0) / valid.length : 0;
              const tipHtml = c.judges.map((j: any) =>
                j.s === null
                  ? '<b>' + esc(j.j) + '</b>: timeout'
                  : '<b>' + esc(j.j) + '</b>: ' + j.s.toFixed(2) + (j.r ? ' \u2014 ' + esc(j.r.slice(0, 120)) : '')
              ).join('<br/>');
              parts.push(h('span', {
                className: 'tip',
                'data-tip': tipHtml,
                dangerouslySetInnerHTML: { __html: '<span class="badge ' + sc(avg) + '">' + avg.toFixed(2) + '</span>' }
              }));
              if (valid.length < c.judges.length) {
                parts.push(h('span', { style: { color: 'var(--text-dim)', fontSize: '.6rem', marginLeft: 6 } }, valid.length + '/' + c.judges.length));
              }
            } else {
              parts.push(h('span', { className: 'badge ' + sc(c.score) }, c.score.toFixed(2)));
            }

            // Time
            parts.push(h('span', { style: { color: 'var(--text-dim)', fontSize: '.6rem', marginLeft: 6 } }, fmt(c.time)));

            // Response
            const respText = (c.resp || '(empty)').slice(0, 200) + ((c.resp || '').length > 200 ? '\u2026' : '');
            parts.push(h('div', {
              style: { fontSize: '.72rem', color: 'var(--text-dim)', background: 'rgba(0,0,0,.25)', padding: '4px 6px', borderRadius: 4, maxHeight: 80, overflowY: 'auto', marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
            }, respText));

            // Error
            if (c.err) {
              parts.push(h('div', { style: { color: 'var(--red)', fontSize: '.6rem', marginTop: 4 } }, '\u26A0\uFE0F ' + (c.err || '').slice(0, 60)));
            }

            modelCells.push(h('td', { key: m, className: vis.has(m) ? '' : 'hid', style: { verticalAlign: 'top' } }, parts));
          }

          return h('tr', { key: ri },
            // Sample cell
            h('td', { style: { verticalAlign: 'top' } },
              row.img ? h('img', { src: row.img, style: { maxWidth: 100, borderRadius: 6, marginBottom: 4, border: '1px solid var(--border)' }, loading: 'lazy' }) : null,
              h('div', { style: { fontSize: '.65rem', color: 'var(--text-dim)', fontFamily: 'var(--mono)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, (row.gt || '').slice(0, 80))
            ),
            ...modelCells
          );
        }))
      )
    ) : null
  );
}

// ─── App ──────────────────────────────────────────────────────────────
export default function ReportApp({ data }: { data: any }) {
  return h(ModelProvider, { top3: data.top3, mods: data.mods },
    h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
    h('h1', { style: { margin: '24px 0 12px', color: 'var(--accent)', fontSize: '1.5rem' } }, 'Leaderboard'),
    h(LB, { d: data.ranking }),
    h('p', { style: { color: 'var(--text-dim)', fontSize: '.75rem', marginBottom: 12 } },
      'Judge avg excludes timed-out judges (' + data.judgesUsed.length + ' total) · Checkboxes toggle columns below'
    ),
    h('h1', { style: { margin: '20px 0 8px', color: 'var(--accent)', fontSize: '1.2rem' } }, 'Detailed Results'),
    ...data.benches.map((b: any) => h(BG, { key: b.name, bench: b, mods: data.mods, modLabels: data.modLabels, ranking: data.ranking })),
    h('h2', { style: { margin: '20px 0 8px', color: 'var(--accent)', fontSize: '1.2rem' } }, 'Artifacts'),
    h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
      h('a', { href: 'results.jsonl', download: true, className: 'art' }, '\uD83D\uDCC4 results.jsonl'),
      h('a', { href: 'judge-details.jsonl', download: true, className: 'art' }, '\uD83D\uDCC4 judge-details.jsonl')
    ),
    h('div', { className: 'ft', dangerouslySetInnerHTML: {
      __html: 'vision-benchmark | ' + data.date + ' | ' + data.judgesUsed.map((j: string) => '<code>' + j + '</code>').join(' ')
    } })
  );
}
