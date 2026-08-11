# Adaptive Donchian Bullish-Reversal Screener

Date: 2026-08-08

## 1. Objective

Build a web screener suitable for deployment through Bolt or Lovable. A user uploads one NSE-style CSV, selects a timeframe, and scans the list using completed Yahoo Finance OHLCV candles. The system identifies bullish Donchian lower-channel rollover setups, automatically selects a structurally legitimate period, and returns a clear recommendation with entry, protective stop, and exit levels.

The application must distinguish a deterministic rules-based recommendation from a statistically validated recommendation. It must never describe an untrained or failed model as out-of-sample validated.

## 2. Scope

Supported universes:

- NSE cash equities uploaded in CSV format.
- NSE indices selected from a built-in mapping.
- NSE F&O underlyings when supplied in the same CSV format. The first version screens the underlying cash/index symbol rather than individual futures expiries or options contracts.

Supported completed-candle intervals:

- 5 minutes
- 15 minutes
- 1 hour
- Daily
- Weekly
- Monthly

Only bullish signals are in scope. Order placement, broker integration, options-chain analysis, bearish signals, portfolio sizing, and the video's undisclosed variations are outside the first release.

## 3. Provenance and interpretation

The two supplied Zebu videos disclose this bullish condition for a period `N`:

```text
CurrentLDC(t,N)  = min(Low[t-N+1 ... t])
PreviousLDC(t,N) = min(Low[t-N ... t-1])

CurrentLDC(t,N) > PreviousLDC(t,N)
and
Low[t] = CurrentLDC(t,N)
```

The videos demonstrate varying periods such as 51 and 94. Those values are bar distances to selected older lows, not universal settings. The videos mention twelve broader concepts or variations but do not provide twelve complete public algorithms. The application must not invent them.

The raw condition identifies a possible higher-low rollover. It is not, on its own, classical Dow Theory confirmation. A later close above an intervening reaction high is recorded as structural confirmation.

## 4. User experience

### 4.1 Scan setup

The home screen contains:

- CSV upload control.
- Parsed-file summary.
- Timeframe selector.
- Signal-mode selector.
- Scan button.
- Progress indicator and cancellation button.

Uploading a new CSV replaces the current universe. Multiple-list merging is not required.

Signal modes:

1. `Rules BUY`: causal structural-anchor selection plus the disclosed Donchian condition.
2. `Validated Model BUY`: available only when a trained model for that timeframe has passed the model-acceptance gate.
3. `Research Match`: unrestricted formula diagnostics without a BUY label.

### 4.2 Results

Each BUY row displays:

- Company and NSE symbol.
- Industry.
- Timeframe.
- Recommendation.
- Signal-candle timestamp.
- Auto-selected Donchian period.
- Entry reference.
- Initial stop.
- Target 1.
- Target 2 or trailing-exit level.
- Risk/reward ratios.
- Model probability when applicable.
- Data-quality status.
- Explanation of the selected anchor.

Users can sort, filter, inspect details, and export results to CSV.

## 5. CSV contract

The parser accepts the supplied format:

```text
Company Name,Industry,Symbol,Series,ISIN Code
```

Only `Symbol` is mandatory. When `Series` exists, include rows only when the normalized value is `EQ`. Trim values, reject blank symbols, and remove duplicates. Preserve optional metadata.

For ordinary NSE equities:

```text
YahooSymbol = Symbol + ".NS"
```

Built-in index codes are maintained separately, including `^NSEI`, `^NSEBANK`, `^CRSLDX`, and `^INDIAVIX`. Invalid or unresolved rows are reported individually and do not stop the scan.

## 6. System architecture

The application has five isolated units:

1. `CSV parser`: validates the uploaded universe and returns normalized instruments.
2. `Market-data service`: retrieves, caches, cleans, and records Yahoo OHLCV.
3. `Signal engine`: discovers causal anchor candidates, selects a period, and evaluates the Donchian rule.
4. `Risk engine`: calculates entry, stop, targets, and later exit events.
5. `Model service`: trains, versions, validates, and scores candidate signals.

The UI calls server-side endpoints. Yahoo must not be fetched directly from the browser. A TypeScript implementation may use `yahoo-finance2`; the provider remains behind an interface so it can be replaced later.

Recommended persistence is PostgreSQL/Supabase for scan records, accumulated candles, signals, model versions, and backtest results. The application remains usable without authentication in local/demo mode, but persistent production deployments should use authentication and per-user scan ownership.

## 7. Market-data rules

