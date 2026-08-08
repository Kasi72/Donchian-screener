# Adaptive Donchian Screener Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tested Next.js web screener that parses an NSE CSV, fetches completed Yahoo Finance OHLCV, auto-selects a causal Donchian period, and emits reproducible BUY recommendations with entry, stop, and exit targets.

**Architecture:** A Next.js App Router project keeps Yahoo requests and signal calculations server-side. Focused domain modules parse universes, normalize candles, detect confirmed anchors, evaluate Donchian rollovers, and calculate risk levels; API routes orchestrate scans while React components present upload, progress, results, explanations, and export.

**Tech Stack:** Next.js 15+, React 19, TypeScript, Tailwind CSS, `yahoo-finance2`, Papa Parse, Zod, Vitest, Testing Library, Playwright.

## Global Constraints

- Bullish signals only and completed candles only.
- Accept one CSV per scan; a new upload replaces the previous universe.
- Support 5m, 15m, 1h, 1d, 1wk, and 1mo.
- Yahoo access occurs only on the server.
- Never convert missing or insufficient data into `NO_SIGNAL`.
- `Validated Model BUY` remains disabled until a model passes the acceptance gate.
- Every recommendation stores its strategy version and data timestamp.
- First release screens NSE cash/index underlyings, not individual derivative contracts.

---

## File map

```text
app/page.tsx                         scan workspace
app/api/universe/parse/route.ts      CSV validation endpoint
app/api/scans/route.ts               scan orchestration endpoint
app/api/scans/export/route.ts        results CSV export
components/scan-form.tsx             upload and settings
components/scan-results.tsx          recommendations table
components/signal-details.tsx        calculation explanation
lib/domain/types.ts                  shared domain contracts
lib/universe/parse-csv.ts            NSE CSV parser
lib/market/yahoo-provider.ts         Yahoo chart adapter
lib/market/normalize-candles.ts      completed-candle cleaning
lib/signals/atr.ts                   ATR calculation
lib/signals/pivots.ts                causal pivot detection
lib/signals/donchian.ts              exact channel windows
lib/signals/period-selector.ts        anchor scoring and N selection
lib/signals/risk-levels.ts           entry, stop, targets
lib/signals/scan-symbol.ts           per-symbol pipeline
lib/signals/strategy-config.ts       frozen v1 parameters
tests/**                             unit/integration fixtures
e2e/scan.spec.ts                     browser acceptance test
```

### Task 1: Scaffold the tested application

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `vitest.config.ts`, `app/layout.tsx`, `app/globals.css`
- Create: `.gitignore`, `.env.example`, `README.md`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Produces: Next.js application and `npm test` command used by every later task.

- [ ] **Step 1: Write a failing smoke test**

```ts
import { describe, expect, it } from "vitest";
import { STRATEGY_VERSION } from "@/lib/signals/strategy-config";

describe("application", () => {
  it("publishes a frozen strategy version", () => {
    expect(STRATEGY_VERSION).toBe("rules-v1");
  });
});
```

- [ ] **Step 2: Run `npm test` and verify it fails because the project/module is absent.**
- [ ] **Step 3: Scaffold Next.js, configure Vitest aliases, and export `STRATEGY_VERSION = "rules-v1"`.**
- [ ] **Step 4: Run `npm test`, `npm run lint`, and `npm run build`; require all three to pass.**
- [ ] **Step 5: Initialize Git, add only application/spec files, and commit `chore: scaffold adaptive Donchian screener`.**

### Task 2: Parse and validate NSE CSV universes

**Files:**
- Create: `lib/domain/types.ts`
- Create: `lib/universe/parse-csv.ts`
- Create: `app/api/universe/parse/route.ts`
- Test: `tests/universe/parse-csv.test.ts`

**Interfaces:**
- Produces: `parseUniverseCsv(csv: string): UniverseParseResult`.

```ts
export interface UniverseInstrument {
  symbol: string;
  yahooSymbol: string;
  companyName?: string;
  industry?: string;
  series?: string;
  isin?: string;
}

export interface UniverseParseResult {
  instruments: UniverseInstrument[];
  rejected: Array<{ row: number; symbol?: string; reason: string }>;
  duplicateCount: number;
  totalRows: number;
}
```

