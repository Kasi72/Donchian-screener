import Papa from "papaparse";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const yahooRequests = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/market/yahoo-provider", () => ({
  YahooMarketDataProvider: class {
    async getCandles(symbol: string): Promise<CandleResponse> {
      yahooRequests.push(symbol);
      return {
        status: "OK",
        asOf: 99 * 60_000,
        adjustmentMode: "BACK_ADJUSTED",
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
  return {
    status: "OK",
    candles,
    asOf: candles.at(-1)?.time ?? 0,
    adjustmentMode: "BACK_ADJUSTED",
  };
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
        adjustmentMode: "BACK_ADJUSTED",
        tickSize: 0.05,
        tickPolicy: "nse-cm-legacy-0.05-v1",
        reactionHigh: 116,
        rewardRisk: expect.any(Number),
        scoreVersion: "structural-v1",
        score: expect.any(Number),
        scoreComponents: {
          prominence: expect.any(Number),
          recovery: expect.any(Number),
          recency: expect.any(Number),
          retests: expect.any(Number),
          relativeVolume: expect.any(Number),
          higherTimeframeAgreement: 0,
        },
        higherTimeframeInput: "NEUTRAL_UNAVAILABLE",
        anchorRationale: expect.stringContaining("confirmed pivot low"),
      },
    });
    expect(result.recommendation?.stop).toBeLessThan(102);
    expect(result.recommendation?.confirmation?.version).toBe("confirmation-v1");
    expect(result.recommendation?.confirmation?.grade).toBe("CORE_ONLY");
    expect(result.recommendation?.signalState).toMatch(/EARLIEST_CANDIDATE|CONFIRMED_REVERSAL/);
    expect(result.recommendation?.sequentialEvidence?.version).toBe("sequential-v1");
    expect(result.recommendation?.signalLow).toBe(95.02);
    expect(result.recommendation?.signalClose).toBe(102);
    expect(result.recommendation?.signalLowTick).toBe(1900);
    expect(result.recommendation?.currentLdcTick).toBe(1900);
    expect(result.recommendation?.previousLdcTick).toBe(1800);
    expect(result.recommendation?.touchDistanceTicks).toBe(0);
    expect(result.recommendation?.rolloverTicks).toBe(100);
    expect(result.recommendation?.windowEndTime).toBe(result.recommendation?.signalTime);
    expect(result.recommendation?.providerAsOf).toBe(result.recommendation?.dataAsOf);
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

  it("rejects a rollover when the signal close is not above its low", async () => {
    const candles = buyFixture();
    candles[99] = candle(99, 95.02, 108, 95.02);

    await expect(
      scanSymbol(instrument("CLOSE-AT-LOW"), "1d", providerReturning(completed(candles))),
    ).resolves.toEqual({ symbol: "CLOSE-AT-LOW", status: "NO_SIGNAL" });
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
      providerReturning({ status, candles: [], asOf: 0, adjustmentMode: "BACK_ADJUSTED" }),
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

  it.each([
    null,
    { status: "OK", candles: null, asOf: 123 },
  ])("turns malformed provider response %j into a safe provider error", async (response) => {
    const provider: MarketDataProvider = {
      getCandles: vi.fn().mockResolvedValue(response),
    } as unknown as MarketDataProvider;

    await expect(scanSymbol(instrument("MALFORMED"), "1d", provider)).resolves.toEqual({
      symbol: "MALFORMED",
      status: "PROVIDER_ERROR",
      message: "Market data provider failed for MALFORMED.",
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
          return {
            status: "SYMBOL_NOT_FOUND",
            candles: [],
            asOf: 0,
            adjustmentMode: "BACK_ADJUSTED",
          };
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

  it("contains a thrown scan worker and continues later symbols in stable order", async () => {
    vi.resetModules();
    const processed: string[] = [];
    vi.doMock("@/lib/signals/scan-symbol", async (importOriginal) => {
      const original = await importOriginal<typeof import("@/lib/signals/scan-symbol")>();
      return {
        ...original,
        async scanSymbol(item: UniverseInstrument): Promise<ScanItemResult> {
          processed.push(item.symbol);
          if (item.symbol === "S1") {
            throw new Error("unexpected worker failure");
          }
          return { symbol: item.symbol, status: "NO_SIGNAL" };
        },
      };
    });

    try {
      const { runScan: runWithThrowingWorker } = await import("@/lib/scans/run-scan");
      const symbols = Array.from({ length: 8 }, (_, index) => `S${index}`);
      const results = await runWithThrowingWorker(
        symbols.map(instrument),
        "1d",
        providerReturning(completed()),
      );

      expect(processed).toContain("S7");
      expect(results.map(({ symbol }) => symbol)).toEqual(symbols);
      expect(results[1]).toEqual({
        symbol: "S1",
        status: "PROVIDER_ERROR",
        message: "Scan failed for S1.",
      });
    } finally {
      vi.doUnmock("@/lib/signals/scan-symbol");
      vi.resetModules();
    }
  });

  it("propagates request cancellation to the provider and stops the scan", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const provider: MarketDataProvider = {
      async getCandles(_symbol, _timeframe, _now, options) {
        receivedSignal = options?.signal;
        return await new Promise<CandleResponse>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        });
      },
    };

    const pending = runScan([instrument("A"), instrument("B")], "1d", provider, {
      signal: controller.signal,
      itemTimeoutMs: 5_000,
    });
    await vi.waitFor(() => expect(receivedSignal).toBeDefined());
    controller.abort(new DOMException("User cancelled scan", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("bounds each provider request with a deadline and returns a timeout data status", async () => {
    let deadlineMs: number | undefined;
    const provider: MarketDataProvider = {
      async getCandles(_symbol, _timeframe, _now, options) {
        deadlineMs = options?.deadlineMs;
        return await new Promise<CandleResponse>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        });
      },
    };

    const startedAt = Date.now();
    await expect(
      runScan([instrument("SLOW")], "1d", provider, { itemTimeoutMs: 20 }),
    ).resolves.toEqual([{ symbol: "SLOW", status: "PROVIDER_TIMEOUT" }]);
    expect(deadlineMs).toBeGreaterThanOrEqual(startedAt + 15);
    expect(deadlineMs).toBeLessThanOrEqual(Date.now() + 20);
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
    adjustmentMode: "BACK_ADJUSTED",
    tickSize: 0.05,
    tickPolicy: "nse-cm-legacy-0.05-v1",
    reactionHigh: 110,
    rewardRisk: 2,
    scoreVersion: "structural-v1",
    score: 0.5705,
    scoreComponents: { prominence: 0.5, recovery: 0.5, recency: 0.5, retests: 0.5, relativeVolume: 0.5, higherTimeframeAgreement: 0 },
    higherTimeframeInput: "NEUTRAL_UNAVAILABLE",
    anchorRationale: "Confirmed structural pivot selected causally.",
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
    const buy = recommendation({
      symbol: 'ACME, "Ltd"',
      signalLow: 96,
      signalClose: 101,
      signalOpen: 99,
      signalHigh: 103,
      signalLowTick: 1920,
      currentLdcTick: 1920,
      previousLdcTick: 1880,
      windowStartTime: -10,
      windowEndTime: 1,
      previousWindowStartTime: -11,
      previousWindowEndTime: 0,
      providerAsOf: 3,
      rolloverTicks: 40,
      touchDistanceTicks: 0,
      periodCandidateCount: 2,
      periodAudit: [
        {
          period: 12,
          currentLdc: 97,
          previousLdc: 94,
          currentLdcTick: 1940,
          previousLdcTick: 1880,
          signalLowTick: 1920,
          touchPassed: false,
          rolloverPassed: true,
          valid: false,
        },
      ],
      windowAudit: {
        expectedSessions: 14,
        observedSessions: 14,
        missingSessions: 0,
        complete: true,
      },
      anchorIndex: 0,
      anchorBarsAgo: 14,
    });
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
        signalLow: "96",
        signalClose: "101",
        currentLdcTick: "1920",
        previousLdcTick: "1880",
        signalCandleTime: "1",
        windowStartTime: "'-10",
        windowEndTime: "1",
        previousWindowStartTime: "'-11",
        previousWindowEndTime: "0",
        providerAsOf: "3",
        rolloverTicks: "40",
        touchDistanceTicks: "0",
        periodCandidateCount: "2",
        periodAudit: '[{"period":12,"currentLdc":97,"previousLdc":94,"currentLdcTick":1940,"previousLdcTick":1880,"signalLowTick":1920,"touchPassed":false,"rolloverPassed":true,"valid":false}]',
        windowAudit: '{"expectedSessions":14,"observedSessions":14,"missingSessions":0,"complete":true}',
        anchorIndex: "0",
        anchorBarsAgo: "14",
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

  it.each([
    {
      name: "BUY without recommendation",
      row: { symbol: "ACME", status: "BUY" },
    },
    {
      name: "BUY with an incomplete recommendation",
      row: {
        symbol: "ACME",
        status: "BUY",
        recommendation: (({ target2: _target2, ...rest }) => rest)(recommendation()),
      },
    },
    {
      name: "BUY whose recommendation belongs to another symbol",
      row: {
        symbol: "ACME",
        status: "BUY",
        recommendation: recommendation({ symbol: "OTHER" }),
      },
    },
    {
      name: "non-BUY carrying a recommendation",
      row: {
        symbol: "ACME",
        status: "NO_SIGNAL",
        recommendation: recommendation(),
      },
    },
  ])("rejects $name", async ({ row }) => {
    const response = await exportResults(
      new Request("http://localhost/api/scans/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ results: [row] }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid export request",
    });
  });

  it("rejects an export larger than the production item bound", async () => {
    const response = await exportResults(
      new Request("http://localhost/api/scans/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          results: Array.from({ length: 501 }, (_, index) => ({
            symbol: `S${index}`,
            status: "NO_SIGNAL",
          })),
        }),
      }),
    );

    expect(response.status).toBe(413);
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

  it("derives the provider symbol from canonical identity instead of trusting yahooSymbol", async () => {
    yahooRequests.length = 0;
    const response = await scanResults(
      new Request("http://localhost/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruments: [
            { symbol: "RELIANCE", yahooSymbol: "^NSEI", companyName: "Reliance Industries" },
          ],
          timeframe: "1d",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(yahooRequests).toEqual(["RELIANCE.NS"]);
  });

  it.each(["^NSEI", "^NSEBANK", "^CRSLDX", "^INDIAVIX"])(
    "fetches the built-in index %s without an equity suffix",
    async (symbol) => {
      yahooRequests.length = 0;
      const response = await scanResults(
        new Request("http://localhost/api/scans", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            instruments: [{ symbol, yahooSymbol: `${symbol}.NS` }],
            timeframe: "1d",
          }),
        }),
      );

      expect(response.status).toBe(200);
      expect(yahooRequests).toEqual([symbol]);
    },
  );

  it("deduplicates canonical instruments at the server boundary", async () => {
    yahooRequests.length = 0;
    const response = await scanResults(
      new Request("http://localhost/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruments: [
            { symbol: "reliance", yahooSymbol: "BAD" },
            { symbol: " RELIANCE ", yahooSymbol: "ALSO-BAD" },
          ],
          timeframe: "1d",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(yahooRequests).toEqual(["RELIANCE.NS"]);
    await expect(response.json()).resolves.toMatchObject({ results: [{ symbol: "RELIANCE" }] });
  });

  it("rejects scans larger than the production item bound", async () => {
    const response = await scanResults(
      new Request("http://localhost/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruments: Array.from({ length: 501 }, (_, index) => ({ symbol: `S${index}` })),
          timeframe: "1d",
        }),
      }),
    );

    expect(response.status).toBe(413);
  });

  it("rejects an oversized scan body before parsing it", async () => {
    const response = await scanResults(
      new Request("http://localhost/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruments: [{ symbol: "RELIANCE", companyName: "X".repeat(1_100_000) }],
          timeframe: "1d",
        }),
      }),
    );

    expect(response.status).toBe(413);
  });
});
