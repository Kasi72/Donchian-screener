import { expect, it } from "vitest";
import { bullishRollover } from "@/lib/signals/donchian";

it("admits at most one period under exact tick touch and strict rollover", () => {
  // Exhaustive small histories include ties, monotone runs and repeated lows.
  for (let code = 0; code < 3 ** 7; code++) {
    let value = code;
    const candles = Array.from({ length: 7 }, (_, time) => {
      const low = 100 + (value % 3) * 0.05;
      value = Math.floor(value / 3);
      return { time, low, open: low + 1, close: low + 1, high: low + 2, volume: 100 };
    });
    const valid = Array.from({ length: 6 }, (_, n) => n + 1)
      .filter((n) => bullishRollover(candles, 6, n, 0.05).passed);
    expect(valid.length).toBeLessThanOrEqual(1);
  }
});
