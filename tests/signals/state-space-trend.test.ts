import { describe, expect, it } from "vitest";

import { estimateStateSpaceTrend } from "@/lib/signals/state-space-trend";

describe("estimateStateSpaceTrend", () => {
  it("identifies a positive latent slope after a rounded reversal", () => {
    const prices = [100, 99, 98, 97, 96, 95, 94.5, 94.7, 95.2, 96, 97.2, 98.5].map(Math.log);
    const result = estimateStateSpaceTrend(prices);
    expect(result.slope).toBeGreaterThan(0);
    expect(result.slopePositiveProbability).toBeGreaterThan(0.5);
    expect(Number.isFinite(result.slopeStandardError)).toBe(true);
  });

  it("remains bearish for a persistent decline and clips an isolated shock", () => {
    const decline = Array.from({ length: 20 }, (_, index) => Math.log(100 - index));
    const bearish = estimateStateSpaceTrend(decline);
    const shocked = estimateStateSpaceTrend([...decline.slice(0, -1), Math.log(70)]);
    expect(bearish.slopePositiveProbability).toBeLessThan(0.5);
    expect(Math.abs(shocked.innovationZ)).toBeGreaterThan(3);
    expect(Number.isFinite(shocked.slope)).toBe(true);
  });
});
