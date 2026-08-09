import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/market/provider";
import { findConfirmedPivotLows } from "@/lib/signals/pivots";

function candle(index: number, low = 9, high = 11, close = 10): Candle {
  return { time: index * 60_000, open: close, high, low, close, volume: 1_000 };
}

function confirmedPivotFixture(): Candle[] {
  const candles = Array.from({ length: 18 }, (_, index) => candle(index));
  candles[14] = candle(14, 8, 10, 9);
  candles[15] = candle(15, 9, 11, 10);
  candles[16] = candle(16, 9, 12, 11);
  return candles;
}

describe("confirmed pivot lows", () => {
  it("does not expose an anchor until its right-side confirmation is available by t-1", () => {
    const candles = confirmedPivotFixture();

    expect(findConfirmedPivotLows(candles, 16)).toEqual([]);
    expect(findConfirmedPivotLows(candles, 17)).toEqual([
      {
        index: 14,
        time: 14 * 60_000,
        low: 8,
        prominenceAtr: 0.5,
        recoveryAtr: 2,
        confirmedAt: 16,
      },
    ]);
  });

  it("rejects an equal neighbouring low because a pivot must be strictly lower", () => {
    const candles = confirmedPivotFixture();
    candles[15] = candle(15, 8, 11, 10);

    expect(findConfirmedPivotLows(candles, 17)).toEqual([]);
  });

  it("is invariant to the evaluation candle and all future candles", () => {
    const original = confirmedPivotFixture();
    const changedFuture = original.slice();
    changedFuture[17] = candle(17, 1, 50, 40);
    changedFuture.push(candle(18, 0, 100, 90), candle(19, 0, 200, 180));

    const before = findConfirmedPivotLows(original, 17);
    const after = findConfirmedPivotLows(changedFuture, 17);

    expect(after).toEqual(before);
    expect(after.every((pivot) => pivot.confirmedAt <= 16)).toBe(true);
  });

  it("guards invalid evaluation indices and insufficient ATR history", () => {
    expect(() => findConfirmedPivotLows([], 0)).toThrow(RangeError);
    expect(() => findConfirmedPivotLows([candle(0)], 1)).toThrow(RangeError);
    expect(() => findConfirmedPivotLows(confirmedPivotFixture(), 19)).toThrow(
      RangeError,
    );
  });
});
