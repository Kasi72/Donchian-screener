import type { Candle, Timeframe } from "@/lib/market/provider";

export interface BlockBootstrapInterval { estimate: number; lower: number; upper: number; samples: number; }
export interface CostAdjustedExpectancy { grossExpectancyR: number; netExpectancyR: number; costR: number; actionable: boolean; }
export interface StressScenario { slippageBps: number; feeBps: number; expectancyR: number | null; profitFactor: number | null; }

function quantile(values: readonly number[], probability: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * probability;
  const low = Math.floor(position); const high = Math.ceil(position);
  return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/** Deterministic block bootstrap preserving local serial dependence. */
export function blockBootstrapInterval(values: readonly number[], blockSize = 5, samples = 1_000, seed = 17): BlockBootstrapInterval {
  if (values.length < 2 || !Number.isInteger(blockSize) || blockSize < 1 || !Number.isInteger(samples) || samples < 100) throw new RangeError("Insufficient block-bootstrap inputs");
  let state = seed >>> 0;
  const random = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 0x1_0000_0000; };
  const means: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const drawn: number[] = [];
    while (drawn.length < values.length) {
      const start = Math.floor(random() * values.length);
      for (let offset = 0; offset < blockSize && drawn.length < values.length; offset += 1) drawn.push(values[(start + offset) % values.length]);
    }
    means.push(drawn.reduce((sum, value) => sum + value, 0) / drawn.length);
  }
  const estimate = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { estimate, lower: quantile(means, 0.025), upper: quantile(means, 0.975), samples };
}

/** Computes net R after proportional entry/exit costs for a long trade. */
export function costAdjustedExpectancy(grossR: readonly number[], riskPrice: readonly number[], entryPrice: readonly number[], slippageBps: number, feeBps: number): CostAdjustedExpectancy {
  if (grossR.length !== riskPrice.length || grossR.length !== entryPrice.length || !grossR.length ||
    ![slippageBps, feeBps].every((value) => Number.isFinite(value) && value >= 0 && value < 10_000) ||
    riskPrice.some((value) => !Number.isFinite(value) || value <= 0) || entryPrice.some((value) => !Number.isFinite(value) || value <= 0)) throw new RangeError("Invalid cost-adjusted expectancy inputs");
  const costs = entryPrice.map((entry, index) => ((entry * slippageBps + entry * feeBps * 2) / 10_000) / riskPrice[index]);
  const net = grossR.map((value, index) => value - costs[index]);
  const grossExpectancyR = grossR.reduce((sum, value) => sum + value, 0) / grossR.length;
  const netExpectancyR = net.reduce((sum, value) => sum + value, 0) / net.length;
  return { grossExpectancyR, netExpectancyR, costR: costs.reduce((sum, value) => sum + value, 0) / costs.length, actionable: netExpectancyR > 0 };
}

/** Aggregates verified daily candles into exchange-neutral weekly/monthly bars. */
export function aggregateCompletedCandles(candles: readonly Candle[], timeframe: Extract<Timeframe, "1wk" | "1mo">): Candle[] {
  if (!candles.length || candles.some((candle, index) => ![candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) || (index > 0 && candle.time <= candles[index - 1].time))) throw new RangeError("Aggregation requires ordered valid candles");
  const groups = new Map<string, Candle[]>();
  for (const candle of candles) {
    const date = new Date(candle.time);
    const key = timeframe === "1mo" ? `${date.getUTCFullYear()}-${date.getUTCMonth()}` : (() => { const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86_400_000); return monday.toISOString().slice(0, 10); })();
    const bucket = groups.get(key); if (bucket) bucket.push(candle); else groups.set(key, [candle]);
  }
  return [...groups.values()].map((bucket) => ({ time: bucket[0].time, open: bucket[0].open, high: Math.max(...bucket.map((c) => c.high)), low: Math.min(...bucket.map((c) => c.low)), close: bucket.at(-1)!.close, volume: bucket.reduce((sum, c) => sum + c.volume, 0) }));
}