- [ ] **Step 1: Test five-column parsing, Symbol-only parsing, `.NS` mapping, `EQ` filtering, trimming, duplicates, and individual rejected rows using inline CSV fixtures.**
- [ ] **Step 2: Run the parser tests and verify missing-module failures.**
- [ ] **Step 3: Implement header-normalized Papa Parse ingestion and Zod validation with no whole-file failure for bad rows.**
- [ ] **Step 4: Implement multipart POST parsing in `/api/universe/parse` and return `UniverseParseResult`.**
- [ ] **Step 5: Run parser tests and the complete test suite; commit `feat: parse NSE screening universes`.**

### Task 3: Fetch and normalize completed Yahoo candles

**Files:**
- Create: `lib/market/provider.ts`
- Create: `lib/market/yahoo-provider.ts`
- Create: `lib/market/normalize-candles.ts`
- Test: `tests/market/normalize-candles.test.ts`
- Test: `tests/market/yahoo-provider.test.ts`

**Interfaces:**
- Consumes: normalized Yahoo symbols.
- Produces:

```ts
export type Timeframe = "5m" | "15m" | "1h" | "1d" | "1wk" | "1mo";
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }
export interface CandleResponse { status: "OK" | "INSUFFICIENT_HISTORY" | "SYMBOL_NOT_FOUND" | "PROVIDER_RATE_LIMITED" | "STALE_DATA" | "INVALID_CANDLES"; candles: Candle[]; asOf: number; }
export interface MarketDataProvider { getCandles(symbol: string, timeframe: Timeframe, now?: Date): Promise<CandleResponse>; }
```

- [ ] **Step 1: Test chronological sorting, duplicate removal, null rejection, current-candle exclusion, stale data, and insufficient history.**
- [ ] **Step 2: Verify tests fail before implementation.**
- [ ] **Step 3: Implement pure candle normalization and interval-close calculations for Asia/Kolkata.**
- [ ] **Step 4: Implement `YahooMarketDataProvider` with `includePrePost: false`, retryable error classification, and server-only import.**
- [ ] **Step 5: Mock Yahoo responses, run tests/build, and commit `feat: fetch completed Yahoo candles`.**

### Task 4: Implement causal pivots and exact Donchian mathematics

**Files:**
- Create: `lib/signals/atr.ts`
- Create: `lib/signals/pivots.ts`
- Create: `lib/signals/donchian.ts`
- Create: `lib/signals/strategy-config.ts`
- Test: `tests/signals/atr.test.ts`
- Test: `tests/signals/pivots.test.ts`
- Test: `tests/signals/donchian.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PivotLow { index: number; time: number; low: number; prominenceAtr: number; recoveryAtr: number; confirmedAt: number; }
export function findConfirmedPivotLows(candles: Candle[], evaluationIndex: number): PivotLow[];
export function lowerChannel(candles: Candle[], endIndex: number, period: number): number;
export function bullishRollover(candles: Candle[], endIndex: number, period: number): { passed: boolean; currentLdc: number; previousLdc: number };
```

- [ ] **Step 1: Write hand-calculated ATR, pivot-confirmation, 51-bar rollover, 94-bar rollover, off-by-one, equal-low, and future-candle-invariance tests.**
- [ ] **Step 2: Run and verify the signal tests fail.**
- [ ] **Step 3: Implement Wilder ATR and pivot detection whose `confirmedAt` never exceeds `evaluationIndex - 1`.**
- [ ] **Step 4: Implement exact inclusive Donchian windows and integer-tick equality.**
- [ ] **Step 5: Run signal/property tests and commit `feat: implement causal Donchian rollover`.**

### Task 5: Select the auto period and calculate trade levels

**Files:**
- Create: `lib/signals/period-selector.ts`
- Create: `lib/signals/risk-levels.ts`
- Test: `tests/signals/period-selector.test.ts`
- Test: `tests/signals/risk-levels.test.ts`

**Interfaces:**
- Consumes: completed candles and confirmed pivots.
- Produces:

```ts
export interface PeriodCandidate { anchor: PivotLow; period: number; score: number; currentLdc: number; previousLdc: number; }
export function selectRulesPeriod(candles: Candle[], signalIndex: number): { selected?: PeriodCandidate; candidates: PeriodCandidate[] };
export interface TradeLevels { entry: number; stop: number; target1: number; target2: number; reactionHigh: number; rewardRisk: number; }
export function calculateTradeLevels(candles: Candle[], signalIndex: number, anchorIndex: number, tickSize: number): TradeLevels | null;
```

