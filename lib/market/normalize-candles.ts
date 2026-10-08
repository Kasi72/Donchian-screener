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
const DAY_MS = 24 * 60 * 60_000;

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

function kolkataDate(time: number): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(time)).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function hasMissingOhlcv(quote: YahooCandle): boolean {
  return quote.open == null || quote.high == null || quote.low == null || quote.close == null || quote.volume == null;
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
    open > 0 &&
    high > 0 &&
    low > 0 &&
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
  const parsedQuotes = parsedInput;
  let hasInvalidSession = false;
  let hasUnsupportedCalendar = false;
  const candidates = parsedQuotes
    .filter(
      (candidate): candidate is { quote: YahooCandle; index: number; time: number } => {
        if (candidate.time === null) return false;
        const session = calendar.sessionFor(kolkataDate(candidate.time));
        if (isZeroVolumeFlatPlaceholder(candidate.quote) && session.kind === "CLOSED") return false;
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
          if (isZeroVolumeFlatPlaceholder(candidate.quote) || isWhollyEmptyPlaceholder(candidate.quote)) {
            return false;
          }
          hasInvalidSession = true;
          return false;
        }
        return eligibility === "COMPLETE";
      },
    )
    .sort((left, right) => left.time - right.time || left.index - right.index);

  const unique = new Map<number, Omit<Candle, "time">>();
  let hasInvalidPayload = false;
  let ignoredLatestPartial = false;
  const latestCandidateTime = candidates.at(-1)?.time;
  const validPayloadTimes = new Set(
    candidates
      .filter((candidate) => isValidQuote(candidate.quote) && adjustedCandle(candidate.quote, adjustmentMode) !== undefined)
      .map((candidate) => candidate.time),
  );
  for (const candidate of candidates) {
    if (!isValidQuote(candidate.quote)) {
      // Yahoo occasionally returns the newest daily/aggregate row with a
      // null close while the older completed history is valid. It is a
      // forming provider snapshot, not evidence that the completed feed is
      // corrupt. Preserve strict rejection for malformed older rows and for
      // malformed duplicates that share a timestamp with a valid quote.
      if (candidate.time === latestCandidateTime && !validPayloadTimes.has(candidate.time) && hasMissingOhlcv(candidate.quote)) {
        ignoredLatestPartial = true;
        continue;
      }
      hasInvalidPayload = true;
      continue;
    }
    const candle = adjustedCandle(candidate.quote, adjustmentMode);
    if (candle === undefined) {
      hasInvalidPayload = true;
      continue;
    }
    const existing = unique.get(candidate.time);
    if (existing !== undefined && (existing.open !== candle.open || existing.high !== candle.high || existing.low !== candle.low || existing.close !== candle.close || existing.volume !== candle.volume)) {
      // Preserve the provider's deterministic last-quote convention for
      // diagnostics, but mark the feed invalid so no signal can use it.
      hasInvalidPayload = true;
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
  const partialLagLimit = timeframe === "1d" ? 3 * DAY_MS
    : timeframe === "1wk" ? 10 * DAY_MS
      : timeframe === "1mo" ? 35 * DAY_MS
        : 0;
  const partialSnapshotLagAllowed =
    ignoredLatestPartial &&
    actualCompletion !== undefined &&
    expectedCompletion - actualCompletion <= partialLagLimit;
  if (
    asOf !== 0 &&
    (actualCompletion === undefined ||
      (actualCompletion < expectedCompletion && !partialSnapshotLagAllowed))
  ) {
    return response("STALE_DATA", candles, adjustmentMode);
  }

  return response(
    candles.length < MINIMUM_CANDLE_COUNT ? "INSUFFICIENT_HISTORY" : "OK",
    candles,
    adjustmentMode,
  );
}
