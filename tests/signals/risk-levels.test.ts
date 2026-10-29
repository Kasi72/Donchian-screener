import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/market/provider";
import { calculateTradeLevels } from "@/lib/signals/risk-levels";

function candle(
  index: number,
  high = 102.03,
  low = 100.03,
  close = 101.03,
): Candle {
  return {
    time: index * 60_000,
    open: close,
    high,
    low,
    close,
    volume: 1_000,
  };
}

function levelsFixture(): Candle[] {
  const candles = Array.from({ length: 18 }, (_, index) => candle(index));
  // A strict reaction-high pivot, confirmed at index 12 and therefore known
  // before the signal at index 17.
  candles[10] = candle(10, 103.03, 101.03, 102.03);
  return candles;
}

describe("trade levels", () => {
  it("rounds every level to conservative integer ticks", () => {
    const levels = calculateTradeLevels(levelsFixture(), 17, 0, 0.05);

    expect(levels).not.toBeNull();
    expect(levels?.entry).toBeCloseTo(101.05, 12);
    expect(levels?.stop).toBeCloseTo(99.8, 12);
    expect(levels?.target1).toBeCloseTo(102.3, 12);
    expect(levels?.target2).toBeCloseTo(103.55, 12);
    expect(levels?.reactionHigh).toBe(103);
    expect(levels?.rewardRisk).toBeCloseTo(1.95 / 1.25, 12);
    for (const price of [
      levels?.entry,
      levels?.stop,
      levels?.target1,
      levels?.target2,
      levels?.reactionHigh,
    ]) {
      expect(Math.round((price ?? 0) / 0.05)).toBeCloseTo((price ?? 0) / 0.05, 12);
    }
  });

  it("preserves a stop that is already exactly aligned to a decimal tick", () => {
    const candles = levelsFixture().map((value, index) =>
      candle(index, value.high + 0.02, value.low + 0.02, value.close + 0.02),
    );

    expect(calculateTradeLevels(candles, 17, 0, 0.05)?.stop).toBeCloseTo(
      99.85,
      12,
    );
  });

  it("uses at least one tick when ten percent of ATR is smaller", () => {
    const candles = Array.from({ length: 18 }, (_, index) =>
      candle(index, 100.23, 100.03, 100.13),
    );
    candles[10] = candle(10, 100.5, 100.3, 100.4);

    expect(calculateTradeLevels(candles, 17, 0, 0.05)?.stop).toBeCloseTo(
      99.95,
      12,
    );
  });

  it("preserves deterministic trade levels when reaction-high room is below Target1", () => {
    const candles = levelsFixture();
    candles[10] = candle(10, 102.2, 100.2, 101.2);

    const levels = calculateTradeLevels(candles, 17, 0, 0.05);
    expect(levels).not.toBeNull();
    expect(levels?.reactionHigh).toBe(102.2);
    expect(levels?.hasTarget1Room).toBe(false);
  });

  it("rejects zero or negative risk", () => {
    const candles = levelsFixture();
    candles[17] = candle(17, 101, 100, 99.8);

    expect(calculateTradeLevels(candles, 17, 0, 0.05)).toBeNull();
  });

  it("does not invent a reaction high from an unconfirmed or future high", () => {
    const candles = levelsFixture();
    candles[10] = candle(10, 102.03, 100.2, 101.2);
    candles[16] = candle(16, 500, 100.03, 101.03);
    candles.push(candle(18, 1_000, 100.03, 101.03));

    const levels = calculateTradeLevels(candles, 17, 0, 0.05);
    expect(levels).not.toBeNull();
    expect(levels?.reactionHigh).toBeNull();
    expect(levels?.rewardRisk).toBeNull();
    expect(levels?.hasTarget1Room).toBe(false);
  });
});
