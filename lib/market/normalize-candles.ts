import type {
  AdjustmentMode,
  Candle,
  CandleResponse,
  Timeframe,
} from "./provider";
import {
  NSE_TRADING_CALENDAR,
  latestExpectedNseCompletion,
  nseCandleCompletion,
  nseCandleEligibility,
  type NseTradingCalendar,
} from "./nse-session";

export interface YahooCandle {
  date: Date | string | number;
  open: number | null | undefined;
  high: number | null | undefined;
  low: number | null | undefined;
  close: number | null | undefined;
  adjclose?: number | null | undefined;
  volume: number | null | undefined;
}

export interface NormalizeCandlesOptions {
  adjustmentMode?: AdjustmentMode;
  calendar?: NseTradingCalendar;
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
  return nseCandleEligibility(candleStart, timeframe, now) === "COMPLETE";
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
    close > 0 &&
    volume >= 0 &&
    high >= low &&
    high >= open &&
    high >= close &&
    low <= open &&
    low <= close
  );
}

function isZeroVolumeFlatPlaceholder(quote: YahooCandle): boolean {
  return (
    quote.volume === 0 &&
    typeof quote.open === "number" &&
    quote.open === quote.high &&
    quote.high === quote.low &&
    quote.low === quote.close
  );
}

function isWhollyEmptyPlaceholder(quote: YahooCandle): boolean {
  return (
    quote.open == null &&
    quote.high == null &&
    quote.low == null &&
    quote.close == null &&
    quote.volume == null
  );
}

function adjustedCandle(
  quote: ValidYahooCandle,
  adjustmentMode: AdjustmentMode,
): Omit<Candle, "time"> | undefined {
  if (adjustmentMode === "RAW") {
    return {
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: quote.close,
      volume: quote.volume,
    };
  }

  if (
    typeof quote.adjclose !== "number" ||
    !Number.isFinite(quote.adjclose) ||
    quote.adjclose <= 0
  ) {
    return undefined;
  }
  const factor = quote.adjclose / quote.close;
  if (!Number.isFinite(factor) || factor <= 0) return undefined;
  return {
    open: quote.open * factor,
    high: quote.high * factor,
    low: quote.low * factor,
    close: quote.adjclose,
    volume: quote.volume,
  };
}

function response(
  status: CandleResponse["status"],
  candles: Candle[],
  adjustmentMode: AdjustmentMode,
): CandleResponse {
  return {
    status,
    candles,
    asOf: candles.at(-1)?.time ?? 0,
    adjustmentMode,
  };
}

export function normalizeCandles(
  quotes: readonly YahooCandle[],
  timeframe: Timeframe,
  now: Date,
  options: NormalizeCandlesOptions = {},
): CandleResponse {
  const adjustmentMode = options.adjustmentMode ?? "RAW";
  const calendar = options.calendar ?? NSE_TRADING_CALENDAR;
  const parsedInput = quotes.map((quote, index) => ({
    quote,
    index,
    time: quoteTime(quote),
  }));
  const hasUnparseableTimestamp = parsedInput.some((candidate) => candidate.time === null);
  const parsedQuotes = parsedInput.filter(
    ({ quote }) =>
      !isZeroVolumeFlatPlaceholder(quote) && !isWhollyEmptyPlaceholder(quote),
  );
  let hasInvalidSession = false;
  let hasUnsupportedCalendar = false;
  const candidates = parsedQuotes
    .filter(
      (candidate): candidate is { quote: YahooCandle; index: number; time: number } => {
        if (candidate.time === null) return false;
        const eligibility = nseCandleEligibility(
          candidate.time,
          timeframe,
          now,
          calendar,
        );
        if (eligibility === "UNSUPPORTED_CALENDAR") {
          hasUnsupportedCalendar = true;
          return false;
        }
        if (eligibility === "INVALID_SESSION") {
          hasInvalidSession = true;
          return false;
        }
        return eligibility === "COMPLETE";
      },
    )
    .sort((left, right) => left.time - right.time || left.index - right.index);

  const unique = new Map<number, Omit<Candle, "time">>();
  let hasInvalidPayload = false;
  for (const candidate of candidates) {
    if (!isValidQuote(candidate.quote)) {
      hasInvalidPayload = true;
      continue;
    }
    const candle = adjustedCandle(candidate.quote, adjustmentMode);
    if (candle === undefined) {
      hasInvalidPayload = true;
      continue;
    }
    unique.set(candidate.time, candle);
  }

  const candles: Candle[] = [];
  for (const [time, quote] of unique) candles.push({ time, ...quote });

  if (hasUnsupportedCalendar || latestExpectedNseCompletion(timeframe, now, calendar) === undefined) {
    return response("DATA_QUALITY_LIMITATION", candles, adjustmentMode);
  }
  if (hasUnparseableTimestamp || hasInvalidSession || hasInvalidPayload) {
    return response("INVALID_CANDLES", candles, adjustmentMode);
  }

  const asOf = candles.at(-1)?.time ?? 0;
  const expectedCompletion = latestExpectedNseCompletion(timeframe, now, calendar)!;
  const actualCompletion = asOf === 0 ? undefined : nseCandleCompletion(asOf, timeframe, calendar);
  if (asOf !== 0 && (actualCompletion === undefined || actualCompletion < expectedCompletion)) {
    return response("STALE_DATA", candles, adjustmentMode);
  }

  return response(
    candles.length < MINIMUM_CANDLE_COUNT ? "INSUFFICIENT_HISTORY" : "OK",
    candles,
    adjustmentMode,
  );
}
