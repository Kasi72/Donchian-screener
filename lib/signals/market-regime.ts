import type { Candle } from "@/lib/market/provider";

export type QuantMarketRegime = "TRENDING_BULL" | "TRENDING_BEAR" | "RANGE_BOUND" | "HIGH_VOLATILITY" | "TRANSITION" | "INSUFFICIENT_DATA";

export interface MarketRegimeEvidence {
  regime: QuantMarketRegime;
  trendZ: number;
  volatilityPercentile: number;
  sampleSize: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mad(values: number[], center: number): number {
  return median(values.map((value) => Math.abs(value - center))) * 1.4826;
}

/** Causal, robust regime descriptor. It uses only candles through endIndex. */
export function classifyMarketRegime(candles: readonly Candle[], endIndex: number, lookback = 30): MarketRegimeEvidence {
  if (!Number.isInteger(endIndex) || endIndex < 0 || endIndex >= candles.length || !Number.isInteger(lookback) || lookback < 10) throw new RangeError("Invalid regime inputs");
  const start = Math.max(1, endIndex - lookback + 1);
  const returns = candles.slice(start, endIndex + 1).map((candle, i) => Math.log(candle.close / candles[start + i - 1].close)).filter(Number.isFinite);
  if (returns.length < 10) return { regime: "INSUFFICIENT_DATA", trendZ: 0, volatilityPercentile: 0.5, sampleSize: returns.length };
  const center = median(returns);
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const standardScale = Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1));
  const scale = Math.max(mad(returns, center), standardScale, 1e-6);
  const trendZ = center * Math.sqrt(returns.length) / scale;
  const rollingVol = returns.slice(-Math.min(10, returns.length)).reduce((sum, value) => sum + value * value, 0) ** 0.5;
  const historicalVols: number[] = [];
  for (let i = 10; i <= returns.length; i += 1) historicalVols.push(returns.slice(i - 10, i).reduce((sum, value) => sum + value * value, 0) ** 0.5);
  const less = historicalVols.filter((value) => value < rollingVol).length;
  const equal = historicalVols.filter((value) => Math.abs(value - rollingVol) <= 1e-12).length;
  const volatilityPercentile = (less + 0.5 * equal) / historicalVols.length;
  const regime: QuantMarketRegime = trendZ >= 1.2 ? "TRENDING_BULL"
    : trendZ <= -1.2 ? "TRENDING_BEAR"
      : volatilityPercentile >= 0.9 ? "HIGH_VOLATILITY"
        : Math.abs(trendZ) < 0.45 ? "RANGE_BOUND" : "TRANSITION";
  return { regime, trendZ, volatilityPercentile, sampleSize: returns.length };
}
