import { describe, expect, it } from "vitest";

import { applyPlattCalibration, fitPlattCalibration } from "@/lib/signals/calibration";

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
