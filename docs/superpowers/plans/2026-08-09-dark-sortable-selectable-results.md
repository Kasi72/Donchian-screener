# Dark Theme and Interactive Results Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent Light/Dark/System theme and an accessible sortable, filterable, row-selectable results table with filtered and selected CSV exports.

**Architecture:** A pre-hydration script applies the effective theme, while a focused client `ThemeSelector` owns preference persistence and system-theme synchronization. Pure table projection helpers provide stable filtering/sorting/selection behavior; `ScanResults` owns table interaction state and reports filtered/selected projections to `ScanForm`, which remains responsible for API exports.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, CSS custom properties, Vitest, Testing Library, Playwright Chromium.

## Global Constraints

- Do not change Donchian calculations, Yahoo retrieval, recommendation levels, or scan API semantics.
- Theme choices are exactly `Light`, `Dark`, and `System`; persist under a versioned key and fall back to `System` on malformed values.
- Apply the effective theme before hydration and support live `prefers-color-scheme` changes in System mode.
- Sorting and filtering are client-side for at most 500 scan results and must not mutate the API response array.
- Missing table values sort after populated values in both directions; ties preserve original scan order.
- Header select-all affects currently visible rows only; hidden selections persist until results are replaced or selection is cleared.
- Export filtered sends currently table-filtered rows; export selected sends all selected rows including temporarily hidden selections.
- Preserve accessible names, keyboard use, visible focus, intentional horizontal table scrolling, and no page-level mobile overflow.

---

### Task 1: Theme bootstrap and selector

**Files:**
- Create: `components/theme-selector.tsx`
- Create: `lib/theme/theme.ts`
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Create: `tests/theme/theme.test.ts`
- Create: `tests/components/theme-selector.test.tsx`

**Interfaces:**
- Produces: `type ThemePreference = "light" | "dark" | "system"`, `THEME_STORAGE_KEY`, `resolveTheme(preference, systemDark): "light" | "dark"`, and `<ThemeSelector />`.
- Root layout sets `data-theme="light|dark"` on `<html>` before hydration; CSS consumes semantic variables only.

- [ ] **Step 1: Write failing pure theme tests**

Cover valid preferences, malformed-storage fallback, and `System` resolution for both media-query states in `tests/theme/theme.test.ts`.

- [ ] **Step 2: Run the pure tests and verify failure**

Run: `npm test -- --run tests/theme/theme.test.ts`  
Expected: FAIL because `lib/theme/theme.ts` does not exist.

- [ ] **Step 3: Implement theme types, validation, resolution, and bootstrap source**

Export a bootstrap string that reads `reversal-radar:theme:v1`, validates the value, resolves System through `matchMedia`, and sets `document.documentElement.dataset.theme` plus `style.colorScheme` inside a guarded IIFE.

- [ ] **Step 4: Write failing selector interaction tests**

Test accessible Light/Dark/System controls, persisted selection, dataset updates, malformed fallback, and System media-query change handling with a controllable `matchMedia` mock.

- [ ] **Step 5: Implement `ThemeSelector` and mount it in the header**

Use three radio-style buttons inside a labelled group. Initialize from storage after mount, update storage/dataset/color-scheme on selection, and subscribe to media changes only while System is selected.

- [ ] **Step 6: Add light/dark semantic tokens and replace literal surfaces**

Define `[data-theme="light"]` and `[data-theme="dark"]` values for background, surfaces, inputs, details, text, muted, borders, BUY, warning, error, focus, and hover. Replace `#fff`, `#f7faf8`, and other theme-sensitive literals with variables.

- [ ] **Step 7: Run focused tests, lint, and typecheck**

Run: `npm test -- --run tests/theme/theme.test.ts tests/components/theme-selector.test.tsx && npm run lint && npm run typecheck`  
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add app components/theme-selector.tsx lib/theme tests/theme tests/components/theme-selector.test.tsx
git commit -m "feat: add persistent light dark system theme"
```

### Task 2: Pure table projection helpers

**Files:**
- Create: `lib/results/table-state.ts`
- Create: `tests/results/table-state.test.ts`

**Interfaces:**
- Consumes: `ScanItemResult`.
- Produces: `ResultColumn`, `SortState`, `TableFilters`, `rowId(result, originalIndex)`, `filterResults(indexedResults, filters)`, `sortResults(indexedResults, sort)`, and `projectResults(results, filters, sort)`.
- Indexed rows retain `{ id, originalIndex, result }` so stable ordering and selection survive projections.

- [ ] **Step 1: Write failing projection tests**

Cover symbol/status filters, every numeric min/max filter, date range, combined AND behavior, ascending/descending values, missing-last in both directions, stable ties, and input immutability.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --run tests/results/table-state.test.ts`  
Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement typed filters and column accessors**

Use explicit accessors for symbol, status text/key, entry, stop, target1, target2, autoPeriod, and dataAsOf. Normalize text case and treat blank range inputs as absent.

- [ ] **Step 4: Implement stable filtering and sorting**

Decorate results once with original indices, filter without mutation, and compare populated values before missing values regardless of direction. Use original index for ties.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -- --run tests/results/table-state.test.ts && npm run typecheck`  
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/results/table-state.ts tests/results/table-state.test.ts
git commit -m "feat: add deterministic result table projections"
```

### Task 3: Sortable, filterable, selectable table UI

