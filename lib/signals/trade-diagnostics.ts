import type { DailyCandleWindowAudit } from "@/lib/market/window-audit";
import type { ReversalConfirmation } from "./reversal-confirmation";
import type { SequentialEvidence } from "./sequential-evidence";

export const TRADE_DIAGNOSTICS_VERSION = "trade-diagnostics-v1" as const;

export type CalibrationStatus = "UNAVAILABLE" | "WALK_FORWARD_VALIDATED";
export type DataQualityStatus = "VERIFIED" | "LIMITED";
export type MarketRegime = "BULLISH" | "NEUTRAL_TO_BULLISH" | "NEUTRAL" | "UNAVAILABLE";

export interface TradeDiagnostics {
  version: typeof TRADE_DIAGNOSTICS_VERSION;
  /** Only populated after an out-of-sample calibration model is supplied. */
  reversalProbability: number | null;
  reversalConfidenceInterval: [number, number] | null;
  target1BeforeStopProbability: number | null;
  target2BeforeStopProbability: number | null;
  comparableSignals: number | null;
  target1Wins: number | null;
  stopFirstOutcomes: number | null;
  medianBarsToTarget1: number | null;
  medianMae: number | null;
  medianMfe: number | null;
  maximumHoldingCandles: number;
  marketRegime: MarketRegime;
  dataQuality: DataQualityStatus;
  calibration: CalibrationStatus;
  /** Evidence-only quality; never represents historical expectancy. */
  evidenceQualityScore: number;
  /** Requires target probabilities from walk-forward outcomes. */
  tradeQualityScore: number | null;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function calculateTradeDiagnostics({
  confirmation,
  sequential,
  rewardRisk,
  windowAudit,
}: {
  confirmation: ReversalConfirmation;
  sequential: SequentialEvidence;
  rewardRisk: number;
  windowAudit?: DailyCandleWindowAudit;
}): TradeDiagnostics {
  const calibrated = sequential.calibratedProbability;
  const dataQuality: DataQualityStatus = windowAudit && !windowAudit.complete ? "LIMITED" : "VERIFIED";
  const marketRegime: MarketRegime = sequential.trendState === "CONFIRMED_FLIP"
    ? "BULLISH"
    : sequential.trendState === "DEVELOPING_FLIP"
      ? "NEUTRAL_TO_BULLISH"
      : sequential.trendState === "REVERSAL_CANDIDATE"
        ? "NEUTRAL"
        : "UNAVAILABLE";
  const rewardQuality = clamp((rewardRisk - 1) / 2);
  const evidenceQualityScore = round(100 * clamp(
    0.45 * confirmation.score / 100 +
      0.25 * sequential.reversalScore +
      0.15 * (sequential.trendPersistenceScore ?? 0.5) +
      0.15 * rewardQuality,
  ));

  return {
    version: TRADE_DIAGNOSTICS_VERSION,
    reversalProbability: calibrated,
    reversalConfidenceInterval: null,
    target1BeforeStopProbability: null,
    target2BeforeStopProbability: null,
    comparableSignals: null,
    target1Wins: null,
    stopFirstOutcomes: null,
    medianBarsToTarget1: null,
    medianMae: null,
    medianMfe: null,
    maximumHoldingCandles: 10,
    marketRegime,
    dataQuality,
    calibration: calibrated === null ? "UNAVAILABLE" : "WALK_FORWARD_VALIDATED",
    evidenceQualityScore,
    tradeQualityScore: null,
  };
}
