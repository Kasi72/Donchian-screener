import type { Timeframe } from "@/lib/market/provider";

export const MODEL_PROMOTION_POLICY_VERSION = "promotion-gates-v1" as const;

export interface ModelValidationEvidence {
  timeframe: Timeframe;
  featureVersion: string;
  labelVersion: string;
  matureSignals: number;
  minimumOutcomeClassCount: number;
  chronologicalFolds: number;
  outOfSampleBrier: number;
  baseRateBrier: number;
  outOfSampleLogLoss: number;
  baseRateLogLoss: number;
  calibrationError: number;
  conformalTargetCoverage: number;
  conformalObservedCoverage: number;
  netExpectancyLower95R: number;
  stressedNetExpectancyR: number;
  prospectiveShadowDays: number;
  providerAdjustmentAuditPassed: boolean;
  survivorshipAuditPassed: boolean;
  driftStatus: "STABLE" | "WATCH" | "DISABLE_MODEL" | "INSUFFICIENT_DATA";
}

export interface ModelPromotionDecision {
  policyVersion: typeof MODEL_PROMOTION_POLICY_VERSION;
  status: "ELIGIBLE" | "SHADOW_ONLY" | "REJECTED";
  failures: string[];
}

/** Versioned, pre-stated gates. Passing makes a model eligible for controlled
 * activation; it does not automatically deploy or change Donchian signals. */
export function assessModelPromotion(evidence: ModelValidationEvidence): ModelPromotionDecision {
  const numeric = [evidence.matureSignals, evidence.minimumOutcomeClassCount, evidence.chronologicalFolds,
    evidence.outOfSampleBrier, evidence.baseRateBrier, evidence.outOfSampleLogLoss, evidence.baseRateLogLoss,
    evidence.calibrationError, evidence.conformalTargetCoverage, evidence.conformalObservedCoverage,
    evidence.netExpectancyLower95R, evidence.stressedNetExpectancyR, evidence.prospectiveShadowDays];
  if (numeric.some((value) => !Number.isFinite(value))) throw new RangeError("Model validation evidence must be finite");
  const failures: string[] = [];
  if (evidence.matureSignals < 1_000) failures.push("Fewer than 1,000 matured timeframe-specific signals");
  if (evidence.minimumOutcomeClassCount < 50) failures.push("An outcome class has fewer than 50 observations");
  if (evidence.chronologicalFolds < 4) failures.push("Fewer than four usable chronological folds");
  if (!(evidence.outOfSampleBrier < evidence.baseRateBrier)) failures.push("Brier score does not beat the base-rate model");
  if (!(evidence.outOfSampleLogLoss < evidence.baseRateLogLoss)) failures.push("Log loss does not beat the base-rate model");
  if (evidence.calibrationError > 0.08) failures.push("Expected calibration error exceeds 0.08");
  if (Math.abs(evidence.conformalObservedCoverage - evidence.conformalTargetCoverage) > 0.03) failures.push("Conformal coverage misses its target by more than 3 percentage points");
  if (!(evidence.netExpectancyLower95R > 0)) failures.push("Lower 95% expectancy bound is not positive after costs");
  if (evidence.stressedNetExpectancyR < 0) failures.push("Expectancy is negative under the pre-stated cost stress");
  if (!evidence.providerAdjustmentAuditPassed) failures.push("Provider adjustment audit has not passed");
  if (!evidence.survivorshipAuditPassed) failures.push("Survivorship audit has not passed");
  if (evidence.driftStatus !== "STABLE") failures.push(`Model drift status is ${evidence.driftStatus}`);
  const structuralFailureCount = failures.length;
  if (structuralFailureCount) return { policyVersion: MODEL_PROMOTION_POLICY_VERSION, status: "REJECTED", failures };
  if (evidence.prospectiveShadowDays < 60) return { policyVersion: MODEL_PROMOTION_POLICY_VERSION, status: "SHADOW_ONLY", failures: ["Fewer than 60 days of prospective shadow evaluation"] };
  return { policyVersion: MODEL_PROMOTION_POLICY_VERSION, status: "ELIGIBLE", failures: [] };
}
