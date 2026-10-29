import { describe, expect, it } from "vitest";

import { bayesianOnlineChangePoint } from "@/lib/signals/bayesian-change-point";

describe("bayesianOnlineChangePoint", () => {
  it("detects a recent positive distributional shift", () => {
    const values = [
      ...Array.from({ length: 35 }, (_, index) => -0.005 + (index % 3) * 0.0002),
      0.011, 0.012, 0.010,
    ];
    const evidence = bayesianOnlineChangePoint(values);
    expect(evidence.shortRunProbability).toBeGreaterThan(0.2);
    expect(evidence.positiveShiftProbability).toBeGreaterThan(0.9);
    expect(evidence.bullishChangeEvidence).toBeGreaterThan(0.45);
    expect(evidence.mostLikelyRunLength).toBeLessThanOrEqual(5);
  });

  it("does not call a continuing decline a bullish change", () => {
    const values = Array.from({ length: 40 }, (_, index) => -0.006 + (index % 2) * 0.0001);
    const evidence = bayesianOnlineChangePoint(values);
    expect(evidence.positiveShiftProbability).toBeLessThan(0.7);
    expect(evidence.bullishChangeEvidence).toBeLessThan(0.6);
  });

  it("is neutral with insufficient history and rejects non-finite values", () => {
    expect(bayesianOnlineChangePoint([0, 0.01]).bullishChangeEvidence).toBe(0.5);
    expect(() => bayesianOnlineChangePoint([0, Number.NaN])).toThrow(RangeError);
  });
});
