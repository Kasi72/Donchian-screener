import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  YahooMarketDataProvider,
  YahooProviderError,
  type YahooChartClient,
} from "@/lib/market/yahoo-provider";
import {
  BoundedCandleCache,
  GlobalRequestThrottle,
} from "@/lib/market/provider-controls";

const IST = "+05:30";

function completedQuotes() {
  const sessionStarts = [
    new Date(`2026-08-06T09:15:00${IST}`).getTime(),
    new Date(`2026-08-07T09:15:00${IST}`).getTime(),
  ];
  return sessionStarts
    .flatMap((sessionStart) =>
      Array.from({ length: 75 }, (_, index) => ({
        date: new Date(sessionStart + index * 5 * 60_000),
        open: 100,
        high: 105,
        low: 99,
        close: 103,
        adjclose: 51.5,
        volume: 1_000,
      })),
    )
    .slice(-100);
}

function clientReturning(quotes: ReturnType<typeof completedQuotes>): YahooChartClient {
  return {
    chart: vi.fn().mockResolvedValue({ quotes }),
  };
}

describe("YahooMarketDataProvider", () => {
  const now = new Date(`2026-08-07T16:00:00${IST}`);

  it("fetches regular-session candles and normalizes the Yahoo result", async () => {
    const client = clientReturning(completedQuotes());
    const provider = new YahooMarketDataProvider({ client, maxAttempts: 1 });

    const result = await provider.getCandles("RELIANCE.NS", "5m", now);

    expect(result.status).toBe("OK");
    expect(result.adjustmentMode).toBe("RAW");
    expect(result.candles).toHaveLength(100);
    expect(client.chart).toHaveBeenCalledWith(
      "RELIANCE.NS",
      expect.objectContaining({ interval: "5m", includePrePost: false }),
      expect.objectContaining({
        fetchOptions: expect.objectContaining({ signal: expect.any(AbortSignal) }),
      }),
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
      adjustmentMode: "BACK_ADJUSTED",
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
      adjustmentMode: "BACK_ADJUSTED",
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

  it("back-adjusts daily equities but keeps index candles raw", async () => {
    const daily = [{
      date: new Date(`2026-08-07T09:15:00${IST}`),
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      adjclose: 52.5,
      volume: 1_000,
    }];
    const client = clientReturning(daily);
    const provider = new YahooMarketDataProvider({ client, maxAttempts: 1 });

    const equity = await provider.getCandles("RELIANCE.NS", "1d", now);
    const index = await provider.getCandles("^NSEI", "1d", now);

    expect(equity).toMatchObject({
      adjustmentMode: "BACK_ADJUSTED",
      candles: [{ open: 50, high: 55, low: 45, close: 52.5 }],
    });
    expect(index).toMatchObject({
      adjustmentMode: "RAW",
      candles: [{ open: 100, high: 110, low: 90, close: 105 }],
    });
  });

  it.each([600, "503"])(
    "does not classify non-numeric-5xx status %j as transient",
    async (status) => {
      const client: YahooChartClient = {
        chart: vi.fn().mockRejectedValue(Object.assign(new Error("upstream"), { status })),
      };
      const provider = new YahooMarketDataProvider({ client, maxAttempts: 3, retryDelayMs: 0 });

      await expect(provider.getCandles("RELIANCE.NS", "1d", now)).rejects.toBeInstanceOf(
        YahooProviderError,
      );
      expect(client.chart).toHaveBeenCalledOnce();
    },
  );

  it("reuses a bounded candle-cache entry for the same completed market interval", async () => {
    const client = clientReturning(completedQuotes());
    const cache = new BoundedCandleCache({ maxEntries: 2, ttlMs: 60_000 });
    const provider = new YahooMarketDataProvider({
      client,
      cache,
      throttle: new GlobalRequestThrottle({ maxConcurrent: 1, minSpacingMs: 0 }),
      maxAttempts: 1,
    });

    const first = await provider.getCandles("RELIANCE.NS", "5m", now);
    const second = await provider.getCandles(
      "RELIANCE.NS",
      "5m",
      new Date(now.getTime() + 1_000),
    );

    expect(second).toBe(first);
    expect(client.chart).toHaveBeenCalledOnce();
    expect(cache.size).toBe(1);
  });

  it("passes the request signal through Yahoo fetch options and preserves cancellation", async () => {
    let receivedSignal: AbortSignal | undefined;
    const client: YahooChartClient = {
      async chart(_symbol, _query, moduleOptions) {
        receivedSignal = moduleOptions?.fetchOptions.signal ?? undefined;
        return await new Promise((_resolve, reject) => {
          receivedSignal?.addEventListener("abort", () => reject(receivedSignal?.reason), {
            once: true,
          });
        });
      },
    };
    const provider = new YahooMarketDataProvider({
      client,
      throttle: new GlobalRequestThrottle({ maxConcurrent: 1, minSpacingMs: 0 }),
      maxAttempts: 1,
    });
    const controller = new AbortController();
    const pending = provider.getCandles("RELIANCE.NS", "5m", now, {
      signal: controller.signal,
      deadlineMs: Date.now() + 5_000,
    });
    await vi.waitFor(() => expect(receivedSignal).toBeDefined());
    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(receivedSignal?.aborted).toBe(true);
  });
});
