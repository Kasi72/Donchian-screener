# Donchian Reversal Screener

Donchian Reversal Screener, by Dr KKR, is a completed-candle, bullish Donchian reversal screener for NSE cash equities and supported indices. It accepts an uploaded stock universe, retrieves OHLCV data from Yahoo Finance, selects a causal structural lookback for each instrument, and reports auditable BUY reference levels without hiding no-signal or data-quality outcomes.

> **Research software—not investment advice.** A `BUY` result means the deterministic `rules-v1` conditions were satisfied on a completed candle. It is not a promise of execution, profitability, or future performance.

## Highlights

- Bullish signals only, evaluated after the signal candle closes
- NSE cash-equity CSV uploads and common index aliases
- `5m`, `15m`, `1h`, `1d`, `1wk`, and `1mo` timeframes
- Causal, structure-derived Donchian period selection—no arbitrary fixed `51` or `94`
- Entry reference, protective stop, two targets, reaction high, and planned reward/risk
- NSE tick-size policy, trading-session checks, holiday handling, and stale-data detection
- Raw Yahoo OHLC across every timeframe so Donchian lengths match an unadjusted TradingView chart
- Per-symbol fault isolation, cancellation, bounded concurrency, retries, throttling, and caching
- Sortable/filterable results with CSV export of the currently visible rows
- Calculation details containing score lineage, adjustment mode, tick policy, and anchor rationale

## Strategy definition

For signal candle `t` and selected period `N`:

```text
CurrentLDC(t, N)  = min(Low[t-N+1 ... t])
PreviousLDC(t, N) = min(Low[t-N ... t-1])
```

The bullish rollover condition is:

```text
CurrentLDC(t, N) > PreviousLDC(t, N)
Low[t] == CurrentLDC(t, N)     (at the instrument's valid tick size)
Close[t] > Low[t]
```

The first inequality indicates that an older channel low has rolled out. The second requires the completed signal candle to establish the current lower channel boundary. The final condition rejects candles closing exactly at their low.

### How the automatic period is selected

The application does not search arbitrary periods until it finds a match. That would create circular, overfit signals. Instead it:

1. Identifies independently confirmed pivot-low anchors using only information available by the signal candle.
2. Converts each eligible anchor's distance from the signal candle into a candidate period.
3. Tests the Donchian rollover for those structural candidates.
4. Ranks valid candidates with the versioned `structural-v1` score.
5. Selects the highest-ranked candidate using deterministic tie-breaks.

The score records normalized pivot prominence, recovery, recency, retests, relative volume, and a neutral higher-timeframe component. Higher-timeframe agreement is explicitly unavailable in this release and contributes zero—it is not silently inferred.

### Trade levels

- **Entry reference:** completed signal-candle close, rounded to the applicable NSE tick
- **Stop:** below the signal low using a volatility-aware buffer
- **Target 1:** one planned risk unit when compatible with the prior reaction structure
- **Target 2:** the farther structural/risk objective calculated by `rules-v1`

The displayed entry is a reference, not a guaranteed fill. Actual execution occurs at the next obtainable price. Skip a gap that reduces reward/risk below your own minimum.

## Supported instruments

| Input | Support | Yahoo mapping |
|---|---:|---|
| NSE cash equity with `Series=EQ` | Yes | `<SYMBOL>.NS` |
| `NIFTY` or `NIFTY50` | Yes | `^NSEI` |
| `BANKNIFTY` or `NIFTYBANK` | Yes | `^NSEBANK` |
| `INDIAVIX` | Yes | `^INDIAVIX` |
| Explicit built-in Yahoo index symbols | Yes | Preserved |
| Individual futures/options contracts | No | Rejected |
| Non-`EQ` cash series | No | Rejected |

F&O analysis is performed through the cash/index underlying. Expiring futures and options contracts are intentionally excluded because contract-specific continuity, adjustment, liquidity, expiry, and tick metadata require a dedicated derivatives data model.

## CSV format

The standard NSE five-column format is supported:

```csv
Company Name,Industry,Symbol,Series,ISIN Code
Reliance Industries Ltd,Energy,RELIANCE,EQ,INE002A01018
Tata Consultancy Services,IT Services,TCS,EQ,INE467B01029
```

A `Symbol`-only file is also accepted:

```csv
Symbol
RELIANCE
TCS
NIFTY
```

Parsing rules:

- `Symbol` is required, trimmed, and uppercased.
- If a `Series` column exists, equities must be `EQ`; supported indices may leave it blank.
- Duplicate symbols collapse to the first valid occurrence.
- Recognizable futures/options contract symbols are rejected.
- A replacement upload clears the previous universe and results.
- Scan requests are capped at 500 unique instruments.

## Getting started

### Prerequisites

- Node.js 20.9 or newer
- npm
- Network access to Yahoo Finance

### Local development