**Files:**
- Modify: `components/scan-results.tsx`
- Modify: `components/signal-details.tsx`
- Modify: `app/globals.css`
- Modify: `tests/components/scan-results.test.tsx`

**Interfaces:**
- Consumes: `results: ScanItemResult[]` and `onProjectionChange(projection: { filtered: ScanItemResult[]; selected: ScanItemResult[] }): void`.
- Uses Task 2 helpers for every projection.
- Produces accessible toolbar, sortable headers, row checkboxes, select-all-visible, selected count, and projection callback.

- [ ] **Step 1: Write failing table interaction tests**

Test header sorting twice, instrument/status/numeric/date filters, clear filters, visible count, row selection, select-all-visible, indeterminate header state, hidden-selection persistence, clear selection, and correct details association after sorting.

- [ ] **Step 2: Run component tests and verify failure**

Run: `npm test -- --run tests/components/scan-results.test.tsx`  
Expected: FAIL because the new controls and callback do not exist.

- [ ] **Step 3: Implement toolbar and sortable headers**

Render labelled filter controls above the scroll region. Use real buttons inside headers, `aria-sort` on active headers, and visible `↑`/`↓` indicators.

- [ ] **Step 4: Implement stable row selection**

Track selected row IDs in a `Set`, reconcile them when `results` changes, implement labelled row checkboxes, and set the header checkbox's DOM `indeterminate` property through a ref/effect.

- [ ] **Step 5: Report filtered and selected projections**

Call `onProjectionChange` in an effect when projections change. Return selected results in canonical input order, not visual sort order, so exports remain deterministic.

- [ ] **Step 6: Style the toolbar, sort buttons, checkboxes, and dark table states**

Keep checkbox/instrument columns first and sticky where practical, wrap toolbar controls on mobile, preserve the table's horizontal scrolling, and avoid page-level overflow.

- [ ] **Step 7: Run focused tests, lint, and typecheck**

Run: `npm test -- --run tests/components/scan-results.test.tsx tests/results/table-state.test.ts && npm run lint && npm run typecheck`  
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add components/scan-results.tsx components/signal-details.tsx app/globals.css tests/components/scan-results.test.tsx
git commit -m "feat: add interactive selectable results table"
```

### Task 4: Filtered and selected export integration

**Files:**
- Modify: `components/scan-form.tsx`
- Modify: `tests/components/scan-form.test.tsx`

**Interfaces:**
- Consumes: Task 3 projection callback.
- Produces: `Export filtered` and `Export selected` actions that reuse `/api/scans/export` and the existing accessible error lifecycle.

- [ ] **Step 1: Write failing export-state tests**

Verify filtered export sends only projected filtered rows, selected export sends hidden selected rows, selected export disables at zero selection and during busy phases, and upload/timeframe/new-scan replacement clears projections.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run tests/components/scan-form.test.tsx`  
Expected: FAIL on missing selected export and projection wiring.

- [ ] **Step 3: Refactor export into one parameterized function**

Implement `exportRows(rows, filename)` using the existing request ownership, abort, blob URL, connected anchor, error summary, and URL cleanup behavior.

- [ ] **Step 4: Wire table projections and both actions**

Store filtered/selected projections in the parent, reset them with result lifecycle changes, pass the callback to `ScanResults`, and render precise counts beside the actions.

- [ ] **Step 5: Run focused tests, lint, and typecheck**

Run: `npm test -- --run tests/components/scan-form.test.tsx tests/components/scan-results.test.tsx && npm run lint && npm run typecheck`  
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add components/scan-form.tsx tests/components/scan-form.test.tsx
git commit -m "feat: export filtered and selected scan rows"
```

### Task 5: Browser verification, documentation, GitHub, and Vercel

**Files:**
- Modify: `e2e/scan.spec.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-09-dark-sortable-selectable-results-design.md`

**Interfaces:**
- Validates the complete public workflow; no new production interface.

- [ ] **Step 1: Add failing browser scenarios**

Cover Dark persistence across reload, System media emulation, sort direction, combined filters, row selection, select-all-visible, selected export content, filtered export content, details after sort, desktop overflow, and 390px mobile overflow.

- [ ] **Step 2: Run E2E and verify failure before final UI fixes**

Run: `npm run test:e2e`  
Expected: new scenarios fail until integration is complete.

- [ ] **Step 3: Fix browser-visible accessibility/responsive defects and document usage**

Update README with theme and table instructions. Mark the design status implemented only after browser scenarios pass.

- [ ] **Step 4: Run the complete release gate**

Run: `npm run release:check`  
Expected: unit/component/API tests, lint, typecheck, E2E, cleanup probe, production build, and canonical bundle audit all pass.

- [ ] **Step 5: Commit final verification changes**

```bash
git add e2e/scan.spec.ts README.md docs/superpowers/specs/2026-08-09-dark-sortable-selectable-results-design.md
git commit -m "test: verify themed interactive result workflow"
```

- [ ] **Step 6: Push and merge through GitHub**

Push `codex/dark-sortable-results`, create a PR to `main` with release evidence, confirm it is mergeable, and merge without force-pushing.

- [ ] **Step 7: Deploy production to Vercel**

Run `vercel deploy --prod --yes`, confirm status `READY`, verify the public homepage, exercise CSV parsing and a small live Yahoo scan, inspect recent error logs, and report the canonical production URL.
