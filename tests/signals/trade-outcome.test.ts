import { describe, expect, it } from "vitest";
import { evaluateTradeOutcome, summarizeTradeOutcomes } from "@/lib/signals/trade-outcome";

const levels = { entry: 100, stop: 90, target1: 110, target2: 120, reactionHigh: 130, rewardRisk: 3 };
const costs = { slippageBps: 0, feeBps: 0 };
const bar = (time: number, open = 100, high = 105, low = 95, close = 100) => ({ time, open, high, low, close, volume: 1000 });

describe("executable outcome labels", () => {
  it("fills a gap through the stop at the opening price, allowing losses beyond 1R", () => {
    const outcome = evaluateTradeOutcome([bar(0), bar(1), bar(2, 80, 85, 75, 82)], 0, levels, costs);
    expect(outcome).toMatchObject({ outcome: "STOP", exit: 80, netR: -2 });
  });
  it("uses one chosen target even when a bar crosses both targets", () => {
    const candles = [bar(0), bar(1, 100, 125, 95, 123)];
    expect(evaluateTradeOutcome(candles, 0, levels, costs)).toMatchObject({ outcome: "TARGET1", exit: 110 });
    expect(evaluateTradeOutcome(candles, 0, levels, { ...costs, exitTarget: "target2" })).toMatchObject({ outcome: "TARGET2", exit: 120 });
  });
  it("flags unknown intrabar order and uses the conservative stop outcome", () => {
    expect(evaluateTradeOutcome([bar(0), bar(1, 100, 125, 85, 105)], 0, levels, costs))
      .toMatchObject({ outcome: "STOP", ambiguousExitBar: true, netR: -1 });
  });
  it("applies opening target fills before subsequent intrabar stops", () => {
    expect(evaluateTradeOutcome([bar(0), bar(1), bar(2, 115, 120, 80, 100)], 0, levels, costs))
      .toMatchObject({ outcome: "TARGET1", exit: 110, ambiguousExitBar: false });
  });
  it("includes timed exits in net expectancy and keeps truncated trades censored", () => {
    const history = [bar(0), bar(1, 100, 105, 95, 102)];
    const expired = evaluateTradeOutcome(history, 0, levels, { ...costs, horizon: 1 });
    const censored = evaluateTradeOutcome(history, 0, levels, { ...costs, horizon: 2 });
    expect(expired).toMatchObject({ outcome: "EXPIRED", netR: 0.2, barsHeld: 1 });
    expect(censored).toMatchObject({ outcome: "CENSORED", netR: null, horizonComplete: false });
    expect(summarizeTradeOutcomes([expired, censored])).toMatchObject({ closedTrades: 1, censoredTrades: 1, netExpectancyR: 0.2 });
  });
  it("charges explicit fees and slippage and rejects invalid cost inputs", () => {
    const history = [bar(0), bar(1, 100, 115, 95, 110)];
    const result = evaluateTradeOutcome(history, 0, levels, { slippageBps: 10, feeBps: 10 });
    expect(result.entry).toBeCloseTo(100.1);
    expect(result.netR).toBeLessThan(result.grossR!);
    expect(() => evaluateTradeOutcome(history, 0, levels, { ...costs, feeBps: NaN })).toThrow();
  });
  it("rounds simulated market fills adversely to the exchange tick", () => {
    const tickLevels = { ...levels, tickSize: 0.05 };
    const result = evaluateTradeOutcome(
      [bar(0), bar(1, 100.03, 105, 95, 100.02)],
      0,
      tickLevels,
      { ...costs, horizon: 2 },
    );
    expect(result.entry).toBe(100.05);
  });
  it("keeps post-signal excursions separate from the realized exit", () => {
    const result = evaluateTradeOutcome([bar(0), bar(1, 100, 111, 95, 110), bar(2, 110, 150, 70, 120)], 0, levels, { ...costs, horizon: 2 });
    expect(result).toMatchObject({ exitIndex: 1, netR: 1, fixedHorizonMfeR: 5, fixedHorizonMaeR: -3, horizonComplete: true });
  });
  it("skips stale opening entries and has no invented fill without entry data", () => {
    expect(evaluateTradeOutcome([bar(0), bar(1, 115, 120, 110, 116)], 0, levels, costs).outcome).toBe("GAP_SKIP");
    expect(evaluateTradeOutcome([bar(0)], 0, levels, costs).outcome).toBe("NO_ENTRY_DATA");
  });
});
