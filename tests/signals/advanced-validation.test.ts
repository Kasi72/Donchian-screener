import { describe, expect, it } from "vitest";
import { benjaminiHochberg, bayesianRate, conformalProbabilityInterval, conformalProbabilityIntervalFor, localBayesianProbabilityIntervalFor, purgedWalkForwardFolds } from "@/lib/signals/advanced-validation";
import { fitPurgedWalkForwardCalibration } from "@/lib/signals/calibration-pipeline";

describe("advanced validation primitives", () => {
  it("shrinks small samples toward the Jeffreys prior and bounds uncertainty", () => {
    const result = bayesianRate(1, 2);
    expect(result.estimate).toBeGreaterThan(0.25);
    expect(result.estimate).toBeLessThan(0.75);
    expect(result.lower).toBeGreaterThanOrEqual(0);
    expect(result.upper).toBeLessThanOrEqual(1);
  });

  it("centres a live conformal interval on the requested prediction", () => {
    const interval = conformalProbabilityIntervalFor(0.25, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], [0, 0, 0, 0, 1, 1, 1, 1]);
    expect(interval[0]).toBeLessThanOrEqual(0.25);
    expect(interval[1]).toBeGreaterThanOrEqual(0.25);
  });

  it("uses local outcome evidence instead of binary residual width for uncertainty", () => {
    const interval = localBayesianProbabilityIntervalFor(0.2, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], [1, 1, 1, 1, 1, 1, 1, 1], 0.95);
    expect(interval[0]).toBeGreaterThan(0.5);
    expect(interval[1]).toBeLessThanOrEqual(1);
  });

  it("creates a bounded split-conformal interval from held-out outcomes", () => {
    const interval = conformalProbabilityInterval([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], [0, 0, 0, 0, 1, 1, 1, 1]);
    expect(interval[0]).toBeGreaterThanOrEqual(0);
    expect(interval[1]).toBeLessThanOrEqual(1);
    expect(interval[0]).toBeLessThanOrEqual(interval[1]);
  });

  it("keeps chronological test folds separated by the purge gap", () => {
    const folds = purgedWalkForwardFolds(100, 4, 10, 3, 2);
    expect(folds).toHaveLength(4);
    for (const fold of folds) expect(fold.train[1]).toBeLessThanOrEqual(fold.test[0] - 3);
  });

  it("adjusts p-values without changing their order", () => {
    const adjusted = benjaminiHochberg([0.001, 0.02, 0.5]);
    expect(adjusted[0]).toBeLessThanOrEqual(adjusted[1]);
    expect(adjusted[1]).toBeLessThanOrEqual(adjusted[2]);
  });

  it("keeps calibration unavailable when the purged OOS sample is too small", () => {
    const result = fitPurgedWalkForwardCalibration([0.2, 0.3, 0.7, 0.8, 0.4, 0.6, 0.1, 0.9], [0, 0, 1, 1, 0, 1, 0, 1], { folds: 3 });
    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.model).toBeNull();
  });
});
