# Reversal prediction validation

The Donchian BUY gate is unchanged and remains mandatory:

1. The completed signal candle's low equals the current lower Donchian channel on the NSE tick grid.
2. The current lower channel is strictly above the previous lower channel on that same grid.
3. The signal candle closes above its low.

The prediction layer is deliberately separate from that gate. It does not turn a weak candle into a BUY and it never calls an evidence score a probability.

## Labels

For each qualifying signal, `scripts/build-prediction-dataset.mjs` records all overlapping observations, not only the first trade in a portfolio. Features are frozen at the signal close and include candle geometry, ATR-normalised recovery, causal Savitzky–Golay slope/curvature, robust volume surprise, decline duration, stop distance and known resistance distance.

The primary outcome is an executable next-open joint outcome over ten completed candles:

| Label | Meaning |
| --- | --- |
| `T1_ONLY` | Target 1 before stop, but Target 2 was not reached before stop/expiry |
| `T2` | Target 2 before stop |
| `STOP` | Stop before Target 1 |
| `EXPIRED` | Neither Target 1 nor stop before the holding limit |
| `SKIP` | Opening gap made the planned entry non-executable |

Therefore `P(T1) = P(T1_ONLY) + P(T2)` and `P(T2) <= P(T1)`. In a candle that trades through both stop and target, the production label is conservative stop-first; target-first is retained only as a sensitivity bound.

Trend flip is a separate label. It requires two subsequent closes above the latest two-sided swing high that was already knowable at the signal close. It is not inferred from a future pivot and is never folded into reversal probability.

## Validation protocol

The research script uses chronological folds with 24 months for training, six months for calibration, three months for testing, and a final untouched twelve-month holdout. Labels whose outcome window crosses a split are purged. All symbols sharing a date remain in the same partition. Preprocessing is fitted inside each training pipeline.

It evaluates a regularised logistic baseline, a small spline additive model and a shallow boosting challenger using multiclass Brier score, log loss, target-1 Brier score, ten-bin calibration error, matched-coverage ranking, and week-block bootstrap intervals. The interval describes average loss improvement; it is not a per-stock confidence interval.

No model is promoted automatically. Promotion requires a positive out-of-sample improvement over the base rate and the current ranking baseline, acceptable cost/ambiguity stress results, adequate sample and class coverage, and a separately reviewed final holdout. Until those checks pass, the application reports `UNAVAILABLE` rather than inventing a reversal probability.

## Reproducible research run

```text
npm run research:dataset -- <archive-directory> <new-output-directory>
npm run research:models -- <output-directory> <new-report.json>
npm run test:research
```

The dataset manifest includes source checksums, the application commit, adjustment-audit status and rejected-file details. A failed or incomplete archive is retained as research-only; malformed candles are not silently repaired.

## Method note

The chronological, leakage-controlled workflow was informed by the scikit-learn procedural guidance in Kassis, T., Agarwal, V., He, Y., Patel, D., & Brueckner, A. M. (2026), “Scientific Agent Skills: A Library of Procedural Knowledge for Research Agents,” arXiv:2609.00065 (current v2), https://doi.org/10.48550/arXiv.2609.00065.