```bash
git clone https://github.com/Kasi72/Donchian-screener.git
cd Donchian-screener
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), upload a CSV, choose a timeframe, and select **Scan for BUY signals**.

No application secrets or environment variables are required.

### Theme

Use the **Light**, **Dark**, or **System** control in the header. Light and Dark remain selected after a reload. System follows the operating-system color preference, including changes made while the page is open.

### Production build

```bash
npm ci
npm run build
npm start
```

The application is a Next.js server application. Market-data access remains server-side; the Yahoo provider is not bundled into the browser.

## Reading the results

Every uploaded instrument receives a row. A missing BUY is not silently discarded.

| Status | Meaning |
|---|---|
| `BUY` | Completed candle satisfied the causal `rules-v1` setup |
| `NO_SIGNAL` / `OK` | Valid data, but no completed-candle BUY setup |
| `INSUFFICIENT_HISTORY` | Too few valid completed candles |
| `SYMBOL_NOT_FOUND` | Yahoo could not resolve the instrument |
| `PROVIDER_RATE_LIMITED` | Yahoo throttled the request |
| `PROVIDER_TIMEOUT` | Per-symbol data deadline expired |
| `STALE_DATA` | Latest candle is older than the expected NSE completion |
| `INVALID_CANDLES` | Malformed, off-session, mixed-adjustment, or otherwise invalid feed |
| `DATA_QUALITY_LIMITATION` | Calendar/source coverage cannot support a reliable calculation |
| `INVALID_INSTRUMENT` | Identity is unsupported or contract-like |
| `TICK_SIZE_UNRESOLVED` | Required NSE tick metadata could not be determined |
| `PROVIDER_ERROR` | Unexpected provider or evaluation failure isolated to that symbol |

Expand **Details** on a BUY row to review the precise Donchian values, selected anchor, adjustment mode, tick size and policy, structural score, reward/risk, strategy version, and data timestamp.

### Sorting, filtering, selection, and export

- Select a sortable column heading to sort ascending; select it again to sort descending. The arrow and accessible sort state identify the active direction.
- Combine instrument, status, numeric minimum/maximum, and data-as-of date filters. **Clear table filters** restores every result.
- Select individual rows, or use the header checkbox to select or clear all rows currently visible. A selection remains active when a filter temporarily hides it; **Clear selection** removes all selections.
- **Export filtered** downloads the rows currently visible in their displayed order. **Export selected** downloads every selected row, including selected rows hidden by the current table filters.
- On narrow screens, scroll the results table horizontally. The page itself remains fixed-width while the selection and instrument columns stay pinned for context.

## Data integrity and operational safeguards

- Only completed NSE-session candles can reach signal evaluation.
- Yahoo zero-volume flat placeholders and wholly empty OHLCV rows are removed before session validation and never count toward an automatic period. Partially malformed candles still fail closed.
- Intraday timestamps must align with valid session intervals; the shortened final hourly bar closes at 15:30 IST.
- Weekends, known holidays, and modeled special sessions are handled in Asia/Kolkata time. Yahoo hourly bars aligned to the regular grid are accepted only when their interval overlaps a modeled special-session window.
- Historical aggregate candles can predate the maintained holiday calendar; the current expected close remains calendar-bound.
- Partially malformed feeds fail closed as `INVALID_CANDLES` rather than dropping bad rows and continuing to a BUY.
- All timeframes use raw OHLC. This is intentional: adjusted historical lows can change the protecting pivot and therefore the exact Donchian length.
- A monthly scan evaluates the latest completed month only. The forming current month cannot emit a BUY, so compare the result with the completed signal month shown under **Details**, not the live monthly candle.
- Yahoo symbols are derived on the server from canonical inputs; client-provided provider symbols are not trusted.
- Provider calls use bounded concurrency, global throttling, retries, caching, cancellation, and per-item deadlines.

## Verification

Install the Playwright browser once:

```bash
npx playwright install chromium
```

Run the complete release gate:

```bash
npm run release:check
```

The release gate runs:

1. Vitest unit/component/API tests
2. ESLint
3. TypeScript type checking
4. Isolated Chromium end-to-end tests
5. An intentional-failure cleanup probe
6. The canonical production build
7. A server-bundle audit that rejects fixture leakage

Useful individual commands:

```bash
npm test
npm run lint
npm run typecheck
npm run test:e2e
npm run test:e2e:stability
npm run build
```

The deterministic browser fixture is compiled only into the isolated E2E artifact. The canonical production bundle is audited to ensure fixture tokens and modules are absent.

## Project structure

```text
app/                 Next.js pages and server API routes
components/          Upload, controls, results, and signal details
lib/instruments/     Canonical NSE identity and tick-size policy
lib/market/          Yahoo provider, normalization, sessions, cache/throttle
lib/scans/           Concurrent universe scan orchestration
lib/signals/         Donchian math, structural period selection, trade levels
lib/universe/        CSV parsing and universe validation
e2e/                 Browser-level workflows
tests/               Unit, component, route, and regression tests
docs/superpowers/    Approved design specification and implementation plan
```

## Current limitations

- Yahoo Finance is an unofficial external dependency and may be delayed, unavailable, rate-limited, incomplete, or behaviorally changed without notice.
- Yahoo interval history varies; short intraday intervals provide substantially less history than daily aggregates.
- The explicit NSE holiday/special-session calendar currently covers 2024–2026 and must be maintained for future live dates.
- A current constituent CSV introduces survivorship bias if reused for historical studies.
- `rules-v1` has not been represented as out-of-sample profitable.
- `Validated Model BUY` remains disabled until a separately trained model passes predefined walk-forward acceptance checks.
- Unrestricted `Research Match` diagnostics and higher-timeframe confirmation remain future research features.
- No brokerage integration or automated order placement is included.

## Roadmap

- Point-in-time universe and corporate-action datasets
- Walk-forward, purged out-of-sample validation with transaction costs
- Explicit minimum reward/risk and entry-gap skip state
- Higher-timeframe and benchmark/sector context
- Versioned validated-model registry and monitoring
- Dedicated NSE futures/options contract model

## Contributing

Issues and pull requests are welcome. For strategy changes:

1. State the causal rule and information cutoff explicitly.
2. Add a failing regression test before changing implementation.
3. Preserve distinct no-signal and data-failure states.
4. Run `npm run release:check` before requesting review.
5. Do not describe backtests, heuristics, or in-sample results as validated out-of-sample performance.

## License

No open-source license has been granted yet. Until a license is added, copyright law reserves all rights to the repository owner.
