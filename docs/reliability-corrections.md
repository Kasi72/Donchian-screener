# Reliability corrections and outcome validation

The core Rules BUY gate is unchanged. Confirmation v2 removes a mathematically impossible neighbouring-period confidence component and normalizes the five remaining evidence components to 100. Scores and grade thresholds remain engineering heuristics; scores from v1 and v2 are not directly comparable.

## Unique period invariant

Let x be the current candle low in exchange ticks. Exact touch requires every low inside the current N-bar window to be at least x. A strict increase from the previous N-bar lower channel therefore requires the departing candle at t-N to have a low below x. Shorter windows cannot depart that low; longer windows retain it. Hence at most one N can satisfy both conditions. Counts such as 1/5 are window diagnostics and cannot rank predictive reliability.

## Evidence and provenance

New scans use EVIDENCE_SUPPORTED for high sequential evidence, and TREND_EVIDENCE_SUPPORTED for high trend evidence. Neither establishes subsequent price follow-through. Existing CONFIRMED_REVERSAL/CONFIRMED_FLIP values remain readable for old records. Confirmation grade CONFIRMED denotes a score band only; the details and tear sheet explain this limitation.

Diagnostics v2 distinguishes an absent window audit from a complete session window. A complete window is not certification of provider OHLC prices. Without benchmark input, market regime is unavailable. A fitted Platt model without validation provenance is labelled UNVALIDATED_MODEL and its probability is withheld from the trader summary.

## Canonical historical replay

Use Node 24 and run:

```text
npm run backtest:replay -- input.json new-report.json
```

Input contains `symbol`, `timeframe`, chronological completed raw `candles` (time in epoch milliseconds; open, high, low, close, volume), and explicit `execution.feeBps` and `execution.slippageBps`. Optional execution fields are `horizon` and `exitTarget` (`target1` or `target2`). No implicit real-world transaction-cost estimate is assumed. The output path must not exist.

The replay calls the production scanSymbol function with a prefix-only provider for each observation, including the production tick policy, pivot selection, Donchian gate, risk levels and evidence calculations. Future observations are exposed only to the outcome evaluator. Historical data must already be normalized to the chosen exchange sessions and timeframe; this runner does not reconstruct corporate actions or aggregate bars. Calendar or tick-policy limitations remain visible in status counts. Per-symbol replay is not a portfolio simulation.

The common execution-policy.json sets a ten-candle horizon and Target 1 exit by default. A separate run can evaluate Target 2; no run chooses an exit target after observing its outcome. Execution uses the next open with adverse slippage. Gaps through a stop fill at the opening price less slippage. A target limit uses its limit price, without assuming favourable gap improvement. Both target and stop inside a bar are marked ambiguous and resolved stop-first unless an opening fill determines the order. Expiry is an actual close exit included in net statistics. Truncated histories are censored and counted separately.

Fixed-horizon MFE/MAE intentionally include prices after exit and are named accordingly. They must not be described as excursions while holding the trade. Intrabar trade MFE/MAE cannot be determined exactly from OHLC alone. Fee estimates apply to both sides; stop/expiry execution includes slippage. Liquidity, order queues, circuits, lots and instrument-specific taxes require additional execution inputs.

The older local Python archive scripts and their reports are not the canonical implementation and should not validate the revised model. They remain preserved as historical artifacts. This change does not rerun the full NIFTY archive or fit a probability model.

## Remaining empirical work

Build an outcome dataset using this replay, retaining failures and censored observations. Define a separate trend-flip outcome and evaluate signal delay. Use chronological training, calibration and test windows with separation of overlapping outcome horizons. Compare core rules with each overlay on the same dates; report net expectancy, stop rate, coverage, calibration, and uncertainty. Keep daily, weekly, monthly and intraday results separate. Fit and publish probabilities only after held-out validation with model/data versions, training cutoff and outcome definition. SELL exits and bearish short entries need separate specified policies.
