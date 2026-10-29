import type { Candle, Timeframe } from "./provider";
import { nseCandleEligibility } from "./nse-session";

const kolkata = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
});

function parts(time: number): { year: number; month: number; day: number } {
  const value = Object.fromEntries(kolkata.formatToParts(new Date(time)).map((part) => [part.type, part.value]));
  return { year: Number(value.year), month: Number(value.month), day: Number(value.day) };
}

function key(time: number, timeframe: "1wk" | "1mo"): string {
  const value = parts(time);
  if (timeframe === "1mo") return `${value.year}-${String(value.month).padStart(2, "0")}`;
  const day = Date.UTC(value.year, value.month - 1, value.day);
  const weekday = (new Date(day).getUTCDay() + 6) % 7;
  return new Date(day - weekday * 86_400_000).toISOString().slice(0, 10);
}

/** Reconstructs exchange aggregates from completed raw daily sessions. */
export function aggregateCompletedDailyCandles(
  candles: readonly Candle[],
  timeframe: Extract<Timeframe, "1wk" | "1mo">,
  now: Date,
): Candle[] {
  if (candles.some((candle, index) =>
    ![candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) ||
    candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0 || candle.volume < 0 ||
    candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) ||
    (index > 0 && candle.time <= candles[index - 1].time))) {
    throw new RangeError("Aggregation requires ordered valid daily candles");
  }
  const groups = new Map<string, Candle[]>();
  for (const candle of candles) {
    const group = groups.get(key(candle.time, timeframe));
    if (group) group.push(candle);
    else groups.set(key(candle.time, timeframe), [candle]);
  }
  return [...groups.values()]
    .filter((group) => nseCandleEligibility(group[0].time, timeframe, now) === "COMPLETE")
    .map((group) => ({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map((candle) => candle.high)),
      low: Math.min(...group.map((candle) => candle.low)),
      close: group.at(-1)!.close,
      volume: group.reduce((sum, candle) => sum + candle.volume, 0),
    }));
}
