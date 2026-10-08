import { describe, expect, it } from "vitest";

import { assessPredictionDrift, populationStabilityIndex } from "@/lib/signals/model-drift";

describe("model drift", () => {
  it("detects a displaced score distribution", () => {
    const reference = Array.from({ length: 200 }, (_, index) => (index % 100) / 100);
    const shifted = Array.from({ length: 100 }, (_, index) => 0.8 + (index % 20) / 100);
    expect(populationStabilityIndex(reference, shifted)).toBeGreaterThan(0.25);
  });

  it("disables a materially drifted or miscalibrated model", () => {
    const reference = Array.from({ length: 200 }, (_, index) => (index % 100) / 100);
    const scores = Array.from({ length: 100 }, () => 0.9);
    const outcomes = Array.from({ length: 100 }, () => 0) as (0 | 1)[];
    const result = assessPredictionDrift({ referenceScores: reference, recentScores: scores, recentOutcomes: outcomes });
    expect(result.status).toBe("DISABLE_MODEL");
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
