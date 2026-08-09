import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/market/provider";
import { atrAt, wilderAtr } from "@/lib/signals/atr";

function candle(
  index: number,
  high: number,
  low: number,
  close: number,
): Candle {
  return { time: index, open: close, high, low, close, volume: 1_000 };
}

describe("Wilder ATR", () => {
  it("seeds with the hand-calculated true-range mean and applies Wilder smoothing", () => {
    const candles = [
      candle(0, 10, 8, 9),
      candle(1, 12, 9, 11),
      candle(2, 13, 10, 12),
      candle(3, 16, 11, 15),
      candle(4, 15, 12, 13),
    ];

    const values = wilderAtr(candles, 3);

    expect(values.slice(0, 2)).toEqual([null, null]);
    expect(values[2]).toBeCloseTo(8 / 3, 12);
    expect(values[3]).toBeCloseTo(31 / 9, 12);
    expect(values[4]).toBeCloseTo(89 / 27, 12);
    expect(atrAt(candles, 4, 3)).toBeCloseTo(89 / 27, 12);
  });

  it.each([0, -1, 1.5])("rejects invalid period %s", (period) => {
    expect(() => wilderAtr([], period)).toThrow(RangeError);
  });

  it("rejects an ATR lookup without enough history", () => {
    const candles = [candle(0, 10, 8, 9), candle(1, 11, 9, 10)];

    expect(() => atrAt(candles, 1, 3)).toThrow(RangeError);
  });
});
