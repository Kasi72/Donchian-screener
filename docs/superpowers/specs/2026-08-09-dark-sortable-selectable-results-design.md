# Dark theme and interactive results table design

Date: 2026-08-09  
Status: implemented

## Objective

Improve Reversal Radar's usability without changing scan calculations or API result semantics. Add a persistent theme selector and make the results table sortable, filterable, and row-selectable, including selected-row export.

## Theme behavior

- Place a labelled theme control in the site header with `Light`, `Dark`, and `System` choices.
- `System` follows `prefers-color-scheme` and updates if the operating-system preference changes.
- Explicit Light/Dark choices override the operating system.
- Persist the choice in `localStorage` under a versioned application key.
- Apply the effective theme before React hydration through an inline bootstrap script to avoid a light-theme flash.
- Use semantic CSS variables for page, surface, elevated surface, text, muted text, borders, controls, BUY, warning, error, focus, hover, and expanded-detail colors.
- Dark mode uses charcoal/slate surfaces with readable contrast and the existing green BUY identity. It must not invert screenshots or use pure black as the main surface.
- Native form controls receive the appropriate `color-scheme`.

## Table model

Each result has a stable selection identity derived from its symbol plus original scan position. Table state is client-side because the universe is capped at 500 rows.

### Sorting

- Instrument, status, entry reference, stop, target 1, target 2, auto period, and data-as-of headers are sortable buttons.
- First activation sorts ascending; second activation sorts descending.
- The active header exposes `aria-sort` and a visible direction indicator.
- Missing values always sort after populated values in either direction.
- Equal values retain original scan order.

### Filtering

- A compact table toolbar provides instrument text search and status filtering.
- Numeric column filters accept optional minimum/maximum values for entry, stop, targets, and auto period.
- Date filtering accepts optional from/to values for data-as-of.
- Filters combine with logical AND and update instantly.
- A `Clear table filters` action restores the unfiltered result set.
- Existing scan-level result-category controls remain compatible; table filters operate on the results passed into the table.
- The toolbar reports the visible-row count.

### Row selection

- Every visible result row has a labelled checkbox.
- The header checkbox selects or clears all currently visible rows only.
- Its indeterminate state represents a partially selected visible set.
- Filtering never discards selections that are temporarily hidden.
- Replacing scan results removes selections that no longer exist.
- The toolbar reports `N selected` and provides `Clear selection`.
- Expanded calculation details remain attached to the correct row after sorting/filtering.

## Export behavior

- `Export filtered` exports all rows remaining after the existing scan-level filter and the new table filters.
- `Export selected` is enabled only when at least one row is selected and exports selected rows, including selected rows temporarily hidden by table filters.
- The existing server CSV endpoint and recommendation schema remain the single serialization path.
- Export failures use the existing accessible error summary.

To support this, the table reports its ordered filtered rows and selected rows to the parent form. The parent owns export requests while the table owns interaction state.

## Responsive and accessible interaction

- Preserve the horizontally scrollable table region on narrow screens.
- Keep the selection checkbox and instrument columns first.
- Toolbar controls wrap without creating document-level horizontal overflow.
- All controls have visible labels, 44px minimum targets where practical, keyboard focus styles, and programmatic names.
- Sort state is not communicated by color alone.
- Theme controls work without pointer input and expose the selected state.
- BUY, warning, error, muted text, borders, and focus rings meet readable light/dark contrast.

## Component boundaries

- `ThemeSelector`: owns persisted preference and effective-theme synchronization.
- Root layout bootstrap: applies the stored/effective theme before hydration.
- `ScanResults`: owns table filters, sorting, stable row selection, visible rows, and row expansion.
- `ScanForm`: owns scan lifecycle and both export requests; receives table projections through a callback.
- Small pure table helpers define column values, comparisons, filters, and selection projections for focused tests.

## Error and state transitions

- A new upload, timeframe change, or new scan clears prior table projections and selection.
- A malformed persisted theme value falls back to `System`.
- Empty filtered results show `No results match these table filters` while retaining filter controls and clear action.
- Selected export is disabled during parsing, scanning, or another export.
- Sorting/filtering never mutate the canonical API response array.

## Verification and acceptance criteria

1. Theme choice persists across reload and System reacts to media-query changes.
2. No incorrect-theme flash occurs before hydration.
3. Every requested data column sorts ascending and descending with missing values last.
4. Text, status, numeric range, and date filters combine correctly.
5. Header select-all affects visible rows only and exposes checked/indeterminate/unchecked states.
6. Selection survives temporary filtering and clears when results are replaced.
7. Export filtered and export selected send the exact intended rows to the existing endpoint.
8. Details expansion stays associated with its result after sort/filter operations.
9. Light and dark desktop/mobile browser tests show no page-level overflow; table scrolling remains intentional.
10. Existing scan, signal, data-failure, cancellation, and CSV behavior remains green.
11. Full unit, lint, typecheck, E2E, production build, and canonical bundle checks pass.

## Out of scope

- Server-side pagination or database-backed table state
- Column drag/reordering or column visibility controls
- Bulk trading/order actions
- Changes to Donchian math, period selection, Yahoo retrieval, or recommendation levels
