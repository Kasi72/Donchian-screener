import type { DailyCandleWindowAudit, IntradayCandleWindowAudit } from "@/lib/market/window-audit";
import type { ReversalConfirmation } from "./reversal-confirmation";
import type { SequentialEvidence } from "./sequential-evidence";
import executionPolicy from "./execution-policy.json";

export const TRADE_DIAGNOSTICS_VERSION = "trade-diagnostics-v2" as const;

export type CalibrationStatus = "UNAVAILABLE" | "UNVALIDATED_MODEL" | "WALK_FORWARD_VALIDATED";
export type DataQualityStatus = "VERIFIED" | "LIMITED" | "NOT_AUDITED" | "SESSION_WINDOW_COMPLETE";
export type MarketRegime = "BULLISH" | "NEUTRAL_TO_BULLISH" | "NEUTRAL" | "UNAVAILABLE";
export type ActionabilityStatus = "STRUCTURAL_ONLY" | "ACTIONABLE" | "AVOID";

export interface TradeDiagnostics {
  version: typeof TRADE_DIAGNOSTICS_VERSION | "trade-diagnostics-v1";
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
  /** Provenance for the statistical safeguards applied to this observation. */
  validationNotes?: string[];
  actionability?: ActionabilityStatus;
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
  intradayWindowAudit,
}: {
  confirmation: ReversalConfirmation;
  sequential: SequentialEvidence;
  rewardRisk: number;
  windowAudit?: DailyCandleWindowAudit;
  intradayWindowAudit?: IntradayCandleWindowAudit;
}): TradeDiagnostics {
  const calibrated = sequential.calibratedProbability;
  const dailyComplete = windowAudit !== undefined && windowAudit.complete && windowAudit.expectedSessions > 0 &&
    windowAudit.observedSessions === windowAudit.expectedSessions && windowAudit.missingSessions === 0;
  const intradayComplete = intradayWindowAudit !== undefined && intradayWindowAudit.complete &&
    intradayWindowAudit.expectedBars > 0 && intradayWindowAudit.observedBars === intradayWindowAudit.expectedBars &&
    intradayWindowAudit.missingBars === 0;
  const dataQuality: DataQualityStatus = dailyComplete || intradayComplete
    ? "SESSION_WINDOW_COMPLETE"
    : windowAudit !== undefined || intradayWindowAudit !== undefined ? "LIMITED" : "NOT_AUDITED";
  // Stock trend evidence cannot establish the wider market's regime.
  const marketRegime: MarketRegime = sequential.marketRegime === "TRENDING_BULL" ? "BULLISH"
    : sequential.marketRegime === "TRANSITION" ? "NEUTRAL_TO_BULLISH"
      : sequential.marketRegime === "RANGE_BOUND" || sequential.marketRegime === "HIGH_VOLATILITY" ? "NEUTRAL" : "UNAVAILABLE";
  const rewardQuality = clamp((rewardRisk - 1) / 2);
  const evidenceQualityScore = round(100 * clamp(
    0.45 * confirmation.score / 100 +
      0.25 * sequential.reversalScore +
      0.15 * (sequential.trendPersistenceScore ?? 0.5) +
      0.15 * rewardQuality,
  ));

  return {
    version: TRADE_DIAGNOSTICS_VERSION,
    // A fitted calibrator alone supplies no walk-forward validation provenance.
    reversalProbability: null,
    reversalConfidenceInterval: null,
    target1BeforeStopProbability: null,
    target2BeforeStopProbability: null,
    comparableSignals: null,
    target1Wins: null,
    stopFirstOutcomes: null,
    medianBarsToTarget1: null,
    medianMae: null,
    medianMfe: null,
    maximumHoldingCandles: executionPolicy.maximumHoldingCandles,
    marketRegime,
    dataQuality,
    calibration: calibrated === null ? "UNAVAILABLE" : "UNVALIDATED_MODEL",
    evidenceQualityScore,
    tradeQualityScore: null,
    validationNotes: [
      "Donchian gate is hard and causal; overlays only rank evidence.",
      "Probability is withheld until purged walk-forward triple-barrier outcomes are calibrated.",
      "Causal smoothing uses completed candles only; no centered filter is used.",
      "Uncertainty should be reported with conformal intervals and Bayesian shrinkage when a model is fitted.",
      intradayWindowAudit
        ? `Intraday continuity audit: ${intradayWindowAudit.observedBars}/${intradayWindowAudit.expectedBars} bars observed.`
        : "Intraday continuity audit is not applicable to this timeframe.",
    ],
    // No calibrated, cost-adjusted outcome model is active in production.
    actionability: "STRUCTURAL_ONLY",
  };
}
