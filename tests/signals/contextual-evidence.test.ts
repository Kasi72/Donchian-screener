import { describe, expect, it } from "vitest";

import type { Candle } from "@/lib/market/provider";
import { calculateContextualEvidence } from "@/lib/signals/contextual-evidence";

const day = 86_400_000;
const candles = (returnPerBar: number): Candle[] => {
  let close = 100;
  return Array.from({ length: 35 }, (_, index) => {
    const open = close;
    close *= Math.exp(returnPerBar);
    return { time: Date.UTC(2026, 0, 1) + index * day, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1_000 };
  });
};

describe("calculateContextualEvidence", () => {
  it("uses completed higher-timeframe groups and aligned benchmark returns", () => {
    const result = calculateContextualEvidence(candles(0.01), 34, "1d", candles(0.002));
    expect(result.higherTimeframe).toBe("1wk");
    expect(result.higherTimeframeTrend).toBe("BULLISH");
    expect(result.relativeStrengthState).toBe("BULLISH");
    expect(result.relativeStrengthZ).toBeGreaterThan(0.5);
  });

  it("keeps unavailable inputs neutral and never fabricates context", () => {
    const result = calculateContextualEvidence(candles(0), 10, "1mo");
    expect(result.higherTimeframe).toBeNull();
    expect(result.higherTimeframeTrend).toBe("UNAVAILABLE");
    expect(result.relativeStrengthZ).toBeNull();
  });
});
