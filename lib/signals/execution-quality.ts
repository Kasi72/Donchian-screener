import type { Candle, Timeframe } from "@/lib/market/provider";
import type { TradeLevels } from "./risk-levels";
import { atrAt } from "./atr";
import policy from "./execution-policy.json";

export type ExecutionQualityStatus = "EXECUTABLE" | "REVIEW_GAP_RISK" | "WIDE_STOP" | "INSUFFICIENT_LIQUIDITY" | "INSUFFICIENT_ROOM" | "SKIP";

export interface ExecutionQuality {
  status: ExecutionQualityStatus;
  gapRisk: "LOW" | "MODERATE" | "HIGH";
  maximumRecentGapAtr: number;
  medianDailyTurnoverInr: number;
  riskPercent: number;
  reasons: string[];
  policyVersion: string;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  if (!ordered.length) return 0;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function dailyScale(timeframe: Timeframe): number {
  if (timeframe === "5m") return 75;
  if (timeframe === "15m") return 25;
  if (timeframe === "1h") return 7;
  if (timeframe === "1wk") return 1 / 5;
  if (timeframe === "1mo") return 1 / 21;
  return 1;
}

/** Completed-candle execution screen. It never changes the technical signal. */
export function assessExecutionQuality(
  candles: readonly Candle[],
  signalIndex: number,
  timeframe: Timeframe,
  levels: TradeLevels,
): ExecutionQuality {
  if (!Number.isInteger(signalIndex) || signalIndex < 14 || signalIndex >= candles.length) throw new RangeError("Execution quality requires sufficient causal history");
  const start = Math.max(1, signalIndex - 19);
  const atr = atrAt([...candles], signalIndex, 14);
  const gaps = candles.slice(start, signalIndex + 1).map((candle, offset) => {
    const previous = candles[start + offset - 1];
    return Math.abs(candle.open - previous.close) / Math.max(atr, 1e-9);
  });
  const maximumRecentGapAtr = Math.max(0, ...gaps);
  const gapRisk = maximumRecentGapAtr >= policy.highGapAtr ? "HIGH" : maximumRecentGapAtr >= policy.highGapAtr / 2 ? "MODERATE" : "LOW";
  const medianDailyTurnoverInr = median(candles.slice(Math.max(0, signalIndex - 19), signalIndex + 1).map((candle) => candle.close * candle.volume)) * dailyScale(timeframe);
  const riskPercent = levels.riskPercent ?? ((levels.entry - levels.stop) / Math.max(levels.entry, 1e-9)) * 100;
  const reasons: string[] = [];
  let status: ExecutionQualityStatus = "EXECUTABLE";
  if (!(levels.stop < levels.entry && levels.entry < levels.target1)) {
    status = "SKIP";
    reasons.push("Trade levels are not executable in ascending price order");
  } else if (levels.hasTarget1Room === false) {
    status = "INSUFFICIENT_ROOM";
    reasons.push("No causally confirmed reaction high provides room to Target 1");
  } else if (medianDailyTurnoverInr < policy.minimumMedianDailyTurnoverInr) {
    status = "INSUFFICIENT_LIQUIDITY";
    reasons.push("Estimated median daily turnover is below the execution policy minimum");
  } else if (riskPercent > policy.wideStopRiskPercent) {
    status = "WIDE_STOP";
    reasons.push("Stop distance exceeds the maximum preferred risk percentage");
  } else if (gapRisk === "HIGH") {
    status = "REVIEW_GAP_RISK";
    reasons.push("Recent opening gaps are large relative to ATR");
  }
  if (!reasons.length) reasons.push("Liquidity, stop width, and recent gap behaviour pass the static execution screen");
  return { status, gapRisk, maximumRecentGapAtr, medianDailyTurnoverInr, riskPercent, reasons, policyVersion: policy.version };
}
