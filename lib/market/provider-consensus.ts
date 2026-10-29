import type { Candle, CandleResponse, Timeframe } from "./provider";

export type ProviderConsensusStatus = "AGREED" | "DIVERGED" | "SINGLE_SOURCE" | "UNAVAILABLE";

export interface ProviderConsensusAudit {
  status: ProviderConsensusStatus;
  comparedBars: number;
  mismatchedBars: number;
  maximumTickDifference: number;
  primaryAsOf: number | null;
  secondaryAsOf: number | null;
}

function candleByTime(candles: readonly Candle[]): Map<number, Candle> {
  return new Map(candles.map((candle) => [candle.time, candle]));
}

/** Compares two independently supplied, completed-candle feeds in tick space. */
export function auditProviderConsensus(
  primary: CandleResponse | null,
  secondary: CandleResponse | null,
  tickSize: number,
): ProviderConsensusAudit {
  if (!Number.isFinite(tickSize) || tickSize <= 0) throw new RangeError("Consensus requires a positive tick size");
  if (!primary && !secondary) return { status: "UNAVAILABLE", comparedBars: 0, mismatchedBars: 0, maximumTickDifference: 0, primaryAsOf: null, secondaryAsOf: null };
  if (!primary || !secondary || primary.status !== "OK" || secondary.status !== "OK") {
    return { status: "SINGLE_SOURCE", comparedBars: 0, mismatchedBars: 0, maximumTickDifference: 0, primaryAsOf: primary?.asOf ?? null, secondaryAsOf: secondary?.asOf ?? null };
  }
  const secondaryMap = candleByTime(secondary.candles);
  let comparedBars = 0;
  let mismatchedBars = 0;
  let maximumTickDifference = 0;
  for (const left of primary.candles) {
    const right = secondaryMap.get(left.time);
    if (!right) continue;
    comparedBars += 1;
    const maximum = Math.max(...(["open", "high", "low", "close"] as const).map((field) => Math.abs(Math.round(left[field] / tickSize) - Math.round(right[field] / tickSize))));
    maximumTickDifference = Math.max(maximumTickDifference, maximum);
    if (maximum > 0) mismatchedBars += 1;
  }
  const status = comparedBars > 0 && mismatchedBars === 0 ? "AGREED" : "DIVERGED";
  return { status, comparedBars, mismatchedBars, maximumTickDifference, primaryAsOf: primary.asOf, secondaryAsOf: secondary.asOf };
}

export interface ConsensusMarketDataProvider {
  getCandles(symbol: string, timeframe: Timeframe, now?: Date): Promise<CandleResponse>;
}
