import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/market/provider";
import { auditDailyCandleWindow } from "@/lib/market/window-audit";

function candle(day: number): Candle {
  return {
    time: Date.UTC(2026, 1, day, 3, 45),
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 1_000,
  };
}

describe("daily candle window audit", () => {
  it("detects a missing NSE session inside a signal window", () => {
    const result = auditDailyCandleWindow([candle(2), candle(3), candle(5)], 0, 2);

    expect(result).toEqual({
      expectedSessions: 4,
      observedSessions: 3,
      missingSessions: 1,
      complete: false,
    });
  });

  it("does not count weekends as missing sessions", () => {
    const result = auditDailyCandleWindow([candle(6), candle(9)], 0, 1);

    expect(result).toEqual({
      expectedSessions: 2,
      observedSessions: 2,
      missingSessions: 0,
      complete: true,
    });
  });
});
