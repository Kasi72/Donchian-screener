import { describe, expect, it } from "vitest";
import { calculateMovingAverageEvidence } from "@/lib/signals/moving-averages";

const candles = Array.from({ length: 40 }, (_, index) => {
  const close = 100 + index * 0.5;
  return { time: index, open: close - 0.1, high: close + 0.2, low: close - 0.2, close, volume: 1000 };
});

describe("causal moving-average evidence", () => {
  it("returns finite ATR-normalized evidence for a completed candle", () => {
    const result = calculateMovingAverageEvidence(candles, candles.length - 1, 1);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.emaFast).toBeGreaterThan(result.emaSlow);
    expect(Number.isFinite(result.kama)).toBe(true);
    expect(Number.isFinite(result.t3)).toBe(true);
  });

  it("rejects invalid causal inputs", () => {
    expect(() => calculateMovingAverageEvidence(candles, 0, 1)).toThrow(RangeError);
    expect(() => calculateMovingAverageEvidence(candles, 5, 0)).toThrow(RangeError);
  });
});