- Fetch symbols with bounded concurrency and exponential-backoff retries.
- Cache by provider, symbol, interval, and timestamp.
- Sort chronologically and deduplicate timestamps.
- Remove rows with null OHLC.
- Exclude a forming candle.
- Use Asia/Kolkata market-session boundaries.
- Exclude pre/post-market data.
- Store raw and adjusted status explicitly.
- Use raw OHLC on every timeframe to preserve exact parity with the unadjusted TradingView Donchian chart used for strategy verification.
- Remove zero-volume flat Yahoo placeholders before session validation; they are provider snapshots, not chart candles, and must not affect period distance.
- Remove wholly empty Yahoo OHLCV placeholders while continuing to reject partially malformed rows; accept regular-grid intraday bars only when their interval overlaps an explicitly modeled special session.
- Never convert a provider failure into `NO SIGNAL`.

Required data statuses:

```text
OK
INSUFFICIENT_HISTORY
SYMBOL_NOT_FOUND
PROVIDER_RATE_LIMITED
STALE_DATA
INVALID_CANDLES
```

Yahoo's limited intraday history prevents credible immediate training of long-history intraday models. The application accumulates intraday candles prospectively. Until an intraday model passes the acceptance gate, that timeframe exposes `Rules BUY` and `Research Match`, not `Validated Model BUY`.

## 8. Causal auto-period engine

### 8.1 Candidate anchors

Using data available no later than `t-1`, detect confirmed pivot lows. A pivot at `j` requires lower lows than a configurable number of left and right neighbours. It becomes usable only after the right-side confirmation candles have closed.

Calculate causal features:

```text
prominenceATR     = pivot prominence / ATR(14)
recoveryATR       = post-pivot recovery / ATR(14)
ageBars           = t - j
retestCount       = successful later tests of the pivot zone
relativeVolume    = pivot volume / rolling median volume
higherTFAgreement = whether the area is significant on the next timeframe
```

Candidates below minimum prominence or recovery thresholds are discarded. No future observation may revise the historical decision used by an earlier scan.

### 8.2 Candidate periods

Every eligible anchor produces:

```text
N = t - j
```

For each `N`, evaluate the exact two-condition video formula. This produces zero or more valid candidates. The application must not scan arbitrary integers that lack an independently confirmed anchor.

### 8.3 Rules-mode selection

For the deterministic initial release, rank valid candidates using a versioned, predeclared structural score based on normalized prominence, recovery, age, retests, volume, and higher-timeframe agreement. Select the highest-ranked candidate. Ties use greater normalized prominence, then the more recent anchor.

The score is an engineering heuristic and must be labelled as such. Weights live in configuration and cannot be silently optimized on the displayed test period.

### 8.4 Model-mode selection

The trained model predicts the probability that a defined profit barrier is reached before the stop barrier. It scores every structurally valid candidate and selects the candidate with the greatest calibrated probability. A BUY is emitted only if that probability exceeds the model version's frozen threshold and expected value after estimated costs is positive.

## 9. BUY, entry, stop, and exits

The signal is generated at the completed signal candle's close. It cannot promise execution at that candle's low.

### 9.1 Rules BUY gate

```text
BUY when:
- candle t is complete;
- at least one independently anchored period is valid;
- CurrentLDC > PreviousLDC;
- Low[t] equals CurrentLDC in integer tick units;
- Close[t] > Low[t];
- data quality is OK;
- estimated reward/risk to the reaction high is acceptable.
```

### 9.2 Price levels

```text
EntryReference = signal Close
StopA          = signal Low - max(oneTick, 0.10 * ATR14)
Risk           = EntryReference - StopA
Target1        = EntryReference + 1.0 * Risk
Target2        = EntryReference + 2.0 * Risk
ReactionHigh   = highest confirmed reaction high between anchor and signal
```

If the reaction high is below Target1, reject the Rules BUY for inadequate visible reward. Prices are rounded to the instrument's tick size.

The UI states that actual entry is the next obtainable market price. If that price gaps enough to reduce Target2 reward/risk below a configured minimum, the recommendation changes to `SKIP — ENTRY GAP`.

### 9.3 Exit policy

- Stop closes the recommendation when a completed or intrabar low reaches StopA; backtests assume conservative stop execution including slippage.
- At Target1, record a partial-exit event and move the remaining stop to entry only if that policy is selected in the frozen strategy version.
- Exit the remainder at Target2, the protective stop, or a completed close below a configurable trailing lower channel.
- A maximum holding period prevents indefinite open recommendations.

All exit policies are versioned and tested independently. The first release defaults to 50% at Target1 and 50% at Target2, with no retrospective policy switching.

## 10. Statistical model and labels

Use a gradient-boosted tree model initially. Neural networks are excluded until materially more point-in-time data exists.

