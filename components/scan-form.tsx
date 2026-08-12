"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ScanResults, type ScanResultsProjection } from "@/components/scan-results";
import type { UniverseInstrument, UniverseParseResult } from "@/lib/domain/types";
import type { Timeframe } from "@/lib/market/provider";
import type { ScanItemResult } from "@/lib/signals/scan-symbol";

type WorkPhase =
  | "empty"
  | "parsing"
  | "ready"
  | "scanning"
  | "complete"
  | "exporting";
type ResultFilter = "ALL" | "BUY" | "NO_SIGNAL" | "DATA_ISSUE";

interface RequestError {
  title: string;
  detail: string;
}

interface ActiveRequest {
  controller: AbortController;
  id: number;
}

const TIMEFRAMES: Array<{ value: Timeframe; label: string }> = [
  { value: "5m", label: "5 minutes" },
  { value: "15m", label: "15 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "1d", label: "1 day" },
  { value: "1wk", label: "1 week" },
  { value: "1mo", label: "1 month" },
];

const TIMEFRAME_VALUES = new Set<Timeframe>(TIMEFRAMES.map(({ value }) => value));
const NON_BUY_STATUSES = new Set<ScanItemResult["status"]>([
  "NO_SIGNAL",
  "OK",
  "INSUFFICIENT_HISTORY",
  "SYMBOL_NOT_FOUND",
  "PROVIDER_RATE_LIMITED",
  "STALE_DATA",
  "INVALID_CANDLES",
  "DATA_QUALITY_LIMITATION",
  "PROVIDER_TIMEOUT",
  "INVALID_INSTRUMENT",
  "TICK_SIZE_UNRESOLVED",
  "PROVIDER_ERROR",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRenderableTimestamp(value: unknown): value is number {
  return isFiniteNumber(value) && !Number.isNaN(new Date(value).getTime());
}

function hasFiniteScoreComponents(value: unknown): boolean {
  return isRecord(value) &&
    ["prominence", "recovery", "recency", "retests", "relativeVolume", "higherTimeframeAgreement"].every(
      (component) => isFiniteNumber(value[component]),
    );
}

function isReversalConfirmation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const range = value.validPeriodRange;
  const validPeriodCount = value.validPeriodCount;
  return (
    value.version === "confirmation-v1" &&
    (value.grade === "STRONG" || value.grade === "CONFIRMED" || value.grade === "CORE_ONLY") &&
    isFiniteNumber(value.score) && value.score >= 0 && value.score <= 100 &&
    isFiniteNumber(value.closeLocation) &&
    isFiniteNumber(value.lowerWickRatio) &&
    isFiniteNumber(value.atrRecovery) &&
    (value.volumeZScore === null || isFiniteNumber(value.volumeZScore)) &&
    isFiniteNumber(value.changePointScore) &&
    isNonNegativeInteger(validPeriodCount) &&
    Array.isArray(range) && range.length === 2 &&
    Number.isInteger(range[0]) && Number.isInteger(range[1]) && range[0] <= range[1] &&
    value.higherTimeframe === "UNAVAILABLE" &&
    value.relativeStrength === "UNAVAILABLE" &&
    Array.isArray(value.reasons) && value.reasons.every((reason) => typeof reason === "string")
  );
}

function isUniverseInstrument(value: unknown): value is UniverseInstrument {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.symbol === "string" &&
    value.symbol.length > 0 &&
    typeof value.yahooSymbol === "string" &&
    value.yahooSymbol.length > 0 &&
    isOptionalString(value.companyName) &&
    isOptionalString(value.industry) &&
    isOptionalString(value.series) &&
    isOptionalString(value.isin)
  );
}

function isUniverseParseResult(value: unknown): value is UniverseParseResult {
  if (!isRecord(value) || !Array.isArray(value.instruments) || !Array.isArray(value.rejected)) {
    return false;
  }
  return (
    value.instruments.every(isUniverseInstrument) &&
    value.rejected.every(
      (rejected) =>
        isRecord(rejected) &&
        Number.isInteger(rejected.row) &&
        (rejected.row as number) > 0 &&
        isOptionalString(rejected.symbol) &&
        typeof rejected.reason === "string",
    ) &&
    isNonNegativeInteger(value.duplicateCount) &&
    isNonNegativeInteger(value.totalRows)
  );
}

function isBuyRecommendation(value: unknown, symbol: string): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.recommendation === "BUY" &&
    value.symbol === symbol &&
    typeof value.yahooSymbol === "string" &&
    TIMEFRAME_VALUES.has(value.timeframe as Timeframe) &&
    isRenderableTimestamp(value.signalTime) &&
    typeof value.autoPeriod === "number" &&
    Number.isInteger(value.autoPeriod) &&
    value.autoPeriod > 0 &&
    value.probability === null &&
    isFiniteNumber(value.entry) &&
    isFiniteNumber(value.stop) &&
    isFiniteNumber(value.target1) &&
    isFiniteNumber(value.target2) &&
    isFiniteNumber(value.currentLdc) &&
    isFiniteNumber(value.previousLdc) &&
    isRenderableTimestamp(value.anchorTime) &&
    value.strategyVersion === "rules-v1" &&
    isRenderableTimestamp(value.dataAsOf) &&
    (value.adjustmentMode === "RAW" || value.adjustmentMode === "BACK_ADJUSTED") &&
    isFiniteNumber(value.tickSize) &&
    value.tickSize > 0 &&
    (value.tickPolicy === "nse-cm-price-band-2025-v1" ||
      value.tickPolicy === "nse-cm-legacy-0.05-v1" ||
      value.tickPolicy === "nse-index-metadata-v1") &&
    isFiniteNumber(value.reactionHigh) &&
    isFiniteNumber(value.rewardRisk) &&
    value.scoreVersion === "structural-v1" &&
    isFiniteNumber(value.score) &&
    hasFiniteScoreComponents(value.scoreComponents) &&
    value.higherTimeframeInput === "NEUTRAL_UNAVAILABLE" &&
    typeof value.anchorRationale === "string" &&
    (value.confirmation === undefined || isReversalConfirmation(value.confirmation)) &&
    isOptionalString(value.companyName) &&
    isOptionalString(value.industry)
  );
}

