# Adaptive Donchian Screener

Reversal Radar is a local Next.js application that screens an uploaded NSE cash-equity list for causal, completed-candle Donchian reversal signals. It keeps BUY, no-signal, and per-symbol data failures visible in one result set and can export the displayed rows as CSV.

Quantitative research output is not a guarantee or personalized investment advice.

## Requirements

- Node.js 20.9 or newer
- npm
- Network access to Yahoo Finance for live scans
- Chromium installed by Playwright for end-to-end tests

No application environment variables are required. Do not add credentials or secrets to the repository.

## Install and run

Install the locked dependencies:

```bash
npm ci
```

Start the development server:

```bash
npm run dev
```

Open `http://localhost:3000`.

For a production build:

```bash
npm run build
npm start
```

## Stock-list CSV

Upload a CSV with the supplied NSE-style five-column header:

```csv
Company Name,Industry,Symbol,Series,ISIN Code
Reliance Industries Ltd,Energy,RELIANCE,EQ,INE002A01018
Tata Consultancy Services,IT Services,TCS,EQ,INE467B01029
```

`Symbol` is required. The parser trims and uppercases symbols, accepts cash-equity `EQ` rows, rejects other series and derivative contracts, and keeps the first occurrence of a duplicate symbol. Symbols are mapped to Yahoo's `.NS` suffix. Uploading another file replaces the current list and clears prior results.

Choose a timeframe, run the scan, and expand a BUY row to inspect its entry, stop, targets, auto-selected period, Donchian values, strategy version, and data timestamp. `Export results` downloads the complete visible result set as `scan-results.csv`, including no-signal and provider-error rows.

## Verification

Install the Chromium test browser once, then run the ordered release check:

```bash
npx playwright install chromium
npm run release:check
```

`release:check` runs unit tests, lint, type-checking, isolated E2E, an intentional-failure cleanup probe, the canonical production build, and a canonical-bundle audit. The E2E runner owns port `3197`, builds into `.next-e2e`, starts and stops the server itself, and refuses to run if that port is already occupied. It saves the exact bytes of `next-env.d.ts` before building and restores them in a `finally` block, including when the browser suite fails. This keeps E2E output and processes isolated from `.next` and developer servers.

The canonical provider factory always constructs the live Yahoo provider; it does not inspect fixture environment variables. Only an E2E build made with the runner's private `E2E_BUILD=isolated-v1` build flag aliases that factory to an E2E-only module. Inside that separate artifact, the exact runtime token `SCREENER_E2E_FIXTURES=deterministic-v1` enables deterministic raw Yahoo-shaped fixtures; an absent or unrecognized token still selects Yahoo. `/api/scans` remains real: the route, Yahoo normalization, scan runner, signal selection, trade levels, per-symbol failure isolation, UI, and export route all execute. The suite therefore does not depend on the current market or Yahoo availability.

`npm run build` explicitly removes `E2E_BUILD` from the build process. `npm run verify:canonical-bundle` then scans `.next/server` and fails if it finds the fixture token, fixture version, fixture class, fixture provider filename, or E2E factory filename. To run the deliberate cleanup proof independently, use:

```bash
npm run test:e2e:cleanup-check
```

That probe forces Playwright to fail after the isolated server starts, then verifies the tracked type file is byte-identical and port `3197` is free.

The browser coverage includes a mixed BUY/no-signal/provider-error result set, calculation details, file replacement, heading-first mobile ordering and horizontal table scrolling, 44px targets for both rejected-row review and calculation details, and exact downloaded CSV content. To repeat both scenarios five times against one isolated server, run:

```bash
npm run test:e2e:stability
```

## Yahoo data limitations

- Yahoo Finance is an external dependency and can be unavailable, delayed, stale, rate-limited, or change behavior without notice.
- Available lookback varies by interval; short intraday intervals have less history than daily, weekly, or monthly intervals.
- The scanner removes incomplete candles and reports insufficient, stale, invalid, missing-symbol, rate-limited, or provider-error states instead of silently converting them into signals.
- A failure for one symbol remains isolated so other symbols can still complete.
- Live output is point-in-time research data. A successful data fetch or a BUY label does not establish future performance or profitability.

The `Validated Model BUY` mode remains disabled until a separately trained out-of-sample model passes its acceptance checks. The current implementation is the deterministic `rules-v1` strategy.
