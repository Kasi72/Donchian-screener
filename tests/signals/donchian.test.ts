import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/market/provider";
import { bullishRollover, lowerChannel } from "@/lib/signals/donchian";

function candle(index: number, low: number): Candle {
  return {
    time: index * 60_000,
    open: low + 1,
    high: low + 2,
    low,
    close: low + 1,
    volume: 1_000,
  };
}

function exactRolloverFixture(period: 51 | 94): Candle[] {
  // At signal t=period, j=0 gives N=t-j for the window-boundary fixture.
  // Previous [j..t-1] includes the outgoing 90 low; current [j+1..t] excludes it.
  const candles = Array.from({ length: period + 1 }, (_, index) =>
    candle(index, 110 + (index % 7)),
  );
  candles[0] = candle(0, 90);
  candles[1] = candle(1, 101);
  candles[period] = candle(period, 101);
  return candles;
}

describe("Donchian lower channel", () => {
  it("uses exactly 51 bars in each inclusive rollover window", () => {
    const candles = exactRolloverFixture(51);

    expect(lowerChannel(candles, 51, 51)).toBe(101);
    expect(lowerChannel(candles, 50, 51)).toBe(90);
    expect(bullishRollover(candles, 51, 51, 0.05)).toEqual({
      passed: true,
      currentLdc: 101,
      previousLdc: 90,
    });
  });

  it("uses exactly 94 bars in each inclusive rollover window", () => {
    const candles = exactRolloverFixture(94);

    expect(lowerChannel(candles, 94, 94)).toBe(101);
    expect(lowerChannel(candles, 93, 94)).toBe(90);
    expect(bullishRollover(candles, 94, 94, 0.05)).toEqual({
      passed: true,
      currentLdc: 101,
      previousLdc: 90,
    });
  });

  it("includes both endpoints and excludes the candle just before the window", () => {
    const candles = [candle(0, 1), candle(1, 2), candle(2, 5), candle(3, 4)];

    expect(lowerChannel(candles, 3, 3)).toBe(2);
  });

  it("includes t when the right endpoint is the unique channel minimum", () => {
    const candles = [candle(0, 1), candle(1, 8), candle(2, 7), candle(3, 2)];

    expect(lowerChannel(candles, 3, 3)).toBe(2);
  });

  it("compares equal prices as integer tick units rather than float tolerance", () => {
    const candles = [
      candle(0, 90),
      candle(1, 100.1),
      candle(2, 105),
      candle(3, 100.10000000000001),
    ];

    expect(bullishRollover(candles, 3, 3, 0.05)).toEqual({
      passed: true,
      currentLdc: 100.1,
      previousLdc: 90,
    });

    candles[3] = candle(3, 100.15);
    expect(bullishRollover(candles, 3, 3, 0.05).passed).toBe(false);
  });

  it("uses raw channel values for the rise even when both occupy the same tick", () => {
    const candles = [
      candle(0, 100.11),
      candle(1, 100.12),
      candle(2, 105),
      candle(3, 100.12),
    ];

    expect(bullishRollover(candles, 3, 3, 0.05)).toEqual({
      passed: true,
      currentLdc: 100.12,
      previousLdc: 100.11,
    });
  });

  it.each([0, -1, 1.5])("rejects invalid period %s", (period) => {
    expect(() => lowerChannel([candle(0, 1)], 0, period)).toThrow(RangeError);
  });

  it("rejects out-of-range indices and insufficient rollover history", () => {
    const candles = [candle(0, 1), candle(1, 2), candle(2, 3)];

    expect(() => lowerChannel(candles, -1, 1)).toThrow(RangeError);
    expect(() => lowerChannel(candles, 3, 1)).toThrow(RangeError);
    expect(() => lowerChannel(candles, 1, 3)).toThrow(RangeError);
    expect(() => bullishRollover(candles, 2, 3, 0.05)).toThrow(RangeError);
  });
});
