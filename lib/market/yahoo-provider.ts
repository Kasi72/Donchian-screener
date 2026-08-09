import "server-only";

import YahooFinance from "yahoo-finance2";

import { normalizeCandles, type YahooCandle } from "./normalize-candles";
import { latestExpectedNseCompletion } from "./nse-session";
import {
  BoundedCandleCache,
  GLOBAL_CANDLE_CACHE,
  GLOBAL_YAHOO_THROTTLE,
  GlobalRequestThrottle,
} from "./provider-controls";
import type {
  AdjustmentMode,
  CandleResponse,
  MarketDataProvider,
  MarketDataRequestOptions,
  Timeframe,
} from "./provider";

export interface YahooChartClient {
  chart(
    symbol: string,
    options: {
      period1: Date;
      period2: Date;
      interval: Timeframe;
      includePrePost: false;
    },
    moduleOptions?: { fetchOptions: { signal: AbortSignal } },
  ): Promise<{ quotes: YahooCandle[] }>;
}

export interface YahooMarketDataProviderOptions {
  client?: YahooChartClient;
  maxAttempts?: number;
  retryDelayMs?: number;
  cache?: BoundedCandleCache;
  throttle?: GlobalRequestThrottle;
}

export class YahooProviderError extends Error {
  constructor(message: string, readonly cause: unknown) {
    super(message);
    this.name = "YahooProviderError";
  }
}

const LOOKBACK_MS: Record<Timeframe, number> = {
  "5m": 59 * 24 * 60 * 60_000,
  "15m": 59 * 24 * 60 * 60_000,
  "1h": 729 * 24 * 60 * 60_000,
  "1d": 5 * 365 * 24 * 60 * 60_000,
  "1wk": 10 * 365 * 24 * 60 * 60_000,
  "1mo": 20 * 365 * 24 * 60 * 60_000,
};

function errorDetails(error: unknown): {
  status?: unknown;
  code?: string;
  message: string;
} {
  if (error instanceof Error) {
    const details = error as Error & { status?: unknown; statusCode?: unknown; code?: string };
    return {
      status: details.status ?? details.statusCode,
      code: details.code,
      message: error.message,
    };
  }

  return { message: String(error) };
}

function isSymbolNotFound(error: unknown): boolean {
  const details = errorDetails(error);
  return details.status === 404 || /not found|no data found|delisted/i.test(details.message);
}

function isRateLimited(error: unknown): boolean {
  const details = errorDetails(error);
  return details.status === 429 || details.code === "RATE_LIMIT" || /too many requests|rate limit/i.test(details.message);
}

function isRetryable(error: unknown): boolean {
  const details = errorDetails(error);
  return (
    isRateLimited(error) ||
    (typeof details.status === "number" &&
      Number.isInteger(details.status) &&
      details.status >= 500 &&
      details.status <= 599) ||
    ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN"].includes(details.code ?? "")
  );
}

function adjustmentModeFor(symbol: string, timeframe: Timeframe): AdjustmentMode {
  const isAggregate = timeframe === "1d" || timeframe === "1wk" || timeframe === "1mo";
  return isAggregate && !symbol.startsWith("^") ? "BACK_ADJUSTED" : "RAW";
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function effectiveSignal(options: MarketDataRequestOptions | undefined): AbortSignal {
  const signals: AbortSignal[] = [];
  if (options?.signal) signals.push(options.signal);
  if (options?.deadlineMs !== undefined) {
    const remaining = options.deadlineMs - Date.now();
    signals.push(
      remaining <= 0
        ? AbortSignal.abort(new DOMException("Provider deadline elapsed", "TimeoutError"))
        : AbortSignal.timeout(remaining),
    );
  }
  if (signals.length === 0) return new AbortController().signal;
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

export class YahooMarketDataProvider implements MarketDataProvider {
  private readonly client: YahooChartClient;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly cache?: BoundedCandleCache;
  private readonly throttle: GlobalRequestThrottle;

  constructor(options: YahooMarketDataProviderOptions = {}) {
    this.client =
      options.client ?? (new YahooFinance() as unknown as YahooChartClient);
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
    this.cache = options.cache ?? (options.client === undefined ? GLOBAL_CANDLE_CACHE : undefined);
    this.throttle =
      options.throttle ??
      (options.client === undefined
        ? GLOBAL_YAHOO_THROTTLE
        : new GlobalRequestThrottle({ maxConcurrent: 100, minSpacingMs: 0 }));
  }

  async getCandles(
    symbol: string,
    timeframe: Timeframe,
    now: Date = new Date(),
    requestOptions?: MarketDataRequestOptions,
  ): Promise<CandleResponse> {
    const adjustmentMode = adjustmentModeFor(symbol, timeframe);
    const expectedCompletion = latestExpectedNseCompletion(timeframe, now);
    const cacheKey = `${symbol}|${timeframe}|${adjustmentMode}|${String(expectedCompletion)}`;
    const cached = this.cache?.get(cacheKey);
    if (cached !== undefined) return cached;
    const signal = effectiveSignal(requestOptions);
    if (signal.aborted) throw signal.reason;
    const options = {
      period1: new Date(now.getTime() - LOOKBACK_MS[timeframe]),
      period2: now,
      interval: timeframe,
      includePrePost: false as const,
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const result = await this.throttle.run(
          () => this.client.chart(symbol, options, { fetchOptions: { signal } }),
          signal,
        );
        const normalized = normalizeCandles(result.quotes, timeframe, now, {
          adjustmentMode,
        });
        if (normalized.status !== "PROVIDER_RATE_LIMITED") {
          this.cache?.set(cacheKey, normalized);
        }
        return normalized;
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        if (isSymbolNotFound(error)) {
          return {
            status: "SYMBOL_NOT_FOUND",
            candles: [],
            asOf: 0,
            adjustmentMode,
          };
        }

        lastError = error;
        if (!isRetryable(error) || attempt === this.maxAttempts) {
          break;
        }

        await wait(this.retryDelayMs * 2 ** (attempt - 1), signal);
      }
    }

    if (isRateLimited(lastError)) {
      return {
        status: "PROVIDER_RATE_LIMITED",
        candles: [],
        asOf: 0,
        adjustmentMode,
      };
    }

    throw new YahooProviderError(
      `Yahoo chart request failed for ${symbol}.`,
      lastError,
    );
  }
}
