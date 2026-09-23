import type { Candle } from "@/lib/market/provider";
import type { BuyRecommendation } from "./scan-symbol";
import { atrAt } from "./atr";
import { evaluateTradeOutcome, type ExecutionOptions } from "./trade-outcome";

export const FEATURE_VERSION = "signal-close-features-v2";
export const LABEL_VERSION = "joint-outcomes-v2";

/** Fixed, compact feature list. No subsequent open, outcome or future pivot enters X. */
export function signalCloseFeatures(candles: readonly Candle[], index: number, r: BuyRecommendation) {
  const c = candles[index];
  const atr = atrAt(candles.slice(0, index + 1), index, 14);
  const range = c.high - c.low;
  let declineBars = 0;
  for (let j = index; j > Math.max(0, index - 20) && candles[j].close < candles[j - 1].close; j--) declineBars++;
  return {
    signedBody: range > 0 ? (c.close - c.open) / range : 0,
    lowerWick: range > 0 ? (Math.min(c.open, c.close) - c.low) / range : 0,
    rangeAtr: atr > 0 ? range / atr : null,
    recoveryAtr: atr > 0 ? (c.close - c.low) / atr : null,
    sgSlope: r.sequentialEvidence?.sgSlope ?? null,
    sgCurvature: r.sequentialEvidence?.sgCurvature ?? null,
    return5: index >= 5 ? Math.log(c.close / candles[index - 5].close) : null,
    declineBars,
    volumeZ: r.confirmation?.volumeZScore ?? null,
    stopAtr: atr > 0 ? (r.entry - r.stop) / atr : null,
    resistanceAtr: atr > 0 && r.reactionHigh !== null ? (r.reactionHigh - c.close) / atr : null,
    bayesianShortRun: r.sequentialEvidence?.bayesianChangePoint?.shortRunProbability ?? null,
    bayesianBullishChange: r.sequentialEvidence?.bayesianChangePoint?.bullishChangeEvidence ?? null,
    stateSlope: r.sequentialEvidence?.stateSpaceTrend?.slope ?? null,
    stateSlopeProbability: r.sequentialEvidence?.stateSpaceTrend?.slopePositiveProbability ?? null,
    stateFlipProbability: r.sequentialEvidence?.stateSpaceTrend?.flipProbability ?? null,
    sgSlopeAgreement: r.sequentialEvidence?.sgPositiveSlopeAgreement ?? null,
    sgCurvatureAgreement: r.sequentialEvidence?.sgPositiveCurvatureAgreement ?? null,
    sgStability: r.sequentialEvidence?.sgStabilityScore ?? null,
    atrNormalizedSlope: r.sequentialEvidence?.atrNormalizedSlope ?? null,
    relativeStrengthZ: r.sequentialEvidence?.context?.relativeStrengthZ ?? null,
    higherTimeframeReturn: r.sequentialEvidence?.context?.higherTimeframeReturn ?? null,
  };
}

/** Latest strict two-sided swing high already knowable at the signal close. */
export function latestKnownSwingHigh(candles: readonly Candle[], index: number): number | null {
  for (let j = index - 2; j >= 2; j--)
    if ([-2, -1, 1, 2].every((offset) => candles[j].high > candles[j + offset].high)) return candles[j].high;
  return null;
}

export function predictionObservation(
  candles: readonly Candle[], index: number, r: BuyRecommendation, execution: ExecutionOptions,
) {
  const horizon = execution.horizon ?? 10;
  const options = { ...execution, horizon };
  const t1 = evaluateTradeOutcome(candles, index, r, { ...options, exitTarget: "target1", sameBarPolicy: "stop-first" });
  const t2 = evaluateTradeOutcome(candles, index, r, { ...options, exitTarget: "target2", sameBarPolicy: "stop-first" });
  const optimistic = evaluateTradeOutcome(candles, index, r, { ...options, exitTarget: "target1", sameBarPolicy: "target-first" });
  const complete = index + horizon < candles.length;
  // A fixed complete horizon gives every joint label and excursion the same observation period.
  // Even an early stop is withheld from model fitting until this window matures.
  const jointOutcome = !complete ? null : t1.outcome === "GAP_SKIP" ? "SKIP"
    : t1.outcome === "STOP" ? "STOP" : t1.outcome === "EXPIRED" ? "EXPIRED"
      : t2.outcome === "TARGET2" ? "T2" : "T1_ONLY";
  const competingRisk = !complete ? { event: "CENSORED" as const, time: null }
    : jointOutcome === "STOP" ? { event: "STOP" as const, time: t1.barsHeld }
      : jointOutcome === "T2" ? { event: "TARGET2" as const, time: t2.barsHeld }
        : jointOutcome === "T1_ONLY" ? { event: "TARGET1" as const, time: t1.barsHeld }
          : jointOutcome === "SKIP" ? { event: "SKIP" as const, time: 0 }
            : { event: "EXPIRY" as const, time: horizon };
  const swingHigh = latestKnownSwingHigh(candles, index);
  let flipDelay: number | null = null;
  for (let j = index + 2; j <= Math.min(index + horizon, candles.length - 1); j++) {
    if (swingHigh !== null && candles[j - 1].close > swingHigh && candles[j].close > swingHigh) {
      flipDelay = j - index;
      break;
    }
  }
  return {
    featureVersion: FEATURE_VERSION, labelVersion: LABEL_VERSION,
    symbol: r.symbol, timeframe: r.timeframe, signalTime: r.signalTime,
    labelEndTime: complete ? candles[index + horizon].time : null,
    features: signalCloseFeatures(candles, index, r),
    evidenceQualityScore: r.tradeDiagnostics?.evidenceQualityScore ?? null,
    jointOutcome, competingRisk, target1: t1, target2: t2, optimisticTarget1: optimistic,
    structuralFlip: complete && swingHigh !== null ? flipDelay !== null : null,
    structuralFlipDelay: flipDelay, knownSwingHigh: swingHigh,
    labelMeaning: "T1/T2 before stop within horizon; flip requires two future closes above a swing high known at signal close",
  };
}
