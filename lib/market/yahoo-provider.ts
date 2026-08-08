import "server-only";

import YahooFinance from "yahoo-finance2";

import { normalizeCandles, type YahooCandle } from "./normalize-candles";
import type { CandleResponse, MarketDataProvider, Timeframe } from "./provider";

export interface YahooChartClient {
  chart(
    symbol: string,
    options: {
      period1: Date;
      period2: Date;
      interval: Timeframe;
      includePrePost: false;
    },
  ): Promise<{ quotes: YahooCandle[] }>;
}

export interface YahooMarketDataProviderOptions {
  client?: YahooChartClient;
  maxAttempts?: number;
  retryDelayMs?: number;
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
  status?: number;
  code?: string;
  message: string;
} {
  if (error instanceof Error) {
    const details = error as Error & { status?: number; statusCode?: number; code?: string };
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
    (details.status !== undefined && details.status >= 500) ||
    ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN"].includes(details.code ?? "")
  );
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class YahooMarketDataProvider implements MarketDataProvider {
  private readonly client: YahooChartClient;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;

  constructor(options: YahooMarketDataProviderOptions = {}) {
    this.client =
      options.client ?? (new YahooFinance() as unknown as YahooChartClient);
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
  }

  async getCandles(
    symbol: string,
    timeframe: Timeframe,
    now: Date = new Date(),
  ): Promise<CandleResponse> {
    const options = {
      period1: new Date(now.getTime() - LOOKBACK_MS[timeframe]),
      period2: now,
      interval: timeframe,
      includePrePost: false as const,
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const result = await this.client.chart(symbol, options);
        return normalizeCandles(result.quotes, timeframe, now);
      } catch (error) {
        if (isSymbolNotFound(error)) {
          return { status: "SYMBOL_NOT_FOUND", candles: [], asOf: 0 };
        }

        lastError = error;
        if (!isRetryable(error) || attempt === this.maxAttempts) {
          break;
        }

        await wait(this.retryDelayMs * 2 ** (attempt - 1));
      }
    }

    if (isRateLimited(lastError)) {
      return { status: "PROVIDER_RATE_LIMITED", candles: [], asOf: 0 };
    }

    throw new YahooProviderError(
      `Yahoo chart request failed for ${symbol}.`,
      lastError,
    );
  }
}
