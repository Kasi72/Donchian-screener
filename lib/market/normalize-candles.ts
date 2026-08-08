import type { Candle, CandleResponse, Timeframe } from "./provider";
import {
  isNseCandleComplete,
  latestExpectedNseCompletion,
  nseCandleCompletion,
} from "./nse-session";

export interface YahooCandle {
  date: Date | string | number;
  open: number | null | undefined;
  high: number | null | undefined;
  low: number | null | undefined;
  close: number | null | undefined;
  volume: number | null | undefined;
}

export const MINIMUM_CANDLE_COUNT = 100;

type ValidYahooCandle = Omit<
  YahooCandle,
  "open" | "high" | "low" | "close" | "volume"
> &
  Omit<Candle, "time">;

export function isCandleComplete(
  candleStart: number,
  timeframe: Timeframe,
  now: Date,
): boolean {
  return isNseCandleComplete(candleStart, timeframe, now);
}

function quoteTime(quote: YahooCandle): number | null {
  const time = new Date(quote.date).getTime();
  return Number.isFinite(time) ? time : null;
}

function isValidQuote(quote: YahooCandle): quote is ValidYahooCandle {
  const { open, high, low, close, volume } = quote;
  if (
    typeof open !== "number" ||
    typeof high !== "number" ||
    typeof low !== "number" ||
    typeof close !== "number" ||
    typeof volume !== "number" ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    !Number.isFinite(volume)
  ) {
    return false;
  }

  return (
    open >= 0 &&
    high >= 0 &&
    low >= 0 &&
    close >= 0 &&
    volume >= 0 &&
    high >= low &&
    high >= open &&
    high >= close &&
    low <= open &&
    low <= close
  );
}

export function normalizeCandles(
  quotes: readonly YahooCandle[],
  timeframe: Timeframe,
  now: Date,
): CandleResponse {
  const parsedQuotes = quotes.map((quote, index) => ({
    quote,
    index,
    time: quoteTime(quote),
  }));
  const hasUnparseableTimestamp = parsedQuotes.some((candidate) => candidate.time === null);
  const candidates = parsedQuotes
    .filter(
      (candidate): candidate is { quote: YahooCandle; index: number; time: number } =>
        candidate.time !== null && isCandleComplete(candidate.time, timeframe, now),
    )
    .sort((left, right) => left.time - right.time || left.index - right.index);

  const unique = new Map<number, ValidYahooCandle>();
  for (const candidate of candidates) {
    if (isValidQuote(candidate.quote)) {
      unique.set(candidate.time, candidate.quote);
    }
  }

  const candles: Candle[] = [];
  for (const [time, quote] of unique) {
    candles.push({
      time,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: quote.close,
      volume: quote.volume,
    });
  }

  const asOf = candles.at(-1)?.time ?? 0;
  if (candles.length === 0 && (candidates.length > 0 || hasUnparseableTimestamp)) {
    return { status: "INVALID_CANDLES", candles, asOf };
  }

  if (
    asOf !== 0 &&
    nseCandleCompletion(asOf, timeframe) < latestExpectedNseCompletion(timeframe, now)
  ) {
    return { status: "STALE_DATA", candles, asOf };
  }

  return {
    status: candles.length < MINIMUM_CANDLE_COUNT ? "INSUFFICIENT_HISTORY" : "OK",
    candles,
    asOf,
  };
}
