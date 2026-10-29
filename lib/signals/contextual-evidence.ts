import type { Candle, Timeframe } from "@/lib/market/provider";
import { nseCandleCompletion } from "@/lib/market/nse-session";

export type ContextTrend = "BULLISH" | "BEARISH" | "NEUTRAL" | "UNAVAILABLE";

export interface ContextualEvidence {
  higherTimeframe: Exclude<Timeframe, "5m" | "15m"> | null;
  higherTimeframeTrend: ContextTrend;
  higherTimeframeReturn: number | null;
  relativeStrengthReturn: number | null;
  relativeStrengthZ: number | null;
  relativeStrengthState: ContextTrend;
  benchmarkSymbol: string | null;
  benchmarkBars: number;
}

const kolkataDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dateParts(time: number): { year: number; month: number; day: number } {
  const values = Object.fromEntries(kolkataDate.formatToParts(new Date(time)).map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function isoWeekKey(time: number): string {
  const { year, month, day } = dateParts(time);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

function groupKey(time: number, timeframe: Exclude<Timeframe, "5m" | "15m">): string {
  const parts = dateParts(time);
  if (timeframe === "1d") return `${parts.year}-${parts.month}-${parts.day}`;
  if (timeframe === "1wk") return isoWeekKey(time);
  return `${parts.year}-${parts.month}`;
}

function higherTimeframeFor(timeframe: Timeframe): Exclude<Timeframe, "5m" | "15m"> | null {
  if (timeframe === "5m" || timeframe === "15m" || timeframe === "1h") return "1d";
  if (timeframe === "1d") return "1wk";
  if (timeframe === "1wk") return "1mo";
  return null;
}

function completedHigherCloses(candles: readonly Candle[], target: Exclude<Timeframe, "5m" | "15m">, asOf: number): number[] {
  const groups = new Map<string, Candle[]>();
  for (const candle of candles) {
    const key = groupKey(candle.time, target);
    const group = groups.get(key);
    if (group) group.push(candle);
    else groups.set(key, [candle]);
  }
  return [...groups.values()]
    .filter((group) => {
      const completion = nseCandleCompletion(group[0].time, target);
      return completion !== undefined && completion <= asOf;
    })
    .map((group) => group.at(-1)!.close)
    .filter((value) => Number.isFinite(value) && value > 0);
}

function trendFromCloses(closes: readonly number[]): { state: ContextTrend; value: number | null } {
  if (closes.length < 4) return { state: "UNAVAILABLE", value: null };
  const value = Math.log(closes.at(-1)! / closes.at(-4)!);
  const threshold = 0.005;
  return { state: value > threshold ? "BULLISH" : value < -threshold ? "BEARISH" : "NEUTRAL", value };
}

function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function relativeStrength(stock: readonly Candle[], benchmark: readonly Candle[]): { value: number | null; z: number | null; state: ContextTrend; bars: number } {
  const benchmarkByTime = new Map(benchmark.map((candle) => [candle.time, candle.close]));
  const aligned = stock.map((candle) => ({ stock: candle.close, benchmark: benchmarkByTime.get(candle.time) })).filter((pair): pair is { stock: number; benchmark: number } => pair.benchmark !== undefined && pair.stock > 0 && pair.benchmark > 0);
  if (aligned.length < 12) return { value: null, z: null, state: "UNAVAILABLE", bars: aligned.length };
  const recent = aligned.slice(-21);
  const differences: number[] = [];
  for (let index = 1; index < recent.length; index += 1) {
    differences.push(Math.log(recent[index].stock / recent[index - 1].stock) - Math.log(recent[index].benchmark / recent[index - 1].benchmark));
  }
  const value = differences.reduce((sum, difference) => sum + difference, 0);
  const scale = standardDeviation(differences) * Math.sqrt(differences.length);
  const z = scale > 0 ? value / scale : 0;
  return { value, z, state: z > 0.5 ? "BULLISH" : z < -0.5 ? "BEARISH" : "NEUTRAL", bars: aligned.length };
}

/** Completed-candle context only. It never changes the Donchian gate. */
export function calculateContextualEvidence(
  candles: readonly Candle[],
  signalIndex: number,
  timeframe: Timeframe,
  benchmarkCandles?: readonly Candle[],
  benchmarkSymbol = "^NSEI",
): ContextualEvidence {
  if (!Number.isInteger(signalIndex) || signalIndex < 0 || signalIndex >= candles.length) throw new RangeError("Invalid context signal index");
  const causal = candles.slice(0, signalIndex + 1);
  const higherTimeframe = higherTimeframeFor(timeframe);
  const signalCompletion = nseCandleCompletion(causal.at(-1)!.time, timeframe) ?? causal.at(-1)!.time;
  const higher = higherTimeframe ? trendFromCloses(completedHigherCloses(causal, higherTimeframe, signalCompletion)) : { state: "UNAVAILABLE" as const, value: null };
  const relative = benchmarkCandles ? relativeStrength(causal, benchmarkCandles.filter((candle) => candle.time <= causal.at(-1)!.time)) : { value: null, z: null, state: "UNAVAILABLE" as const, bars: 0 };
  return {
    higherTimeframe,
    higherTimeframeTrend: higher.state,
    higherTimeframeReturn: higher.value,
    relativeStrengthReturn: relative.value,
    relativeStrengthZ: relative.z,
    relativeStrengthState: relative.state,
    benchmarkSymbol: benchmarkCandles ? benchmarkSymbol : null,
    benchmarkBars: relative.bars,
  };
}