Training row: one structurally valid candidate at one completed candle.

Primary label:

```text
1 if Target2 is touched before StopA within MaxHoldingBars
0 otherwise
```

Candidate features include Donchian geometry, pivot geometry, candle shape, ATR-normalized distances, volume, benchmark/sector context, relative strength, and higher-timeframe structure. Company name and calendar date are excluded as predictive features.

Probability calibration uses a validation window separate from model fitting. Threshold selection maximizes expected value net of brokerage, taxes, spread, and slippage subject to minimum trade count and drawdown constraints.

## 11. Out-of-sample validation

Validation is chronological and walk-forward. Feature scaling, pivot confirmation, candidate generation, model fitting, probability calibration, and threshold selection are repeated using past data only.

Required controls:

- Purging for overlapping label horizons.
- Embargo between train/validation/test boundaries.
- Point-in-time constituent lists where available.
- Survivorship-bias warning when testing a current uploaded list historically.
- Corporate-action consistency.
- Transaction costs and adverse slippage.
- Comparison against fixed-period Donchian baselines and random-entry controls.
- Results by timeframe, sector, symbol, liquidity, and volatility regime.
- Record every attempted strategy/model configuration.

## 12. Model-acceptance gate

`Validated Model BUY` remains disabled unless the frozen test set satisfies all configured requirements. Initial proposed requirements are:

```text
positive expected value after costs
profit factor > 1.20
Target2-before-stop rate above the comparable baseline
minimum 200 independent test signals for the timeframe
positive results in a majority of walk-forward test folds
no single symbol or sector supplies more than 20% of total profit
calibration error within the configured tolerance
maximum drawdown within the configured risk limit
```

These are product acceptance thresholds, not guarantees of future profit. The test set cannot be reused repeatedly to tune failed configurations.

## 13. APIs and persistence

Principal endpoints:

```text
POST /api/universe/parse
POST /api/scans
GET  /api/scans/{id}
POST /api/scans/{id}/cancel
GET  /api/signals/{id}
GET  /api/scans/{id}/export
POST /api/models/train
GET  /api/models/{timeframe}/status
```

Principal tables:

```text
universes
universe_instruments
candles
scans
scan_items
signals
signal_candidates
recommendation_events
strategy_versions
model_versions
backtest_runs
```

Every signal stores the complete input/version lineage needed to reproduce it.

## 14. Error handling and safety

- Continue a scan when individual symbols fail.
- Use retries only for transient provider errors.
- Display unresolved symbols as a downloadable report.
- Reject stale or insufficient data before recommendation generation.
- Never substitute a different symbol silently.
- Present recommendations as quantitative research outputs, not guaranteed advice.
- Display model version, strategy version, data timestamp, and status beside every BUY.

## 15. Verification and acceptance tests

Unit tests cover CSV parsing, Yahoo mapping, candle closure, tick normalization, pivot confirmation, Donchian window boundaries, period bar counts, entry/stop/target rounding, and gap handling.

Fixture tests reproduce hand-built examples, including periods 51 and 94 when exact source candles can be obtained. Property tests verify that future candles cannot alter a previously emitted signal. Integration tests mock provider success, empty data, null candles, timeouts, and rate limits.

End-to-end acceptance:

1. Upload the supplied 500-row CSV.
2. Parse and preview all valid symbols.
3. Run a completed-candle scan without browser-side Yahoo calls.
4. Continue despite individual symbol failures.
5. Display only reproducible recommendations with entry, stop, and exits.
6. Export results matching the visible filters.
7. Prevent Model BUY when no accepted model exists.

## 16. Delivery stages

### Stage A — working deterministic screener

CSV upload, Yahoo ingestion, completed-candle normalization, causal anchor engine, Rules BUY, levels, scan progress, result filters, and export.

### Stage B — research and backtesting

Historical candidate generation, barrier labels, cost model, walk-forward testing, reports, and immutable experiment records.

### Stage C — validated model

Candidate-ranking model, probability calibration, acceptance gate, model registry, and Model BUY.

### Stage D — production hardening

Authentication, persistent candle accumulation, monitoring, provider fallback, scheduled scans, and alerts.

## 17. Known limitations

- Yahoo Finance access is unofficial and can change or be rate-limited.
- Yahoo's intraday depth is insufficient for immediate strong out-of-sample claims.
- A current Nifty 500 CSV creates survivorship bias in historical tests.
- The video's selected examples do not establish profitability.
- No mathematical method can guarantee that the detected candle is the final market low.
- Entry, stop, and target levels are decision rules, not execution guarantees.
