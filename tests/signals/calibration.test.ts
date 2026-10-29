import { describe, expect, it } from "vitest";

import { applyBetaCalibration, applyCalibration, applyPlattCalibration, fitBetaCalibration, fitPlattCalibration } from "@/lib/signals/calibration";

describe("Platt calibration", () => {
  it("fits a monotonic out-of-sample probability mapping", () => {
    const model = fitPlattCalibration(
      [0.05, 0.15, 0.25, 0.7, 0.8, 0.95],
      [0, 0, 0, 1, 1, 1],
    );
    const low = applyPlattCalibration(model, 0.2);
    const high = applyPlattCalibration(model, 0.8);
    expect(model.version).toBe("platt-v1");
    expect(low).toBeLessThan(high);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1);
  });

  it("rejects mismatched or degenerate training data", () => {
    expect(() => fitPlattCalibration([0.2], [])).toThrow(RangeError);
    expect(() => fitPlattCalibration([0.2, 0.3], [0, 2] as (0 | 1)[])).toThrow(RangeError);
    expect(() => fitPlattCalibration([0.2, 0.3], [0, 0])).toThrow(RangeError);
  });
});

describe("Beta calibration", () => {
  it("fits a bounded monotonic map that can preserve an identity-like score", () => {
    const scores = [0.05, 0.15, 0.25, 0.4, 0.6, 0.75, 0.85, 0.95];
    const outcomes = [0, 0, 0, 0, 1, 1, 1, 1] as const;
    const model = fitBetaCalibration(scores, outcomes);
    const low = applyBetaCalibration(model, 0.2);
    const high = applyCalibration(model, 0.8);
    expect(model.version).toBe("beta-v1");
    expect(low).toBeLessThan(high);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1);
  });
});
