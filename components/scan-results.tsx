"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { SignalDetails } from "@/components/signal-details";
import {
  projectResults,
  rowId,
  type ResultColumn,
  type SortState,
  type TableFilters,
} from "@/lib/results/table-state";
import type { ScanItemResult } from "@/lib/signals/scan-symbol";

const STATUS_LABELS: Record<ScanItemResult["status"], string> = {
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

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

const priceFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COLUMNS: Array<{ column: ResultColumn; label: string; numeric?: boolean }> = [
  { column: "symbol", label: "Instrument" },
  { column: "status", label: "Status" },
  { column: "signalState", label: "Signal state" },
  { column: "confirmation", label: "Reversal confirmation" },
  { column: "entry", label: "Entry reference", numeric: true },
  { column: "stop", label: "Stop", numeric: true },
  { column: "target1", label: "Target 1", numeric: true },
  { column: "target2", label: "Target 2", numeric: true },
  { column: "autoPeriod", label: "Auto period", numeric: true },
  { column: "dataAsOf", label: "Data as of" },
];

const NUMERIC_FILTERS: Array<{ min: keyof TableFilters; max: keyof TableFilters; label: string }> = [
  { min: "minEntry", max: "maxEntry", label: "Entry" },
  { min: "minStop", max: "maxStop", label: "Stop" },
  { min: "minTarget1", max: "maxTarget1", label: "Target 1" },
  { min: "minTarget2", max: "maxTarget2", label: "Target 2" },
  { min: "minAutoPeriod", max: "maxAutoPeriod", label: "Auto period" },
];

function formatPrice(value: number | undefined): string {
  return value === undefined ? "—" : priceFormatter.format(value);
}

function statusText(result: ScanItemResult): string {
  return result.message ?? STATUS_LABELS[result.status];
}

function signalStateText(result: ScanItemResult): string {
  return result.recommendation?.signalState ?? result.recommendation?.sequentialEvidence?.state ?? "—";
}

function confirmationText(result: ScanItemResult): string {
  const confirmation = result.recommendation?.confirmation;
  return confirmation ? `${confirmation.grade} (${confirmation.score.toFixed(2)}/100)` : "—";
}

function sortLabel(sort: SortState | null, column: ResultColumn): "ascending" | "descending" | undefined {
  if (sort?.column !== column) {
    return undefined;
  }
  return sort.direction === "asc" ? "ascending" : "descending";
}

function hasSameResultObjects(previous: ScanItemResult[], next: ScanItemResult[]): boolean {
  return previous.length === next.length && previous.every((result, index) => result === next[index]);
}

export interface ScanResultsProjection {
  filtered: ScanItemResult[];
  selected: ScanItemResult[];
}

export function ScanResults({
  results,
  onProjectionChange,
}: {
  results: ScanItemResult[];
  onProjectionChange?: (projection: ScanResultsProjection) => void;
}) {
  const [filters, setFilters] = useState<TableFilters>({});
  const [sort, setSort] = useState<SortState | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [detailsRowId, setDetailsRowId] = useState<string>();
  const [previousResults, setPreviousResults] = useState(results);
  const selectAllRef = useRef<HTMLInputElement>(null);

  if (results !== previousResults) {
    const validIds = new Set(results.map((result, index) => rowId(result, index)));
    setPreviousResults(results);
    if (!hasSameResultObjects(previousResults, results)) {
      setSelectedIds(new Set());
    }
    if (detailsRowId && !validIds.has(detailsRowId)) {
      setDetailsRowId(undefined);
    }
  }

  const projectedResults = useMemo(
    () => projectResults(results, filters, sort),
    [filters, results, sort],
  );
  const selectedResults = useMemo(
    () => results.filter((result, index) => selectedIds.has(rowId(result, index))),
    [results, selectedIds],
  );
  const visibleIds = useMemo(() => projectedResults.map(({ id }) => id), [projectedResults]);
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  useEffect(() => {
    onProjectionChange?.({
      filtered: projectedResults.map(({ result }) => result),
      selected: selectedResults,
    });
  }, [onProjectionChange, projectedResults, selectedResults]);

  function setFilterValue(field: keyof TableFilters, value: string) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function toggleSort(column: ResultColumn) {
    setSort((current) => ({
      column,
      direction: current?.column === column && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function toggleRow(rowKey: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of visibleIds) {
        if (allVisibleSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  }

  return (
    <div className="results-table">
      <section className="results-toolbar" aria-label="Filter scan results">
        <div className="toolbar-field">
          <label htmlFor="filter-symbol">Instrument filter</label>
          <input
            id="filter-symbol"
            type="search"
            value={filters.symbol ?? ""}
            onChange={(event) => setFilterValue("symbol", event.target.value)}
          />
        </div>
        <div className="toolbar-field">
          <label htmlFor="filter-status">Status filter</label>
          <input
            id="filter-status"
            type="search"
            value={filters.status ?? ""}
            onChange={(event) => setFilterValue("status", event.target.value)}
          />
        </div>
        <div className="toolbar-field">
          <label htmlFor="filter-signal-state">Signal state filter</label>
          <input
            id="filter-signal-state"
            type="search"
            value={filters.signalState ?? ""}
            onChange={(event) => setFilterValue("signalState", event.target.value)}
          />
        </div>
        <div className="toolbar-field">
          <label htmlFor="filter-confirmation">Reversal confirmation filter</label>
          <input
            id="filter-confirmation"
            type="search"
            value={filters.confirmation ?? ""}
            onChange={(event) => setFilterValue("confirmation", event.target.value)}
          />
        </div>
        {NUMERIC_FILTERS.map(({ min, max, label }) => (
          <div className="toolbar-range" key={label}>
            <label>
              Minimum {label}
              <input
                type="number"
                inputMode="decimal"
                value={String(filters[min] ?? "")}
                onChange={(event) => setFilterValue(min, event.target.value)}
              />
            </label>
            <label>
              Maximum {label}
              <input
                type="number"
                inputMode="decimal"
                value={String(filters[max] ?? "")}
                onChange={(event) => setFilterValue(max, event.target.value)}
              />
            </label>
          </div>
        ))}
        <div className="toolbar-range">
          <label>
            Data as of from
            <input
              type="date"
              value={String(filters.dataAsOfFrom ?? "")}
              onChange={(event) => setFilterValue("dataAsOfFrom", event.target.value)}
            />
          </label>
          <label>
            Data as of to
            <input
              type="date"
              value={String(filters.dataAsOfTo ?? "")}
              onChange={(event) => setFilterValue("dataAsOfTo", event.target.value)}
            />
          </label>
        </div>
        <div className="toolbar-actions" aria-label="Table filter actions">
          <button className="table-action" type="button" onClick={() => setFilters({})}>Clear table filters</button>
          <p className="table-count" aria-live="polite">
            {projectedResults.length === 0 ? "No results match these table filters" : `${projectedResults.length} result${projectedResults.length === 1 ? "" : "s"} visible`}
          </p>
          <p className="table-count" aria-live="polite">{selectedResults.length} selected</p>
          <button className="table-action" type="button" onClick={() => setSelectedIds(new Set())}>Clear selection</button>
        </div>
      </section>

      <div className="table-scroll" role="region" tabIndex={0} aria-label="Scrollable scan results">
        <table aria-label="Scan results">
          <thead>
            <tr>
              <th scope="col" className="selection-column">
                <label className="selection-control">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    aria-label="Select all visible results"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                  />
                </label>
              </th>
              {COLUMNS.map(({ column, label, numeric }) => (
                <th key={column} scope="col" className={`${column === "symbol" ? "instrument-column" : ""}${numeric ? " number-cell" : ""}${column === "signalState" ? " signal-state-column" : ""}${column === "confirmation" ? " confirmation-column" : ""}`} aria-sort={sortLabel(sort, column)}>
                  <button className={`sort-button${column === "signalState" || column === "confirmation" ? " sort-button--wrap" : ""}`} type="button" onClick={() => toggleSort(column)} aria-label={`Sort by ${label}`}>
                    {label} {sort?.column === column ? (sort.direction === "asc" ? "↑" : "↓") : null}
                  </button>
                </th>
              ))}
              <th scope="col" aria-label="Calculation details" />
            </tr>
          </thead>
          <tbody>
            {projectedResults.map(({ id, result }) => {
              const recommendation = result.recommendation;
              const detailsId = `details-${id}`;
              const triggerId = `details-trigger-${id}`;
              const isDetailsOpen = detailsRowId === id;
              const isSelected = selectedIds.has(id);

              return (
                <SignalDetails.RowGroup key={id}>
                  <tr className={result.status === "BUY" ? "buy-row" : undefined}>
                    <td className="selection-column">
                      <label className="selection-control">
                        <input
                          type="checkbox"
                          aria-label={`Select ${result.symbol}`}
                          checked={isSelected}
                          onChange={() => toggleRow(id)}
                        />
                      </label>
                    </td>
                    <th scope="row" className="instrument-column">{result.symbol}</th>
                    <td className={result.status === "BUY" ? "buy-status" : "status-copy"}>{statusText(result)}</td>
                    <td className={`table-signal-state table-signal-state--${signalStateText(result).toLowerCase()}`}>
                      {signalStateText(result)}
                    </td>
                    <td className={`table-confirmation table-confirmation--${result.recommendation?.confirmation?.grade?.toLowerCase() ?? "none"}`}>
                      {confirmationText(result)}
                    </td>
                    <td className="number-cell">{formatPrice(recommendation?.entry)}</td>
                    <td className="number-cell">{formatPrice(recommendation?.stop)}</td>
                    <td className="number-cell">{formatPrice(recommendation?.target1)}</td>
                    <td className="number-cell">{formatPrice(recommendation?.target2)}</td>
                    <td className="number-cell">{recommendation?.autoPeriod ?? "—"}</td>
                    <td>
                      {recommendation ? (
                        <time dateTime={new Date(recommendation.dataAsOf).toISOString()}>{dateFormatter.format(recommendation.dataAsOf)}</time>
                      ) : "—"}
                    </td>
                    <td>
                      {recommendation ? (
                        <button
                          id={triggerId}
                          className="details-button"
                          type="button"
                          aria-expanded={isDetailsOpen}
                          aria-controls={detailsId}
                          aria-label={`${isDetailsOpen ? "Hide" : "Show"} calculation details for ${result.symbol}`}
                          onClick={() => setDetailsRowId(isDetailsOpen ? undefined : id)}
                        >
                          {isDetailsOpen ? "Hide" : "Details"}
                        </button>
                      ) : "—"}
                    </td>
                  </tr>
                  {recommendation && isDetailsOpen ? <SignalDetails id={detailsId} recommendation={recommendation} /> : null}
                </SignalDetails.RowGroup>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
