import Papa from "papaparse";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/market/yahoo-provider", () => ({
  YahooMarketDataProvider: class {
    async getCandles(): Promise<CandleResponse> {
      return {
        status: "OK",
        asOf: 99 * 60_000,
        candles: Array.from({ length: 100 }, (_, index) => ({
          time: index * 60_000,
          open: 111,
          high: 112,
          low: 110,
          close: 111,
          volume: 1_000,
        })),
      };
    }
  },
}));

import type { UniverseInstrument } from "@/lib/domain/types";
import type {
  Candle,
  CandleResponse,
  MarketDataProvider,
  Timeframe,
} from "@/lib/market/provider";
import { runScan } from "@/lib/scans/run-scan";
import {
  scanSymbol,
  type BuyRecommendation,
  type ScanItemResult,
} from "@/lib/signals/scan-symbol";
import { POST as exportResults } from "@/app/api/scans/export/route";
import { POST as scanResults } from "@/app/api/scans/route";

function candle(
  index: number,
  low = 110,
  high = 112,
  close = 111,
  volume = 1_000,
): Candle {
  return {
    time: index * 60_000,
    open: close,
    high,
    low,
    close,
    volume,
  };
}

function buyFixture(): Candle[] {
  const candles = Array.from({ length: 100 }, (_, index) => candle(index));

  // Anchor j=85 is independently confirmed, the low leaves the previous
  // 14-bar channel at t=99, and a causal reaction high makes 1R visible.
  candles[85] = candle(85, 90, 110, 100, 2_000);
  candles[86] = candle(86, 108, 114, 112);
  candles[87] = candle(87, 109, 116, 114);
  candles[91] = candle(91, 95.01, 108, 100, 900);
  candles[92] = candle(92, 108, 111, 110);
  candles[93] = candle(93, 109, 112, 111);
  candles[99] = candle(99, 95.02, 108, 102);
  return candles;
}

function completed(candles: Candle[] = buyFixture()): CandleResponse {
  return { status: "OK", candles, asOf: candles.at(-1)?.time ?? 0 };
}

function instrument(symbol: string): UniverseInstrument {
  return { symbol, yahooSymbol: `${symbol}.NS` };
}

function providerReturning(
  result: CandleResponse,
): MarketDataProvider {
  return { getCandles: vi.fn().mockResolvedValue(result) };
}

describe("scanSymbol", () => {
  it("emits a complete versioned BUY recommendation from completed data", async () => {
    const result = await scanSymbol(
      instrument("RELIANCE"),
      "1d",
      providerReturning(completed()),
    );

    expect(result).toMatchObject({
      symbol: "RELIANCE",
      status: "BUY",
      recommendation: {
        recommendation: "BUY",
        symbol: "RELIANCE",
        yahooSymbol: "RELIANCE.NS",
        timeframe: "1d",
        signalTime: 99 * 60_000,
        autoPeriod: 14,
        probability: null,
        entry: 102,
        currentLdc: 95.01,
        previousLdc: 90,
        anchorTime: 85 * 60_000,
        strategyVersion: "rules-v1",
        dataAsOf: 99 * 60_000,
      },
    });
    expect(result.recommendation?.stop).toBeLessThan(102);
    expect(result.recommendation?.target1).toBeGreaterThan(102);
    expect(result.recommendation?.target2).toBeGreaterThan(
      result.recommendation?.target1 ?? Number.POSITIVE_INFINITY,
    );
  });

  it("emits NO_SIGNAL only after evaluating completed data", async () => {
    const result = await scanSymbol(
      instrument("FLAT"),
      "15m",
      providerReturning(completed(Array.from({ length: 100 }, (_, index) => candle(index)))),
    );

    expect(result).toEqual({ symbol: "FLAT", status: "NO_SIGNAL" });
  });

  it.each([
    "INSUFFICIENT_HISTORY",
    "SYMBOL_NOT_FOUND",
    "PROVIDER_RATE_LIMITED",
    "STALE_DATA",
    "INVALID_CANDLES",
  ] as const)("preserves the %s provider/data status", async (status) => {
    const result = await scanSymbol(
      instrument("DATA"),
      "1d",
      providerReturning({ status, candles: [], asOf: 0 }),
    );

    expect(result).toEqual({ symbol: "DATA", status });
  });

  it("isolates an unexpected provider failure without disguising it as data or a signal", async () => {
    const provider: MarketDataProvider = {
      getCandles: vi.fn().mockRejectedValue(new Error("secret upstream detail")),
    };

    await expect(scanSymbol(instrument("BROKEN"), "1d", provider)).resolves.toEqual({
      symbol: "BROKEN",
      status: "PROVIDER_ERROR",
      message: "Market data provider failed for BROKEN.",
    });
  });
});

