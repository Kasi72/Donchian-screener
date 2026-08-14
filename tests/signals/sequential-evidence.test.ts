import { describe, expect, it } from "vitest";

import type { Candle } from "@/lib/market/provider";
import { calculateSequentialEvidence } from "@/lib/signals/sequential-evidence";

function series(returns: number[]): Candle[] {
  let close = 100;
  return returns.map((ret, index) => {
    const open = close;
    close *= Math.exp(ret);
    const low = Math.min(open, close) - 0.2;
    const high = Math.max(open, close) + 0.2;
    return { time: index, open, high, low, close, volume: 1_000 };
  });
}

describe("calculateSequentialEvidence", () => {
  it("is causal and produces strong bullish evidence after a robust regime shift", () => {
    const candles = series([
      ...Array.from({ length: 30 }, () => -0.004),
      ...Array.from({ length: 8 }, () => 0.012),
    ]);
    const evidence = calculateSequentialEvidence(candles, candles.length - 1);

    expect(evidence.version).toBe("sequential-v1");
    expect(evidence.cusumScore).toBeGreaterThan(0.5);
    expect(evidence.changePointProbability).toBeGreaterThan(0.5);
    expect(evidence.reversalScore).toBeGreaterThan(0.5);
    expect(evidence.calibration).toBe("UNCALIBRATED");
    expect(evidence.calibratedProbability).toBeNull();
    expect(evidence.sgSlope).toBeGreaterThan(0);
    expect(evidence.sgCurvature).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(evidence.volatilityZ)).toBe(true);
    expect(evidence.overlayScore).toBeGreaterThan(0.5);

    candles.push({ time: 99, open: 1, high: 2, low: 0.5, close: 1.9, volume: 99_000 });
    expect(calculateSequentialEvidence(candles, candles.length - 2)).toEqual(evidence);
  });

  it("uses endpoint-only smoothing so future candles cannot change the overlay", () => {
    const candles = series([
      ...Array.from({ length: 30 }, () => -0.004),
      ...Array.from({ length: 8 }, () => 0.012),
    ]);
    const before = calculateSequentialEvidence(candles, candles.length - 1);
    candles.push({ time: 99, open: 1, high: 2, low: 0.5, close: 1.9, volume: 99_000 });
    const after = calculateSequentialEvidence(candles, candles.length - 2);
    expect(after.sgSlope).toBe(before.sgSlope);
    expect(after.sgCurvature).toBe(before.sgCurvature);
    expect(after.volatilityZ).toBe(before.volatilityZ);
  });

  it("does not manufacture bullish evidence from a continuing decline", () => {
    const candles = series(Array.from({ length: 38 }, () => -0.006));
    const evidence = calculateSequentialEvidence(candles, candles.length - 1);

    expect(evidence.reversalScore).toBeLessThan(0.5);
    expect(evidence.state).toBe("EARLIEST_CANDIDATE");
  });

  it("rejects non-causal indexes and insufficient histories", () => {
    expect(() => calculateSequentialEvidence(series([0.01, 0.01]), 1)).toThrow(RangeError);
    expect(() => calculateSequentialEvidence(series([0.01, 0.01, 0.01]), 4)).toThrow(RangeError);
  });
});
