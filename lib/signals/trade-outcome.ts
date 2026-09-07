import type { Candle } from "@/lib/market/provider";
import type { TradeLevels } from "./risk-levels";
import policy from "./execution-policy.json";

export interface ExecutionOptions {
  horizon?: number;
  exitTarget?: "target1" | "target2";
  /** Applied adversely on market entry/exit, per side. Limit targets never fill below their limit. */
  slippageBps: number;
  /** Combined proportional brokerage, fees and taxes estimate per side. */
  feeBps: number;
}

export interface TradeOutcome {
  policyVersion: string;
  outcome: "GAP_SKIP" | "NO_ENTRY_DATA" | "STOP" | "TARGET1" | "TARGET2" | "EXPIRED" | "CENSORED";
  entry: number | null;
  exit: number | null;
  exitIndex: number | null;
  grossR: number | null;
  netR: number | null;
  barsHeld: number;
  ambiguousExitBar: boolean;
  /** Full post-entry observation window, including observations after exit. */
  fixedHorizonMfeR: number | null;
  fixedHorizonMaeR: number | null;
  horizonComplete: boolean;
}

/** Next-open long entry, one chosen limit target, stop-market, then time exit.
 * This is an outcome label, not a forecast. Incomplete horizons remain censored.
 */
export function evaluateTradeOutcome(
  candles: readonly Candle[], signalIndex: number, levels: TradeLevels, options: ExecutionOptions,
): TradeOutcome {
  const horizon = options.horizon ?? policy.maximumHoldingCandles;
  if (!Number.isInteger(signalIndex) || signalIndex < 0 || signalIndex >= candles.length ||
    !Number.isInteger(horizon) || horizon < 1 ||
    ![options.slippageBps, options.feeBps].every((n) => Number.isFinite(n) && n >= 0 && n < 10_000) ||
    ![levels.entry, levels.stop, levels.target1, levels.target2].every((n) => Number.isFinite(n) && n > 0) ||
    !(levels.stop < levels.entry && levels.entry < levels.target1 && levels.target1 < levels.target2)) {
    throw new RangeError("Invalid trade execution inputs");
  }
  const targetName = options.exitTarget ?? policy.exitTarget;
  if (targetName !== "target1" && targetName !== "target2") throw new RangeError("Invalid exit target");
  const target = levels[targetName];
  const start = signalIndex + 1;
  const end = Math.min(candles.length, start + horizon);
  const result: TradeOutcome = {
    policyVersion: policy.version, outcome: "NO_ENTRY_DATA", entry: null, exit: null,
    exitIndex: null, grossR: null, netR: null, barsHeld: 0, ambiguousExitBar: false,
    fixedHorizonMfeR: null, fixedHorizonMaeR: null, horizonComplete: end - start === horizon,
  };
  if (start >= candles.length) return result;
  for (let j = start; j < end; j++) {
    const c = candles[j];
    if (![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite) || c.low <= 0 ||
      c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close) || c.time <= candles[j - 1].time) {
      throw new RangeError("Invalid or unordered execution candles");
    }
  }
  const slip = options.slippageBps / 10_000;
  const entry = candles[start].open * (1 + slip);
  result.entry = entry;
  // A setup whose first objective has already traded through is no longer a fresh entry.
  if (candles[start].open <= levels.stop || entry >= levels.target1) return { ...result, outcome: "GAP_SKIP" };
  const risk = entry - levels.stop;
  const window = candles.slice(start, end);
  result.fixedHorizonMfeR = Math.max(0, ...window.map((c) => (c.high - entry) / risk));
  result.fixedHorizonMaeR = Math.min(0, ...window.map((c) => (c.low - entry) / risk));
  const finish = (outcome: TradeOutcome["outcome"], exit: number, index: number, ambiguous = false): TradeOutcome => ({
    ...result, outcome, exit, exitIndex: index, barsHeld: index - start + 1,
    ambiguousExitBar: ambiguous, grossR: (exit - entry) / risk,
    netR: (exit - entry - (entry + exit) * options.feeBps / 10_000) / risk,
  });
  for (let j = start; j < end; j++) {
    const c = candles[j];
    if (c.open <= levels.stop) return finish("STOP", c.open * (1 - slip), j);
    if (c.open >= target) return finish(targetName === "target1" ? "TARGET1" : "TARGET2", target, j);
    if (c.low <= levels.stop) return finish("STOP", levels.stop * (1 - slip), j, c.high >= target);
    if (c.high >= target) return finish(targetName === "target1" ? "TARGET1" : "TARGET2", target, j);
  }
  if (!result.horizonComplete) return { ...result, outcome: "CENSORED", barsHeld: end - start };
  return finish("EXPIRED", candles[end - 1].close * (1 - slip), end - 1);
}

export function summarizeTradeOutcomes(outcomes: readonly TradeOutcome[]) {
  const closed = outcomes.filter((o) => o.netR !== null);
  const gains = closed.reduce((sum, o) => sum + Math.max(0, o.netR!), 0);
  const losses = closed.reduce((sum, o) => sum - Math.min(0, o.netR!), 0);
  return {
    closedTrades: closed.length,
    censoredTrades: outcomes.filter((o) => o.outcome === "CENSORED").length,
    skippedEntries: outcomes.filter((o) => o.outcome === "GAP_SKIP" || o.outcome === "NO_ENTRY_DATA").length,
    netWinRate: closed.length ? closed.filter((o) => o.netR! > 0).length / closed.length : null,
    netExpectancyR: closed.length ? (gains - losses) / closed.length : null,
    profitFactor: losses > 0 ? gains / losses : null,
    profitFactorStatus: losses > 0 ? "DEFINED" : closed.length ? "NO_LOSSES" : "NO_TRADES",
    expiredTrades: closed.filter((o) => o.outcome === "EXPIRED").length,
    stopRate: closed.length ? closed.filter((o) => o.outcome === "STOP").length / closed.length : null,
    ambiguousExits: closed.filter((o) => o.ambiguousExitBar).length,
  };
}
