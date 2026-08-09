import type { ScanItemResult } from "@/lib/signals/scan-symbol";

export type ResultColumn =
  | "symbol"
  | "status"
  | "entry"
  | "stop"
  | "target1"
  | "target2"
  | "autoPeriod"
  | "dataAsOf";

export interface SortState {
  column: ResultColumn;
  direction: "asc" | "desc";
}

type RangeInput = number | string | Date | null | undefined;

export interface TableFilters {
  symbol?: string;
  status?: string;
  minEntry?: RangeInput;
  maxEntry?: RangeInput;
  minStop?: RangeInput;
  maxStop?: RangeInput;
  minTarget1?: RangeInput;
  maxTarget1?: RangeInput;
  minTarget2?: RangeInput;
  maxTarget2?: RangeInput;
  minAutoPeriod?: RangeInput;
  maxAutoPeriod?: RangeInput;
  dataAsOfFrom?: RangeInput;
  dataAsOfTo?: RangeInput;
}

export interface IndexedResult {
  id: string;
  originalIndex: number;
  result: ScanItemResult;
}

const STATUS_TEXT: Record<ScanItemResult["status"], string> = {
  BUY: "BUY",
  NO_SIGNAL: "No completed-candle BUY signal",
  OK: "No completed-candle BUY signal",
  INSUFFICIENT_HISTORY: "Not enough completed candles",
  SYMBOL_NOT_FOUND: "Symbol not found",
  PROVIDER_RATE_LIMITED: "Market data temporarily rate-limited",
  STALE_DATA: "Market data is stale",
  INVALID_CANDLES: "Market data could not be validated",
  PROVIDER_ERROR: "Market data provider error",
  DATA_QUALITY_LIMITATION: "Market data calendar or adjustment coverage is limited",
  PROVIDER_TIMEOUT: "Market data request timed out",
  INVALID_INSTRUMENT: "Instrument is not supported",
  TICK_SIZE_UNRESOLVED: "Instrument tick size could not be resolved",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeText(value: string): string {
  return value.toLocaleLowerCase().replaceAll(/[_-]+/g, " ").replaceAll(/\s+/g, " ").trim();
}

function statusText(result: ScanItemResult): string {
  return result.message ?? STATUS_TEXT[result.status];
}

function columnValue(result: ScanItemResult, column: ResultColumn): string | number | undefined {
  const recommendation = result.recommendation;
  switch (column) {
    case "symbol":
      return result.symbol;
    case "status":
      return `${result.status} ${statusText(result)}`;
    case "entry":
      return recommendation?.entry;
    case "stop":
      return recommendation?.stop;
    case "target1":
      return recommendation?.target1;
    case "target2":
      return recommendation?.target2;
    case "autoPeriod":
      return recommendation?.autoPeriod;
    case "dataAsOf":
      return recommendation?.dataAsOf;
  }
}

function numberInput(value: RangeInput): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dateInput(value: RangeInput, isEnd: boolean): number | undefined {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  const text = value.trim();
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && isEnd ? timestamp + DAY_MS - 1 : timestamp;
}

function isWithinRange(value: number | undefined, minimum: number | undefined, maximum: number | undefined): boolean {
  if (minimum === undefined && maximum === undefined) {
    return true;
  }
  return value !== undefined && (minimum === undefined || value >= minimum) && (maximum === undefined || value <= maximum);
}

export function rowId(result: ScanItemResult, originalIndex: number): string {
  return `${result.symbol}-${originalIndex}`;
}

export function filterResults(indexedResults: IndexedResult[], filters: TableFilters = {}): IndexedResult[] {
  const symbol = normalizeText(filters.symbol ?? "");
  const status = normalizeText(filters.status ?? "");
  const ranges = {
    entry: [numberInput(filters.minEntry), numberInput(filters.maxEntry)],
    stop: [numberInput(filters.minStop), numberInput(filters.maxStop)],
    target1: [numberInput(filters.minTarget1), numberInput(filters.maxTarget1)],
    target2: [numberInput(filters.minTarget2), numberInput(filters.maxTarget2)],
    autoPeriod: [numberInput(filters.minAutoPeriod), numberInput(filters.maxAutoPeriod)],
    dataAsOf: [dateInput(filters.dataAsOfFrom, false), dateInput(filters.dataAsOfTo, true)],
  } as const;

  return indexedResults.filter(({ result }) => {
    if (symbol && !normalizeText(result.symbol).includes(symbol)) {
      return false;
    }
    if (status && !normalizeText(`${result.status} ${statusText(result)}`).includes(status)) {
      return false;
    }
    return (
      isWithinRange(columnValue(result, "entry") as number | undefined, ...ranges.entry) &&
      isWithinRange(columnValue(result, "stop") as number | undefined, ...ranges.stop) &&
      isWithinRange(columnValue(result, "target1") as number | undefined, ...ranges.target1) &&
      isWithinRange(columnValue(result, "target2") as number | undefined, ...ranges.target2) &&
      isWithinRange(columnValue(result, "autoPeriod") as number | undefined, ...ranges.autoPeriod) &&
      isWithinRange(columnValue(result, "dataAsOf") as number | undefined, ...ranges.dataAsOf)
    );
  });
}

export function sortResults(indexedResults: IndexedResult[], sort?: SortState | null): IndexedResult[] {
  if (sort === null || sort === undefined) {
    return [...indexedResults];
  }
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...indexedResults].sort((left, right) => {
    const leftValue = columnValue(left.result, sort.column);
    const rightValue = columnValue(right.result, sort.column);
    if (leftValue === undefined) {
      return rightValue === undefined ? left.originalIndex - right.originalIndex : 1;
    }
    if (rightValue === undefined) {
      return -1;
    }
    const comparison = typeof leftValue === "string" && typeof rightValue === "string"
      ? leftValue.localeCompare(rightValue, undefined, { sensitivity: "base" })
      : Number(leftValue) - Number(rightValue);
    return comparison === 0 ? left.originalIndex - right.originalIndex : comparison * direction;
  });
}

export function projectResults(
  results: ScanItemResult[],
  filters: TableFilters = {},
  sort?: SortState | null,
): IndexedResult[] {
  const indexedResults = results.map((result, originalIndex) => ({
    id: rowId(result, originalIndex),
    originalIndex,
    result,
  }));
  return sortResults(filterResults(indexedResults, filters), sort);
}
