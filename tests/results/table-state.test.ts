import { describe, expect, it } from "vitest";

import {
  filterResults,
  projectResults,
  rowId,
  sortResults,
  type IndexedResult,
  type ResultColumn,
  type TableFilters,
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

type RecommendationNumberField = "entry" | "stop" | "target1" | "target2" | "autoPeriod";

function numericRows(field: RecommendationNumberField): IndexedResult[] {
  return indexed(
    buy("BELOW", { [field]: 99 }),
    buy("AT_BOUNDARY", { [field]: 100 }),
    buy("ABOVE", { [field]: 101 }),
  );
}

const NUMERIC_ENDPOINT_CASES: Array<{
  field: RecommendationNumberField;
  filters: TableFilters;
  label: string;
  expected: string[];
}> = [
  { label: "minimum entry", field: "entry", filters: { minEntry: "100" }, expected: ["AT_BOUNDARY", "ABOVE"] },
  { label: "maximum entry", field: "entry", filters: { maxEntry: "100" }, expected: ["BELOW", "AT_BOUNDARY"] },
  { label: "minimum stop", field: "stop", filters: { minStop: "100" }, expected: ["AT_BOUNDARY", "ABOVE"] },
  { label: "maximum stop", field: "stop", filters: { maxStop: "100" }, expected: ["BELOW", "AT_BOUNDARY"] },
  { label: "minimum target 1", field: "target1", filters: { minTarget1: "100" }, expected: ["AT_BOUNDARY", "ABOVE"] },
  { label: "maximum target 1", field: "target1", filters: { maxTarget1: "100" }, expected: ["BELOW", "AT_BOUNDARY"] },
  { label: "minimum target 2", field: "target2", filters: { minTarget2: "100" }, expected: ["AT_BOUNDARY", "ABOVE"] },
  { label: "maximum target 2", field: "target2", filters: { maxTarget2: "100" }, expected: ["BELOW", "AT_BOUNDARY"] },
  { label: "minimum auto period", field: "autoPeriod", filters: { minAutoPeriod: "100" }, expected: ["AT_BOUNDARY", "ABOVE"] },
  { label: "maximum auto period", field: "autoPeriod", filters: { maxAutoPeriod: "100" }, expected: ["BELOW", "AT_BOUNDARY"] },
];

const SORT_ROWS = indexed(
  buy("ZETA", {
    entry: 100,
    stop: 300,
    target1: 200,
    target2: 100,
    autoPeriod: 200,
    dataAsOf: 300,
  }),
  buy("ALPHA", {
    entry: 200,
    stop: 100,
    target1: 300,
    target2: 300,
    autoPeriod: 100,
    dataAsOf: 200,
  }),
  buy("MU", {
    entry: 300,
    stop: 200,
    target1: 100,
    target2: 200,
    autoPeriod: 300,
    dataAsOf: 100,
  }),
  { symbol: "MISSING", status: "NO_SIGNAL" },
);

const SORT_EXPECTATIONS: Array<{
  column: ResultColumn;
  ascending: string[];
  descending: string[];
}> = [
  { column: "symbol", ascending: ["ALPHA", "MISSING", "MU", "ZETA"], descending: ["ZETA", "MU", "MISSING", "ALPHA"] },
  { column: "status", ascending: ["ZETA", "ALPHA", "MU", "MISSING"], descending: ["MISSING", "ZETA", "ALPHA", "MU"] },
  { column: "entry", ascending: ["ZETA", "ALPHA", "MU", "MISSING"], descending: ["MU", "ALPHA", "ZETA", "MISSING"] },
  { column: "stop", ascending: ["ALPHA", "MU", "ZETA", "MISSING"], descending: ["ZETA", "MU", "ALPHA", "MISSING"] },
  { column: "target1", ascending: ["MU", "ZETA", "ALPHA", "MISSING"], descending: ["ALPHA", "ZETA", "MU", "MISSING"] },
  { column: "target2", ascending: ["ZETA", "MU", "ALPHA", "MISSING"], descending: ["ALPHA", "MU", "ZETA", "MISSING"] },
  { column: "autoPeriod", ascending: ["ALPHA", "ZETA", "MU", "MISSING"], descending: ["MU", "ZETA", "ALPHA", "MISSING"] },
  { column: "dataAsOf", ascending: ["MU", "ALPHA", "ZETA", "MISSING"], descending: ["ZETA", "ALPHA", "MU", "MISSING"] },
];

describe("table state projections", () => {
  it("gives duplicate symbols durable row identifiers based on their original position", () => {
    const first = buy("RELIANCE");
    const second = buy("RELIANCE", { entry: 101 });

    expect(rowId(first, 0)).toBe("RELIANCE-0");
    expect(rowId(second, 1)).toBe("RELIANCE-1");
  });

  it("filters symbols and exact status keys or display text without regard to case", () => {
    const rows = indexed(
      buy("Reliance"),
      { symbol: "TCS", status: "NO_SIGNAL" },
      { symbol: "INFY", status: "OK" },
      { symbol: "Broken", status: "PROVIDER_ERROR", message: "Market data provider failed" },
    );

    expect(symbols(filterResults(rows, { symbol: "lia" }))).toEqual(["Reliance"]);
    expect(symbols(filterResults(rows, { status: "BUY" }))).toEqual(["Reliance"]);
    expect(symbols(filterResults(rows, { status: "no_signal" }))).toEqual(["TCS"]);
    expect(symbols(filterResults(rows, { status: "OK" }))).toEqual(["INFY"]);
    expect(symbols(filterResults(rows, { status: "provider failed" }))).toEqual(["Broken"]);
  });

  it("filters signal state and reversal confirmation text", () => {
    const rows = indexed(
      buy("CANDIDATE", {
        signalState: "EARLIEST_CANDIDATE",
        confirmation: {
          version: "confirmation-v1",
          score: 52,
          grade: "CORE_ONLY",
          closeLocation: 0.5,
          lowerWickRatio: 0.5,
          atrRecovery: 0.5,
          volumeZScore: null,
          changePointScore: 0.5,
          validPeriodCount: 1,
          validPeriodRange: [40, 40],
          higherTimeframe: "UNAVAILABLE",
          relativeStrength: "UNAVAILABLE",
          reasons: [],
        },
      }),
      buy("CONFIRMED", {
        signalState: "CONFIRMED_REVERSAL",
        confirmation: {
          version: "confirmation-v1",
          score: 80,
          grade: "STRONG",
          closeLocation: 0.9,
          lowerWickRatio: 0.9,
          atrRecovery: 2,
          volumeZScore: 1,
          changePointScore: 0.9,
          validPeriodCount: 4,
          validPeriodRange: [39, 42],
          higherTimeframe: "UNAVAILABLE",
          relativeStrength: "UNAVAILABLE",
          reasons: [],
        },
      }),
    );

    expect(symbols(filterResults(rows, { signalState: "confirmed reversal" }))).toEqual(["CONFIRMED"]);
    expect(symbols(filterResults(rows, { confirmation: "strong" }))).toEqual(["CONFIRMED"]);
    expect(symbols(filterResults(rows, { confirmation: "core only" }))).toEqual(["CANDIDATE"]);
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

  it.each(NUMERIC_ENDPOINT_CASES)("applies the $label endpoint inclusively in isolation", ({ field, filters, expected }) => {
    expect(symbols(filterResults(numericRows(field), filters))).toEqual(expected);
  });

  it("treats blank ranges as absent and includes date endpoints", () => {
    const rows = indexed(
      buy("EARLY", { dataAsOf: Date.UTC(2026, 7, 4, 18, 29, 59, 999) }),
      buy("IN_RANGE", { dataAsOf: Date.UTC(2026, 7, 5, 12) }),
      buy("LATE", { dataAsOf: Date.UTC(2026, 7, 5, 18, 30) }),
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

  it("uses inclusive Asia/Kolkata calendar-day boundaries for date-only filters", () => {
    const rows = indexed(
      buy("BEFORE", { dataAsOf: Date.parse("2026-08-08T18:29:59.999Z") }),
      buy("START", { dataAsOf: Date.parse("2026-08-08T18:30:00.000Z") }),
      buy("DISPLAYED_AUG_9", { dataAsOf: Date.parse("2026-08-08T20:00:00.000Z") }),
      buy("END", { dataAsOf: Date.parse("2026-08-09T18:29:59.999Z") }),
      buy("AFTER", { dataAsOf: Date.parse("2026-08-09T18:30:00.000Z") }),
    );

    expect(symbols(filterResults(rows, { dataAsOfFrom: "2026-08-09" }))).toEqual([
      "START",
      "DISPLAYED_AUG_9",
      "END",
      "AFTER",
    ]);
    expect(symbols(filterResults(rows, { dataAsOfTo: "2026-08-09" }))).toEqual([
      "BEFORE",
      "START",
      "DISPLAYED_AUG_9",
      "END",
    ]);
    expect(symbols(filterResults(rows, {
      dataAsOfFrom: "2026-08-09",
      dataAsOfTo: "2026-08-09",
    }))).toEqual(["START", "DISPLAYED_AUG_9", "END"]);
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

  it.each(SORT_EXPECTATIONS)("sorts $column ascending and descending with missing values last", ({ column, ascending, descending }) => {
    expect(symbols(sortResults(SORT_ROWS, { column, direction: "asc" }))).toEqual(ascending);
    expect(symbols(sortResults(SORT_ROWS, { column, direction: "desc" }))).toEqual(descending);
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
