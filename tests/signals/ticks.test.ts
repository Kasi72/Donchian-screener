import { describe, expect, it } from "vitest";

import { priceToTicks, ticksToPrice } from "@/lib/signals/ticks";

describe("tick arithmetic", () => {
  it("maps decimal prices to stable integer ticks", () => {
    expect(priceToTicks(0.3, 0.1)).toBe(3);
    expect(priceToTicks(271.6, 0.05)).toBe(5432);
    expect(priceToTicks(100.00000000000001, 0.05)).toBe(2000);
  });

  it("round-trips tick prices without binary-fraction noise", () => {
    expect(ticksToPrice(5432, 0.05)).toBe(271.6);
    expect(ticksToPrice(19, 0.05)).toBe(0.95);
  });

  it("rejects invalid tick sizes and prices", () => {
    expect(() => priceToTicks(Number.NaN, 0.05)).toThrow(RangeError);
    expect(() => priceToTicks(100, 0)).toThrow(RangeError);
    expect(() => ticksToPrice(1, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
