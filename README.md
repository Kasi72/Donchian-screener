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

Install the Chromium test browser once, then run every release check:

```bash
npx playwright install chromium
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e
```

The Playwright suite uses deterministic mocked scan responses; it does not depend on the current market or Yahoo availability. It covers a mixed BUY/no-signal/provider-error result set, error isolation, calculation details, file replacement, mobile ordering and horizontal table scrolling, the 44px details target, and exact downloaded CSV content.

## Yahoo data limitations

- Yahoo Finance is an external dependency and can be unavailable, delayed, stale, rate-limited, or change behavior without notice.
- Available lookback varies by interval; short intraday intervals have less history than daily, weekly, or monthly intervals.
- The scanner removes incomplete candles and reports insufficient, stale, invalid, missing-symbol, rate-limited, or provider-error states instead of silently converting them into signals.
- A failure for one symbol remains isolated so other symbols can still complete.
- Live output is point-in-time research data. A successful data fetch or a BUY label does not establish future performance or profitability.

The `Validated Model BUY` mode remains disabled until a separately trained out-of-sample model passes its acceptance checks. The current implementation is the deterministic `rules-v1` strategy.
