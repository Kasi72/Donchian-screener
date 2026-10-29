import { describe, expect, it } from "vitest";

import { assessModelPromotion, type ModelValidationEvidence } from "@/lib/signals/model-validation";

const valid: ModelValidationEvidence = {
  timeframe: "1d", featureVersion: "signal-close-features-v2", labelVersion: "joint-outcomes-v2",
  matureSignals: 2_000, minimumOutcomeClassCount: 100, chronologicalFolds: 5,
  outOfSampleBrier: 0.18, baseRateBrier: 0.22, outOfSampleLogLoss: 0.52, baseRateLogLoss: 0.61,
  calibrationError: 0.04, conformalTargetCoverage: 0.9, conformalObservedCoverage: 0.89,
  netExpectancyLower95R: 0.05, stressedNetExpectancyR: 0.01, prospectiveShadowDays: 90,
  providerAdjustmentAuditPassed: true, survivorshipAuditPassed: true, driftStatus: "STABLE",
};

describe("model promotion gates", () => {
  it("accepts only fully validated timeframe-specific evidence", () => {
    expect(assessModelPromotion(valid)).toEqual({ policyVersion: "promotion-gates-v1", status: "ELIGIBLE", failures: [] });
  });

  it("keeps an otherwise valid model in shadow evaluation", () => {
    expect(assessModelPromotion({ ...valid, prospectiveShadowDays: 30 }).status).toBe("SHADOW_ONLY");
  });

  it("rejects optimistic metrics without data and audit support", () => {
    const result = assessModelPromotion({ ...valid, matureSignals: 200, providerAdjustmentAuditPassed: false, netExpectancyLower95R: -0.01 });
    expect(result.status).toBe("REJECTED");
    expect(result.failures).toHaveLength(3);
  });
});
