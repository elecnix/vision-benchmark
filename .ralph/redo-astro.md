# Redo Astro migration from scratch

## Checklist
- [x] Create `scripts/gen-data-json.ts` - loads results/ + judge-cache/ → writes `src/data.json`
- [x] Run gen-data-json.ts to produce `src/data.json`
- [x] Create `src/components/ReportApp.tsx` - React component with shared model visibility state
- [x] Create `src/pages/index.astro` - Astro page wrapping ReportApp with `client:load`
- [x] Run `npx astro build` → verify `docs/index.html`
- [x] Copy `results.jsonl` and `judge-details.jsonl` to docs/
- [ ] Push `docs/` to gh-pages branch
