import { describe, expect, it } from "vitest";

import {
  filterResults,
  projectResults,
  rowId,
  sortResults,
  type IndexedResult,
} from "@/lib/results/table-state";
import type { ScanItemResult } from "@/lib/signals/scan-symbol";

function buy(
  symbol: string,
  values: Partial<NonNullable<ScanItemResult["recommendation"]>> = {},
): ScanItemResult {
  return {
    symbol,
    status: "BUY",
    recommendation: {
      recommendation: "BUY",
      symbol,
      yahooSymbol: `${symbol}.NS`,
      timeframe: "1d",
      signalTime: 10,
      autoPeriod: 20,
      probability: null,
      entry: 100,
      stop: 95,
      target1: 110,
      target2: 120,
      currentLdc: 90,
      previousLdc: 89,
      anchorTime: 9,
      strategyVersion: "rules-v1",
      dataAsOf: Date.UTC(2026, 7, 5),
      adjustmentMode: "RAW",
      tickSize: 0.05,
      tickPolicy: "nse-cm-legacy-0.05-v1",
      reactionHigh: 105,
      rewardRisk: 2,
      scoreVersion: "structural-v1",
      score: 0.5,
      scoreComponents: {
        prominence: 0.5,
        recovery: 0.5,
        recency: 0.5,
        retests: 0.5,
        relativeVolume: 0.5,
        higherTimeframeAgreement: 0,
      },
      higherTimeframeInput: "NEUTRAL_UNAVAILABLE",
      anchorRationale: "test recommendation",
      ...values,
    },
  };
}

function indexed(...results: ScanItemResult[]): IndexedResult[] {
  return results.map((result, originalIndex) => ({
    id: rowId(result, originalIndex),
    originalIndex,
    result,
  }));
}

function symbols(rows: IndexedResult[]): string[] {
  return rows.map((row) => row.result.symbol);
}

describe("table state projections", () => {
  it("gives duplicate symbols durable row identifiers based on their original position", () => {
    const first = buy("RELIANCE");
    const second = buy("RELIANCE", { entry: 101 });

    expect(rowId(first, 0)).toBe("RELIANCE-0");
    expect(rowId(second, 1)).toBe("RELIANCE-1");
  });

  it("filters symbols and status keys or display text without regard to case", () => {
    const rows = indexed(
      buy("Reliance"),
      { symbol: "TCS", status: "NO_SIGNAL" },
      { symbol: "Broken", status: "PROVIDER_ERROR", message: "Market data provider failed" },
    );

    expect(symbols(filterResults(rows, { symbol: "lia" }))).toEqual(["Reliance"]);
    expect(symbols(filterResults(rows, { status: "no_signal" }))).toEqual(["TCS"]);
    expect(symbols(filterResults(rows, { status: "provider failed" }))).toEqual(["Broken"]);
  });

  it("applies every populated numeric minimum and maximum filter", () => {
    const rows = indexed(
      buy("MATCH", { entry: 100, stop: 90, target1: 110, target2: 120, autoPeriod: 20 }),
      buy("LOW_ENTRY", { entry: 99, stop: 90, target1: 110, target2: 120, autoPeriod: 20 }),
      buy("HIGH_STOP", { entry: 100, stop: 91, target1: 110, target2: 120, autoPeriod: 20 }),
      buy("LOW_TARGET1", { entry: 100, stop: 90, target1: 109, target2: 120, autoPeriod: 20 }),
      buy("HIGH_TARGET2", { entry: 100, stop: 90, target1: 110, target2: 121, autoPeriod: 20 }),
      buy("HIGH_PERIOD", { entry: 100, stop: 90, target1: 110, target2: 120, autoPeriod: 21 }),
    );

    expect(
      symbols(filterResults(rows, {
        minEntry: "100",
        maxEntry: "100",
        minStop: "90",
        maxStop: "90",
        minTarget1: "110",
        maxTarget1: "110",
        minTarget2: "120",
        maxTarget2: "120",
        minAutoPeriod: "20",
        maxAutoPeriod: "20",
      })),
    ).toEqual(["MATCH"]);
  });

  it("treats blank ranges as absent and includes date endpoints", () => {
    const rows = indexed(
      buy("EARLY", { dataAsOf: Date.UTC(2026, 7, 4, 23, 59) }),
      buy("IN_RANGE", { dataAsOf: Date.UTC(2026, 7, 5, 12) }),
      buy("LATE", { dataAsOf: Date.UTC(2026, 7, 6) }),
    );

    expect(symbols(filterResults(rows, { minEntry: " ", maxEntry: "" }))).toEqual([
      "EARLY",
      "IN_RANGE",
      "LATE",
    ]);
    expect(
      symbols(filterResults(rows, {
        dataAsOfFrom: "2026-08-05",
        dataAsOfTo: "2026-08-05",
      })),
    ).toEqual(["IN_RANGE"]);
  });

  it("combines active filters with AND semantics", () => {
    const rows = indexed(
      buy("RELIANCE", { entry: 150 }),
      buy("RELIANCE-LOW", { entry: 90 }),
      buy("TCS", { entry: 150 }),
    );

    expect(symbols(filterResults(rows, { symbol: "reliance", minEntry: 100 }))).toEqual([
      "RELIANCE",
    ]);
  });

  it("sorts values ascending and descending", () => {
    const rows = indexed(
      buy("HIGH", { entry: 300 }),
      buy("LOW", { entry: 100 }),
      buy("MID", { entry: 200 }),
    );

    expect(symbols(sortResults(rows, { column: "entry", direction: "asc" }))).toEqual([
      "LOW",
      "MID",
      "HIGH",
    ]);
    expect(symbols(sortResults(rows, { column: "entry", direction: "desc" }))).toEqual([
      "HIGH",
      "MID",
      "LOW",
    ]);
  });

  it("keeps missing sort values last in both directions", () => {
    const rows = indexed(
      { symbol: "NO_VALUE", status: "NO_SIGNAL" },
      buy("HIGH", { entry: 200 }),
      buy("LOW", { entry: 100 }),
    );

    expect(symbols(sortResults(rows, { column: "entry", direction: "asc" }))).toEqual([
      "LOW",
      "HIGH",
      "NO_VALUE",
    ]);
    expect(symbols(sortResults(rows, { column: "entry", direction: "desc" }))).toEqual([
      "HIGH",
      "LOW",
      "NO_VALUE",
    ]);
  });

  it("uses original order for equal sort values and never mutates its inputs", () => {
    const results = [
      buy("FIRST", { entry: 100, autoPeriod: 10 }),
      buy("SECOND", { entry: 100, autoPeriod: 20 }),
      buy("THIRD", { entry: 200, autoPeriod: 20 }),
    ];
    const rows = indexed(...results);
    const inputSnapshot = [...rows];

    expect(
      symbols(projectResults(results, { minAutoPeriod: 20 }, { column: "entry", direction: "asc" })),
    ).toEqual(["SECOND", "THIRD"]);
    expect(symbols(sortResults(rows, { column: "entry", direction: "asc" }))).toEqual([
      "FIRST",
      "SECOND",
      "THIRD",
    ]);
    expect(rows).toEqual(inputSnapshot);
    expect(results.map((result) => result.symbol)).toEqual(["FIRST", "SECOND", "THIRD"]);
    expect(results[1].recommendation?.dataAsOf).toBe(Date.UTC(2026, 7, 5));
  });
});
