import type { BuyRecommendation } from "./scan-symbol";
import { priceToTicks } from "./ticks";

/** Rechecks displayed inputs; a rising channel alone must never be called PASS. */
export function displayedGate(r: BuyRecommendation): string {
  if (![r.signalLow, r.signalClose, r.currentLdc, r.previousLdc, r.tickSize].every(
    (v) => typeof v === "number" && Number.isFinite(v) && v > 0,
  )) return "UNVERIFIED — complete signal prices and tick size are required";
  const low = priceToTicks(r.signalLow!, r.tickSize);
  const current = priceToTicks(r.currentLdc, r.tickSize);
  const previous = priceToTicks(r.previousLdc, r.tickSize);
  if ((r.signalLowTick !== undefined && r.signalLowTick !== low) ||
    (r.currentLdcTick !== undefined && r.currentLdcTick !== current) ||
    (r.previousLdcTick !== undefined && r.previousLdcTick !== previous))
    return "UNVERIFIED — exported prices and tick audit disagree";
  return low === current && current > previous && r.signalClose! > r.signalLow!
    ? "PASS — signal low touches the current LDC and the LDC has risen"
    : "FAIL — exact lower-channel touch, channel rise and close above low are all required";
}

/** Same explanation in the live decision card and Word/PDF exports. */
export function traderAssessmentFields(r: BuyRecommendation): Array<[string, string]> {
  const score = r.confirmation?.score;
  const support = score === undefined ? "Unavailable" : score >= 75 ? "Strong candle evidence"
    : score >= 60 ? "Moderate candle evidence" : "Limited candle evidence";
  const warnings: string[] = [];
  if (r.sequentialEvidence?.trendState === "REVERSAL_CANDIDATE") warnings.push("Trend flip is not established");
  if (r.sequentialEvidence?.sgSlope !== undefined && r.sequentialEvidence.sgSlope < 0)
    warnings.push("Smoothed price direction is still falling");
  if (r.confirmation?.volumeZScore !== undefined && r.confirmation.volumeZScore !== null && r.confirmation.volumeZScore < 0)
    warnings.push("Volume is below its recent baseline");
  if (r.signalOpen !== undefined && r.signalClose !== undefined && r.signalClose <= r.signalOpen)
    warnings.push("Signal candle did not close above its open");
  return [
    ["Evidence interpretation", `${support}. Confirmation grades are not probabilities or proof of a future reversal.`],
    ["Conflicting evidence", warnings.length ? warnings.join("; ") : "No listed conflict; this does not establish a profitable outcome."],
    ["Prediction readiness", "No validated outcome model is active. Win probability and predictive ranking remain unavailable."],
    ["What a future probability will mean", `Target reached before stop within ${r.tradeDiagnostics?.maximumHoldingCandles ?? 10} completed candles, using stated next-open execution costs. Trend flip is a separate outcome.`],
    ["Trade discipline", "Review the next obtainable entry against stop and targets. Skip an opening price at/below stop or at/above Target 1; do not chase an expired setup."],
  ];
}
