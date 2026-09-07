import { describe, expect, it } from "vitest";

import { calculateReversalConfirmation } from "@/lib/signals/reversal-confirmation";
import type { Candle } from "@/lib/market/provider";

function candles(count = 40): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    time: index,
    open: 100 + index * 0.1,
    high: 101 + index * 0.1,
    low: 99 + index * 0.1,
    close: 100.5 + index * 0.1,
    volume: 1_000,
  }));
}

describe("calculateReversalConfirmation", () => {
  it("scores a strong lower-channel rejection using only candles through the signal", () => {
    const history = candles();
    history[39] = {
      time: 39,
      open: 96,
      high: 103,
      low: 90,
      close: 101,
      volume: 3_000,
    };

    const result = calculateReversalConfirmation(history, 39, 10, 90, 0.05);

    expect(result.version).toBe("confirmation-v2");
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.closeLocation).toBeCloseTo(11 / 13, 6);
    expect(result.lowerWickRatio).toBeCloseTo(6 / 13, 6);
    expect(result.grade).toMatch(/CONFIRMED|STRONG/);
  });

  it("does not use a future candle when calculating confirmation metrics", () => {
    const history = candles();
    const base = calculateReversalConfirmation(history, 39, 10, 102.9, 0.05);
    history.push({
      time: 40,
      open: 100,
      high: 120,
      low: 80,
      close: 119,
      volume: 99_000,
    });

    const withFuture = calculateReversalConfirmation(history, 39, 10, 102.9, 0.05);

    expect(withFuture).toEqual(base);
  });

  it("audits the unique qualifying period without penalizing its evidence score", () => {
    const history = candles();
    history[29] = { time: 29, open: 86, high: 88, low: 80, close: 84, volume: 1_000 };
    history[39] = { time: 39, open: 96, high: 103, low: 90, close: 101, volume: 3_000 };

    const result = calculateReversalConfirmation(history, 39, 10, 90, 0.05);

    expect(result.validPeriodCount).toBe(1);
    // Changing only the audit window must not change candle evidence.
    const other = calculateReversalConfirmation(history, 39, 5, 90, 0.05);
    expect(other.validPeriodCount).toBe(0);
    expect(other.score).toBe(result.score);
    expect(result.validPeriodRange[0]).toBeLessThanOrEqual(10);
    expect(result.validPeriodRange[1]).toBeGreaterThanOrEqual(10);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("uses the same N±2 stability neighborhood as the period selector", () => {
    const history = candles();
    const result = calculateReversalConfirmation(history, 39, 10, 90, 0.05);

    expect(result.validPeriodRange[0]).toBeGreaterThanOrEqual(8);
    expect(result.validPeriodRange[1]).toBeLessThanOrEqual(12);
  });

  it("compares channel touches on exchange ticks, not binary price decimals", () => {
    const history = candles();
    history[39] = {
      time: 39,
      open: 96,
      high: 103,
      low: 90.02,
      close: 101,
      volume: 3_000,
    };

    const result = calculateReversalConfirmation(history, 39, 10, 90.01, 0.05);

    expect(result.reasons).toContain("signal low is aligned with the selected lower channel");
  });
});
