import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/market/provider";
import { classifyMarketRegime } from "@/lib/signals/market-regime";

function steadyGrowth(rate: number, count = 40): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 * Math.exp(rate * index);
    return { time: index, open: close, high: close * 1.001, low: close * 0.999, close, volume: 1_000 };
  });
}

describe("classifyMarketRegime", () => {
  it("recognizes a steady positive drift as bullish rather than range-bound", () => {
    const candles = steadyGrowth(0.003);
    const result = classifyMarketRegime(candles, candles.length - 1, 30);
    expect(result.trendZ).toBeGreaterThan(1.2);
    expect(result.regime).toBe("TRENDING_BULL");
  });

  it("recognizes a steady negative drift as bearish rather than range-bound", () => {
    const candles = steadyGrowth(-0.003);
    const result = classifyMarketRegime(candles, candles.length - 1, 30);
    expect(result.trendZ).toBeLessThan(-1.2);
    expect(result.regime).toBe("TRENDING_BEAR");
  });
});
