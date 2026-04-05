# Redo Astro migration from scratch

## Context
- Astro + React packages installed (`@astrojs/react`, `react`, `astro`)
- `astro.config.mjs` exists on disk
- `gh-pages` is the deploy branch, `main` has the working report code

## Goal
Rebuild the Astro report (React islands) and push `docs/` to gh-pages.

## Checklist
1. [ ] Create `scripts/gen-data-json.ts` - loads results/ + judge-cache/ → writes `src/data.json`
2. [ ] Run gen-data-json.ts to produce `src/data.json`
3. [ ] Create `src/components/ReportApp.tsx` - React component with:
   - Shared model visibility state (top3 default, toggle from leaderboard)
   - Leaderboard with checkboxes
   - Collapsible benchmark groups with expandable detail tables
   - Model column toggle synced across all tables
4. [ ] Create `src/pages/index.astro` - Astro page wrapping ReportApp with `client:load`
5. [ ] Run `npx astro build` → verify `docs/index.html`
6. [ ] Push `docs/` to gh-pages branch

## Notes
- The existing `scripts/generate-report.ts` has working data loading code (loadResults, loadJ). Reuse that logic but output to `src/data.json` instead of HTML string concat.
- React version is 19.x (from pnpm install)
- Use plain JS/React.createElement in the component to avoid Babel Standalone issues