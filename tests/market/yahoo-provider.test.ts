import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  YahooMarketDataProvider,
  YahooProviderError,
  type YahooChartClient,
} from "@/lib/market/yahoo-provider";

const IST = "+05:30";

function completedQuotes() {
  const firstCandle = new Date(`2026-08-10T03:40:00${IST}`).getTime();
  return Array.from({ length: 100 }, (_, index) => ({
    date: new Date(firstCandle + index * 5 * 60_000),
    open: 100,
    high: 105,
    low: 99,
    close: 103,
    volume: 1_000,
  }));
}

function clientReturning(quotes: ReturnType<typeof completedQuotes>): YahooChartClient {
  return {
    chart: vi.fn().mockResolvedValue({ quotes }),
  };
}

describe("YahooMarketDataProvider", () => {
  const now = new Date(`2026-08-10T12:00:00${IST}`);

  it("fetches regular-session candles and normalizes the Yahoo result", async () => {
    const client = clientReturning(completedQuotes());
    const provider = new YahooMarketDataProvider({ client, maxAttempts: 1 });

    const result = await provider.getCandles("RELIANCE.NS", "5m", now);

    expect(result.status).toBe("OK");
    expect(result.candles).toHaveLength(100);
    expect(client.chart).toHaveBeenCalledWith(
      "RELIANCE.NS",
      expect.objectContaining({ interval: "5m", includePrePost: false }),
    );
  });

  it("retries a transient Yahoo rate-limit response before returning normalized candles", async () => {
    const client: YahooChartClient = {
      chart: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error("Too Many Requests"), { status: 429 }))
        .mockResolvedValueOnce({ quotes: completedQuotes() }),
    };
    const provider = new YahooMarketDataProvider({ client, maxAttempts: 2, retryDelayMs: 0 });

    const result = await provider.getCandles("RELIANCE.NS", "5m", now);

    expect(result.status).toBe("OK");
    expect(client.chart).toHaveBeenCalledTimes(2);
  });

  it("returns SYMBOL_NOT_FOUND when Yahoo rejects the requested symbol", async () => {
    const client: YahooChartClient = {
      chart: vi.fn().mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 })),
    };
    const provider = new YahooMarketDataProvider({ client, maxAttempts: 1 });

    await expect(provider.getCandles("MISSING.NS", "1d", now)).resolves.toEqual({
      status: "SYMBOL_NOT_FOUND",
      candles: [],
      asOf: 0,
    });
  });

  it("returns PROVIDER_RATE_LIMITED after retryable rate limits are exhausted", async () => {
    const client: YahooChartClient = {
      chart: vi.fn().mockRejectedValue(Object.assign(new Error("Too Many Requests"), { status: 429 })),
    };
    const provider = new YahooMarketDataProvider({ client, maxAttempts: 2, retryDelayMs: 0 });

    await expect(provider.getCandles("RELIANCE.NS", "1d", now)).resolves.toEqual({
      status: "PROVIDER_RATE_LIMITED",
      candles: [],
      asOf: 0,
    });
  });

  it("surfaces unknown provider failures instead of disguising them as a signal result", async () => {
    const client: YahooChartClient = {
      chart: vi.fn().mockRejectedValue(Object.assign(new Error("socket reset"), { code: "ECONNRESET" })),
    };
    const provider = new YahooMarketDataProvider({ client, maxAttempts: 1 });

    await expect(provider.getCandles("RELIANCE.NS", "1d", now)).rejects.toBeInstanceOf(
      YahooProviderError,
    );
  });
});