function isScanItemResult(value: unknown): value is ScanItemResult {
  if (!isRecord(value) || typeof value.symbol !== "string" || typeof value.status !== "string") {
    return false;
  }
  if (!isOptionalString(value.message)) {
    return false;
  }
  if (value.status === "BUY") {
    return isBuyRecommendation(value.recommendation, value.symbol);
  }
  return (
    NON_BUY_STATUSES.has(value.status as ScanItemResult["status"]) &&
    value.recommendation === undefined
  );
}

function parseScanResults(value: unknown): ScanItemResult[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.results) || !value.results.every(isScanItemResult)) {
    return undefined;
  }
  return value.results;
}

function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === "AbortError";
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export function ScanForm() {
  const [phase, setPhase] = useState<WorkPhase>("empty");
  const [fileName, setFileName] = useState<string>();
  const [parseResult, setParseResult] = useState<UniverseParseResult>();
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
  const [results, setResults] = useState<ScanItemResult[]>([]);
  const [resultFilter, setResultFilter] = useState<ResultFilter>("ALL");
  const [projection, setProjection] = useState<ScanResultsProjection>({ filtered: [], selected: [] });
  const [error, setError] = useState<RequestError>();
  const errorRef = useRef<HTMLDivElement>(null);
  const activeRequestRef = useRef<ActiveRequest | undefined>(undefined);
  const requestIdRef = useRef(0);

  const instruments = parseResult?.instruments ?? [];
  const isBusy = phase === "parsing" || phase === "scanning" || phase === "exporting";
  const categoryResults = useMemo(
    () => results.filter((result) => {
      if (resultFilter === "ALL") return true;
      if (resultFilter === "BUY") return result.status === "BUY";
      if (resultFilter === "NO_SIGNAL") return result.status === "NO_SIGNAL" || result.status === "OK";
      return result.status !== "BUY" && result.status !== "NO_SIGNAL" && result.status !== "OK";
    }),
    [resultFilter, results],
  );
  const resetProjection = useCallback(() => setProjection({ filtered: [], selected: [] }), []);

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
      activeRequestRef.current?.controller.abort();
    },
    [],
  );

  function beginRequest(): ActiveRequest {
    activeRequestRef.current?.controller.abort();
    const request = {
      controller: new AbortController(),
      id: requestIdRef.current + 1,
    };
    requestIdRef.current = request.id;
    activeRequestRef.current = request;
    return request;
  }

  function ownsRequest(request: ActiveRequest): boolean {
    return requestIdRef.current === request.id && !request.controller.signal.aborted;
  }

  function cancelActiveRequest(): void {
    requestIdRef.current += 1;
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = undefined;
  }

  async function parseFile(file: File): Promise<void> {
    const request = beginRequest();
    setFileName(file.name);
    setParseResult(undefined);
    setResults([]);
    resetProjection();
    setError(undefined);
    setPhase("parsing");

    const formData = new FormData();
    formData.set("file", file);

    try {
      const response = await fetch("/api/universe/parse", {
        method: "POST",
        body: formData,
        signal: request.controller.signal,
      });
      if (!ownsRequest(request)) {
        return;
      }
      if (!response.ok) {
        throw new Error(await readError(response, "The file could not be parsed."));
      }

      const parsed: unknown = await response.json();
      if (!ownsRequest(request)) {
        return;
      }
      if (!isUniverseParseResult(parsed)) {
        throw new Error("The server returned an invalid stock list summary.");
      }

      setParseResult(parsed);
      setPhase(parsed.instruments.length > 0 ? "ready" : "empty");
    } catch (cause) {
      if (!ownsRequest(request) || isAbortError(cause)) {
        return;
      }
      setError({
        title: "We couldn't load that stock list.",
        detail: cause instanceof Error ? cause.message : "Try another CSV file.",
      });
      setPhase("empty");
    }
  }

  async function runCurrentScan(): Promise<void> {
    if (instruments.length === 0) {
      return;
    }

    const request = beginRequest();
    setError(undefined);
    setResults([]);
    resetProjection();
    setPhase("scanning");

    try {
      const response = await fetch("/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruments, timeframe }),
        signal: request.controller.signal,
      });
      if (!ownsRequest(request)) {
        return;
      }
      if (!response.ok) {
        throw new Error(await readError(response, "The scan could not be completed."));
      }

      const body: unknown = await response.json();
      if (!ownsRequest(request)) {
        return;
      }
      const parsedResults = parseScanResults(body);
      if (!parsedResults) {
        throw new Error("The server returned invalid scan results.");
      }
      setResults(parsedResults);
      setPhase("complete");
    } catch (cause) {
      if (!ownsRequest(request) || isAbortError(cause)) {
        return;
      }
      setError({
        title: "We couldn't complete this scan.",
        detail: cause instanceof Error ? cause.message : "Try the scan again.",
      });
      setPhase("ready");
    }
  }

  async function exportRows(rows: ScanItemResult[], filename: string): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const request = beginRequest();
    setError(undefined);
    setPhase("exporting");

    try {
      const response = await fetch("/api/scans/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ results: rows }),
        signal: request.controller.signal,
      });
      if (!ownsRequest(request)) {
        return;
      }
      if (!response.ok) {
        throw new Error(await readError(response, "The results could not be exported."));
      }

      const blob = await response.blob();
      if (!ownsRequest(request)) {
        return;
      }
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
      }
      setPhase("complete");
    } catch (cause) {
      if (!ownsRequest(request) || isAbortError(cause)) {
        return;
      }
      setError({
        title: "We couldn't export these results.",
        detail: cause instanceof Error ? cause.message : "Try exporting again.",
      });
      setPhase("complete");
    }
  }

  const buyCount = results.filter(({ status }) => status === "BUY").length;

  return (
    <div className="scan-workspace">
      <section className="scan-panel" aria-label="Scan setup">
        {error ? (
          <div className="error-summary" role="alert" ref={errorRef} tabIndex={-1}>
            <strong>{error.title}</strong>
            <span>{error.detail}</span>
          </div>
        ) : null}

        <div className="scan-controls">
          <div className="field upload-field">
            <label htmlFor="stock-list">Upload stock list</label>
            <input
              id="stock-list"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) {
                  void parseFile(file);
                }
              }}
            />
            <p className="field-hint">Uploading another file replaces this list.</p>
            {fileName ? <p className="selected-file">{fileName}</p> : null}
          </div>

          <div className="field timeframe-field">
            <label htmlFor="timeframe">Candle timeframe</label>
            <select
              id="timeframe"
              value={timeframe}
              disabled={isBusy}
              onChange={(event) => {
                cancelActiveRequest();
                setTimeframe(event.currentTarget.value as Timeframe);
                setResults([]);
                resetProjection();
                setError(undefined);
                setPhase(instruments.length > 0 ? "ready" : "empty");
              }}
            >
              {TIMEFRAMES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <button
            className="primary-action"
            type="button"
            disabled={instruments.length === 0 || isBusy}
            onClick={() => void runCurrentScan()}
          >
            {phase === "scanning" ? "Scanning…" : "Scan for BUY signals"}
          </button>
          {phase === "scanning" ? (
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                cancelActiveRequest();
                setPhase("ready");
              }}
            >
              Cancel scan
            </button>
          ) : null}
        </div>

        <div className="summary-area" aria-live="polite">
          {phase === "parsing" ? <p className="progress-copy">Checking the stock list…</p> : null}
          {parseResult ? (
            <div className="validation-summary" role="status" aria-label="Stock list summary">
              <p>
                <strong>{plural(parseResult.instruments.length, "valid instrument")}</strong>
                <span aria-hidden="true"> · </span>
                {plural(parseResult.rejected.length, "rejected row")}
                <span aria-hidden="true"> · </span>
                {plural(parseResult.duplicateCount, "duplicate removed", "duplicates removed")}
              </p>
              {parseResult.rejected.length > 0 ? (
                <details>
                  <summary>Review rejected rows</summary>
                  <ul>
                    {parseResult.rejected.map((rejected) => (
                      <li key={`${rejected.row}-${rejected.symbol ?? "blank"}`}>
                        Row {rejected.row}
                        {rejected.symbol ? ` (${rejected.symbol})` : ""}: {rejected.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
          {phase === "scanning" ? (
            <p className="progress-copy">Scanning {plural(instruments.length, "instrument")}…</p>
          ) : null}
          {(phase === "complete" || phase === "exporting") && results.length > 0 ? (
            <p className="progress-copy">
              Scan complete: {plural(buyCount, "BUY signal")} across {plural(results.length, "result")}.
            </p>
          ) : null}
        </div>

      </section>

      <section className="results-area" aria-labelledby="results-heading">
        <div className="results-heading-row">
          <h2 id="results-heading">Scan results</h2>
          <label>
            Show
            <select
              value={resultFilter}
              onChange={(event) => {
                setResultFilter(event.currentTarget.value as ResultFilter);
                resetProjection();
              }}
            >
              <option value="ALL">All results</option>
              <option value="BUY">BUY only</option>
              <option value="NO_SIGNAL">No signal</option>
              <option value="DATA_ISSUE">Data issues</option>
            </select>
          </label>
          <button
            className="secondary-action"
            type="button"
            disabled={projection.filtered.length === 0 || isBusy}
            onClick={() => void exportRows(projection.filtered, "scan-results-filtered.csv")}
          >
            Export filtered ({projection.filtered.length})
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={projection.selected.length === 0 || isBusy}
            onClick={() => void exportRows(projection.selected, "scan-results-selected.csv")}
          >
            Export selected ({projection.selected.length})
          </button>
        </div>
        {results.length > 0 ? (
          <>
            <p className="execution-caveat">
              Entry reference is the completed signal candle close. Actual execution is the next
              obtainable price; skip a gap that reduces reward/risk below your minimum. Each scan
              evaluates only the latest completed candle, so a BUY from an earlier scan naturally
              disappears when that symbol no longer qualifies on the newer candle. Confirmation
              diagnostics are informational and never suppress a core rules BUY. For weekly and
              monthly scans, compare the chart with the completed signal candle shown in Details;
              TradingView's currently forming week/month is intentionally excluded.
            </p>
            {categoryResults.length > 0 ? (
              <ScanResults results={categoryResults} onProjectionChange={setProjection} />
            ) : (
              <p className="empty-state">No results match this filter.</p>
            )}
          </>
        ) : phase === "parsing" || phase === "scanning" ? null : (
          <p className="empty-state">
            {parseResult && instruments.length > 0
              ? `Ready to scan ${plural(instruments.length, "instrument")}.`
              : "Upload a stock list to begin."}
          </p>
        )}
      </section>

      <fieldset className="mode-control">
        <legend>Recommendation mode</legend>
        <label>
          <input type="radio" name="mode" defaultChecked />
          Rules BUY
        </label>
        <label>
          <input type="radio" name="mode" disabled aria-describedby="model-mode-explanation" />
          Validated Model BUY
        </label>
        <p id="model-mode-explanation">
          Validated Model BUY becomes available only after an out-of-sample model passes its
          acceptance checks.
        </p>
      </fieldset>

      <p className="disclaimer">
        Quantitative research output, not a guarantee or personalized investment advice.
      </p>
    </div>
  );
}
