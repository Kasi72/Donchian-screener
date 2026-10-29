import { describe, expect, it } from "vitest";
import { aggregateCompletedCandles, blockBootstrapInterval, costAdjustedExpectancy } from "@/lib/signals/statistical-risk";

describe("statistical risk safeguards", () => {
  it("returns a deterministic block-bootstrap interval", () => {
    const first = blockBootstrapInterval([1, 2, -1, 3, 0, 2, -2, 1], 2, 100, 9);
    const second = blockBootstrapInterval([1, 2, -1, 3, 0, 2, -2, 1], 2, 100, 9);
    expect(first).toEqual(second);
    expect(first.lower).toBeLessThanOrEqual(first.estimate);
    expect(first.upper).toBeGreaterThanOrEqual(first.estimate);
  });

  it("does not call a cost-negative expectancy actionable", () => {
    const result = costAdjustedExpectancy([0.1, 0.2], [1, 1], [100, 100], 50, 25);
    expect(result.netExpectancyR).toBeLessThan(result.grossExpectancyR);
    expect(result.actionable).toBe(false);
  });

  it("charges slippage and fees on both sides and rejects non-finite returns", () => {
    const result = costAdjustedExpectancy([1], [10], [100], 10, 5);
    expect(result.costR).toBeCloseTo(0.03, 12);
    expect(result.netExpectancyR).toBeCloseTo(0.97, 12);
    expect(() => costAdjustedExpectancy([Number.NaN], [10], [100], 10, 5)).toThrow(RangeError);
  });

  it("rejects non-finite bootstrap observations", () => {
    expect(() => blockBootstrapInterval([1, Number.NaN], 1, 100)).toThrow(RangeError);
  });

  it("aggregates ordered daily candles without future leakage", () => {
    const candles = [0, 1, 2].map((day) => ({ time: Date.UTC(2026, 0, 5 + day), open: 100 + day, high: 105 + day, low: 95 + day, close: 103 + day, volume: 1000 }));
    const weekly = aggregateCompletedCandles(candles, "1wk");
    expect(weekly).toHaveLength(1);
    expect(weekly[0]).toMatchObject({ open: 100, high: 107, low: 95, close: 105, volume: 3000 });
  });
});
