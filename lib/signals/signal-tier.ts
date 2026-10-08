import type { DataQualityStatus } from "./trade-diagnostics";
import type { ReversalConfirmation } from "./reversal-confirmation";
import type { SequentialEvidence } from "./sequential-evidence";

export type SignalTier = "CONFIRMED_REVERSAL" | "DEVELOPING_REVERSAL" | "EARLY_CANDIDATE";
export type EntryReadiness = "WAIT_NEXT_OPEN" | "REVIEW_RISK" | "SKIP";

export interface SignalTierInputs {
  confirmation?: ReversalConfirmation;
  sequential?: SequentialEvidence;
  rewardRisk: number | null;
  dataQuality?: DataQualityStatus;
  signalAgeCandles?: number;
  /** The production scanner does not know the next open. */
  nextOpen?: number;
  stop: number;
  target1: number;
}

export interface SignalTierResult {
  tier: SignalTier;
  tierScore: number;
  entryReadiness: EntryReadiness;
  tierReason: string;
  warnings: string[];
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Ranks already-valid Donchian signals. It never creates a signal and does not
 * turn an unavailable model probability into a score.
 */
export function classifySignalTier(input: SignalTierInputs): SignalTierResult {
  const confirmation = input.confirmation?.score ?? 0;
  const sequential = input.sequential?.reversalScore ?? 0;
  const persistence = input.sequential?.trendPersistenceScore ?? 0;
  const trend = input.sequential?.trendState;
  const data = input.dataQuality ?? "NOT_AUDITED";
  const reward = input.rewardRisk === null ? 50 : clamp(((input.rewardRisk - 1) / 2) * 100);
  const freshness = input.signalAgeCandles === undefined ? 100 : clamp(100 - input.signalAgeCandles * 20);
  const dataScore = data === "SESSION_WINDOW_COMPLETE" || data === "VERIFIED" ? 100 : data === "LIMITED" ? 55 : 0;
  const dataReliable = data === "SESSION_WINDOW_COMPLETE" || data === "VERIFIED";
  const trendScore = trend === "CONFIRMED_FLIP" ? 100 : trend === "TREND_EVIDENCE_SUPPORTED" ? 80 : trend === "DEVELOPING_FLIP" ? 55 : 25;
  const tierScore = round(clamp(
    0.25 * confirmation + 0.20 * sequential * 100 + 0.15 * trendScore +
      0.15 * persistence * 100 + 0.10 * reward + 0.10 * dataScore + 0.05 * freshness,
  ));
  const warnings: string[] = [];
  if (trend === "REVERSAL_CANDIDATE") warnings.push("Trend follow-through is not confirmed");
  if (input.sequential?.sgSlope !== undefined && input.sequential.sgSlope < 0) warnings.push("Smoothed price direction is still falling");
  if (data === "LIMITED" || data === "NOT_AUDITED") warnings.push("Data-quality audit is incomplete");
  if (input.rewardRisk === null) warnings.push("No causally confirmed overhead reaction high is available");
  else if (input.rewardRisk < 1.5) warnings.push("Room to the reaction high is below the preferred 1.50R minimum");
  const independentGroups = input.sequential?.independentGroupCount;
  if (independentGroups !== undefined && independentGroups < 2) {
    warnings.push("Fewer than two independent confirmation groups support the reversal");
  }
  const bayesianChange = input.sequential?.bayesianChangePoint?.bullishChangeEvidence;
  const latentSlope = input.sequential?.stateSpaceTrend?.slopePositiveProbability;
  const sgAgreement = input.sequential?.sgPositiveSlopeAgreement;
  const context = input.sequential?.context;
  if (bayesianChange !== undefined && bayesianChange < 0.45) warnings.push("Bayesian run-length evidence does not support a bullish change");
  if (latentSlope !== undefined && latentSlope < 0.5) warnings.push("Latent trend slope remains non-positive");
  if (sgAgreement !== undefined && sgAgreement < 2 / 3) warnings.push("Causal smoothing is not stable across windows");
  if (context?.higherTimeframeTrend === "BEARISH") warnings.push("Completed higher timeframe remains bearish");
  if (context?.relativeStrengthState === "BEARISH") warnings.push("Stock is underperforming the NIFTY benchmark");
  const contextAcceptable = context === undefined ||
    (context.higherTimeframeTrend !== "BEARISH" && context.relativeStrengthState !== "BEARISH");
  const advancedEvidence = (independentGroups ?? 0) >= 3 &&
    (bayesianChange ?? 0) >= 0.55 && (latentSlope ?? 0) >= 0.6 && (sgAgreement ?? 0) >= 2 / 3;
  const roomAdequate = input.rewardRisk !== null && input.rewardRisk >= 1.5;
  const strongEvidence = confirmation >= 75 && sequential >= 0.65 && trendScore >= 55 && roomAdequate && dataReliable && advancedEvidence && contextAcceptable;
  const confirmedEvidence = confirmation >= 60 && sequential >= 0.45 && roomAdequate && (independentGroups ?? 0) >= 2 && contextAcceptable;
  const tier: SignalTier = strongEvidence ? "CONFIRMED_REVERSAL" : confirmedEvidence ? "DEVELOPING_REVERSAL" : "EARLY_CANDIDATE";
  const tierReason = tier === "CONFIRMED_REVERSAL"
    ? "Strong candle evidence and sequential reversal evidence support the Donchian setup."
    : tier === "DEVELOPING_REVERSAL"
      ? "The Donchian setup is valid, but trend follow-through is still developing."
      : "The Donchian gate qualifies, but secondary evidence is limited; treat this as an early candidate.";
  let entryReadiness: EntryReadiness = "WAIT_NEXT_OPEN";
  if (input.nextOpen !== undefined && (input.nextOpen <= input.stop || input.nextOpen >= input.target1)) entryReadiness = "SKIP";
  else if (input.nextOpen !== undefined) entryReadiness = "REVIEW_RISK";
  return { tier, tierScore, entryReadiness, tierReason, warnings };
}

export function tierLabel(tier: SignalTier): string {
  return tier === "CONFIRMED_REVERSAL" ? "BUY — CONFIRMED REVERSAL"
    : tier === "DEVELOPING_REVERSAL" ? "BUY — DEVELOPING REVERSAL" : "BUY — EARLY CANDIDATE";
}