- [ ] **Step 1: Test that only independently confirmed anchors create candidates and that the selected period is the highest frozen structural score.**
- [ ] **Step 2: Test tick rounding, ATR-buffered stop, 1R/2R targets, inadequate reaction-high rejection, and zero-risk rejection.**
- [ ] **Step 3: Run tests and verify failure.**
- [ ] **Step 4: Implement the versioned score and deterministic tie-breaking.**
- [ ] **Step 5: Implement levels and run all tests; commit `feat: auto-select periods and trade levels`.**

### Task 6: Orchestrate scans and export recommendations

**Files:**
- Create: `lib/signals/scan-symbol.ts`
- Create: `lib/scans/run-scan.ts`
- Create: `app/api/scans/route.ts`
- Create: `app/api/scans/export/route.ts`
- Test: `tests/scans/run-scan.test.ts`

**Interfaces:**
- Produces:

```ts
export interface BuyRecommendation { recommendation: "BUY"; symbol: string; yahooSymbol: string; timeframe: Timeframe; signalTime: number; autoPeriod: number; probability: null; entry: number; stop: number; target1: number; target2: number; currentLdc: number; previousLdc: number; anchorTime: number; strategyVersion: "rules-v1"; dataAsOf: number; }
export interface ScanItemResult { symbol: string; status: "BUY" | "NO_SIGNAL" | CandleResponse["status"]; recommendation?: BuyRecommendation; message?: string; }
```

- [ ] **Step 1: Test BUY, NO_SIGNAL, provider failure, insufficient history, bounded concurrency, stable ordering, and partial completion.**
- [ ] **Step 2: Verify failing integration tests.**
- [ ] **Step 3: Implement the per-symbol pipeline and batch runner with concurrency 6.**
- [ ] **Step 4: Implement JSON scan endpoint and CSV export with formula-injection-safe cell escaping.**
- [ ] **Step 5: Run complete tests/build and commit `feat: run and export recommendation scans`.**

### Task 7: Build the non-technical scan interface

**Files:**
- Create: `app/page.tsx`
- Create: `components/scan-form.tsx`
- Create: `components/scan-results.tsx`
- Create: `components/signal-details.tsx`
- Modify: `app/globals.css`
- Test: `tests/components/scan-form.test.tsx`
- Test: `tests/components/scan-results.test.tsx`

**Interfaces:**
- Consumes: universe and scan APIs.
- Produces: usable upload-to-export browser workflow.

- [ ] **Step 1: Test accessible upload, replacement behavior, timeframe selection, validation summary, disabled scan states, BUY level rendering, data-error labels, details, and export.**
- [ ] **Step 2: Run component tests and verify failure.**
- [ ] **Step 3: Implement a calm, responsive workspace with visible progress and plain-language status copy.**
- [ ] **Step 4: Add BUY cards/table, exact calculation details, risk disclaimer, and model-mode disabled explanation.**
- [ ] **Step 5: Run accessibility-oriented component tests, lint, and build; commit `feat: add screener workspace`.**

### Task 8: End-to-end verification and deliverable

**Files:**
- Create: `e2e/scan.spec.ts`
- Create: `playwright.config.ts`
- Modify: `README.md`
- Create: `outputs/adaptive-donchian-screener.zip`

**Interfaces:**
- Consumes: complete application.
- Produces: verified runnable project and packaged deliverable.

- [ ] **Step 1: Add an E2E fixture based on the supplied five-column CSV and mocked Yahoo responses containing one BUY, one NO_SIGNAL, and one provider failure.**
- [ ] **Step 2: Test upload, preview, scan, BUY levels, error isolation, detail explanation, and CSV export in Chromium.**
- [ ] **Step 3: Run `npm test`, `npm run lint`, `npm run build`, and `npm run test:e2e`; require all to pass.**
- [ ] **Step 4: Run a live Yahoo smoke scan on a small symbol subset and record provider limitations without making live-market profitability claims.**
- [ ] **Step 5: Update setup documentation, package the project excluding dependencies/secrets, and commit `docs: finalize screener delivery`.**

## Self-review result

- Spec coverage: Stage A is fully covered; Stage B/C model training remains a later implementation plan because it is independently testable and depends on accumulated point-in-time data.
- Placeholder scan: no implementation placeholders remain.
- Type consistency: `Timeframe`, `CandleResponse`, `PeriodCandidate`, `TradeLevels`, and `BuyRecommendation` signatures are shared consistently across tasks.
