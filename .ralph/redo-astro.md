# Redo Astro migration from scratch

## Checklist
- [x] Create `scripts/gen-data-json.ts` - loads results/ + judge-cache/ → writes `src/data.json`
- [x] Run gen-data-json.ts to produce `src/data.json`
- [x] Create `src/components/ReportApp.tsx` - React component with shared model visibility state
- [x] Create `src/pages/index.astro` - Astro page wrapping ReportApp with `client:load`
- [x] Run `npx astro build` → verify `docs/index.html`
- [x] Copy `results.jsonl` and `judge-details.jsonl` to docs/
- [x] Push to gh-pages branch

## Verification Results
- 1 React island (`ReportApp`) with `client:load`
- 1 leaderboard table with 8 models, 7 `<th>` elements
- 4 benchmark group headers (angle, colored-dots, dense-dots, ocr)
- Model names in SSR output (qwen3-vl-32b-instruct, mimo-v2-omni, gemini-3-flash-preview)
- 9 judges in footer
- Download links for results.jsonl and judge-details.jsonl

## Files in docs/
- `index.html` (10MB) — Astro SSR + React island
- `_astro/ReportApp.CmMUoDks.js` (10KB) — React component
- `_astro/client.BZ43iYDs.js` (185KB) — React runtime
- `_astro/index.DrBtkhmp.js` (7KB) — Astro island hydration
- `results.jsonl` (1.3MB, 4146 lines)
- `judge-details.jsonl` (7MB, 31013 lines)