describe("runScan", () => {
  it("uses at most six concurrent symbol pipelines and preserves input order", async () => {
    const symbols = Array.from({ length: 14 }, (_, index) => `S${index}`);
    let active = 0;
    let maximumActive = 0;
    const provider: MarketDataProvider = {
      async getCandles(yahooSymbol) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        const index = Number(yahooSymbol.match(/\d+/)?.[0] ?? 0);
        await new Promise((resolve) => setTimeout(resolve, (14 - index) * 2));
        active -= 1;
        return completed(Array.from({ length: 100 }, (_, candleIndex) => candle(candleIndex)));
      },
    };

    const results = await runScan(symbols.map(instrument), "1h", provider);

    expect(maximumActive).toBe(6);
    expect(results.map(({ symbol }) => symbol)).toEqual(symbols);
    expect(results.every(({ status }) => status === "NO_SIGNAL")).toBe(true);
  });

  it("returns partial results when one symbol fails", async () => {
    const provider: MarketDataProvider = {
      async getCandles(yahooSymbol) {
        if (yahooSymbol === "B.NS") {
          throw new Error("connection reset");
        }
        if (yahooSymbol === "C.NS") {
          return { status: "SYMBOL_NOT_FOUND", candles: [], asOf: 0 };
        }
        return completed(Array.from({ length: 100 }, (_, index) => candle(index)));
      },
    };

    await expect(
      runScan([instrument("A"), instrument("B"), instrument("C")], "1d", provider),
    ).resolves.toEqual([
      { symbol: "A", status: "NO_SIGNAL" },
      {
        symbol: "B",
        status: "PROVIDER_ERROR",
        message: "Market data provider failed for B.",
      },
      { symbol: "C", status: "SYMBOL_NOT_FOUND" },
    ]);
  });
});

function recommendation(overrides: Partial<BuyRecommendation> = {}): BuyRecommendation {
  return {
    recommendation: "BUY",
    symbol: "ACME",
    yahooSymbol: "ACME.NS",
    timeframe: "1d",
    signalTime: 1,
    autoPeriod: 14,
    probability: null,
    entry: 100,
    stop: 95,
    target1: 105,
    target2: 110,
    currentLdc: 96,
    previousLdc: 94,
    anchorTime: 2,
    strategyVersion: "rules-v1",
    dataAsOf: 3,
    ...overrides,
  };
}

async function exportedRows(results: ScanItemResult[]): Promise<{
  response: Response;
  rows: Record<string, string>[];
}> {
  const response = await exportResults(
    new Request("http://localhost/api/scans/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ results }),
    }),
  );
  const parsed = Papa.parse<Record<string, string>>(await response.text(), {
    header: true,
    skipEmptyLines: true,
  });
  return { response, rows: parsed.data };
}

describe("scan CSV export", () => {
  it("exports autoPeriod, every price level, version, and data timestamp as valid CSV", async () => {
    const buy = recommendation({ symbol: 'ACME, "Ltd"' });
    const { response, rows } = await exportedRows([
      { symbol: buy.symbol, status: "BUY", recommendation: buy },
    ]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(rows).toEqual([
      expect.objectContaining({
        symbol: 'ACME, "Ltd"',
        status: "BUY",
        autoPeriod: "14",
        entry: "100",
        stop: "95",
        target1: "105",
        target2: "110",
        currentLdc: "96",
        previousLdc: "94",
        strategyVersion: "rules-v1",
        dataAsOf: "3",
      }),
    ]);
  });

  it.each(["=SUM(A1:A2)", "  +cmd", "\t-2+3", " @evil"])(
    "neutralizes spreadsheet formula cell %j after leading whitespace",
    async (symbol) => {
      const { rows } = await exportedRows([
        {
          symbol,
          status: "PROVIDER_ERROR",
          message: "  =HYPERLINK(\"https://example.test\")",
        },
      ]);

      expect(rows[0].symbol).toBe(`'${symbol}`);
      expect(rows[0].message).toBe(
        "'  =HYPERLINK(\"https://example.test\")",
      );
    },
  );

  it("rejects malformed result rows instead of failing during CSV generation", async () => {
    const response = await exportResults(
      new Request("http://localhost/api/scans/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ results: [null] }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid export request",
    });
  });
});

describe("scan JSON endpoint", () => {
  it("runs a server-side scan for a valid universe payload", async () => {
    const response = await scanResults(
      new Request("http://localhost/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruments: [instrument("RELIANCE")],
          timeframe: "1d",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [{ symbol: "RELIANCE", status: "NO_SIGNAL" }],
    });
  });

  it("rejects invalid scan payloads without starting a scan", async () => {
    const response = await scanResults(
      new Request("http://localhost/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruments: [], timeframe: "2m" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid scan request" });
  });
});
