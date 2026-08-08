import type { Candle, CandleResponse, Timeframe } from "./provider";

export interface YahooCandle {
  date: Date | string | number;
  open: number | null | undefined;
  high: number | null | undefined;
  low: number | null | undefined;
  close: number | null | undefined;
  volume: number | null | undefined;
}

export const MINIMUM_CANDLE_COUNT = 100;

const INTRADAY_INTERVAL_MS: Partial<Record<Timeframe, number>> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
};

const STALE_AFTER_MS: Record<Timeframe, number> = {
  "5m": 15 * 60_000,
  "15m": 45 * 60_000,
  "1h": 3 * 60 * 60_000,
  "1d": 7 * 24 * 60 * 60_000,
  "1wk": 21 * 24 * 60 * 60_000,
  "1mo": 93 * 24 * 60 * 60_000,
};

const kolkataFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface KolkataParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

type ValidYahooCandle = Omit<
  YahooCandle,
  "open" | "high" | "low" | "close" | "volume"
> &
  Omit<Candle, "time">;

function kolkataParts(time: number): KolkataParts {
  const parts = kolkataFormatter.formatToParts(new Date(time));
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function kolkataLocalEpoch(time: number): number {
  const local = kolkataParts(time);
  return Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
    time % 1_000,
  );
}

function completedAt(time: number, timeframe: Timeframe): number {
  const intradayInterval = INTRADAY_INTERVAL_MS[timeframe];
  if (intradayInterval) {
    return time + intradayInterval;
  }

  const localTime = kolkataLocalEpoch(time);
  const localDate = new Date(localTime);

  if (timeframe === "1d") {
    return localTime - (localTime % 86_400_000) + 86_400_000;
  }

  if (timeframe === "1wk") {
    const weekday = localDate.getUTCDay();
    const daysSinceMonday = (weekday + 6) % 7;
    const monday = localTime - daysSinceMonday * 86_400_000;
    return monday - (monday % 86_400_000) + 7 * 86_400_000;
  }

  return Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth() + 1, 1);
}

export function isCandleComplete(
  candleStart: number,
  timeframe: Timeframe,
  now: Date,
): boolean {
  if (INTRADAY_INTERVAL_MS[timeframe]) {
    return now.getTime() >= completedAt(candleStart, timeframe);
  }

  return kolkataLocalEpoch(now.getTime()) >= completedAt(candleStart, timeframe);
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
  const candidates = quotes
    .map((quote, index) => ({ quote, index, time: quoteTime(quote) }))
    .filter(
      (candidate): candidate is { quote: YahooCandle; index: number; time: number } =>
        candidate.time !== null && isCandleComplete(candidate.time, timeframe, now),
    )
    .sort((left, right) => left.time - right.time || left.index - right.index);

  const unique = new Map<number, YahooCandle>();
  for (const candidate of candidates) {
    unique.set(candidate.time, candidate.quote);
  }

  const candles: Candle[] = [];
  for (const [time, quote] of unique) {
    if (isValidQuote(quote)) {
      candles.push({
        time,
        open: quote.open,
        high: quote.high,
        low: quote.low,
        close: quote.close,
        volume: quote.volume,
      });
    }
  }

  const asOf = candles.at(-1)?.time ?? 0;
  if (candles.length === 0 && candidates.length > 0) {
    return { status: "INVALID_CANDLES", candles, asOf };
  }

  if (asOf !== 0 && now.getTime() - asOf > STALE_AFTER_MS[timeframe]) {
    return { status: "STALE_DATA", candles, asOf };
  }

  return {
    status: candles.length < MINIMUM_CANDLE_COUNT ? "INSUFFICIENT_HISTORY" : "OK",
    candles,
    asOf,
  };
}
