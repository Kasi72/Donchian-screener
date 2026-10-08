import { describe, expect, it } from "vitest";

import { assessExecutionQuality } from "@/lib/signals/execution-quality";
import type { Candle } from "@/lib/market/provider";
import type { TradeLevels } from "@/lib/signals/risk-levels";

const candles = (volume: number, gap = 0): Candle[] => Array.from({ length: 30 }, (_, index) => ({
  time: index, open: 100 + (index === 29 ? gap : 0), high: 102 + (index === 29 ? gap : 0),
  low: 98, close: 100, volume,
}));
const levels = { entry: 100, stop: 98, target1: 102, target2: 104, riskPerShare: 2, riskPercent: 2 } as TradeLevels;

describe("assessExecutionQuality", () => {
  it("accepts liquid, bounded-risk completed-candle setups", () => {
    expect(assessExecutionQuality(candles(2_000_000), 29, "1d", levels).status).toBe("EXECUTABLE");
  });

  it("separates liquidity, wide-stop and gap warnings", () => {
    expect(assessExecutionQuality(candles(1_000), 29, "1d", levels).status).toBe("INSUFFICIENT_LIQUIDITY");
    expect(assessExecutionQuality(candles(2_000_000), 29, "1d", { ...levels, riskPercent: 8 }).status).toBe("WIDE_STOP");
    expect(assessExecutionQuality(candles(2_000_000, 10), 29, "1d", levels).status).toBe("REVIEW_GAP_RISK");
  });
});
