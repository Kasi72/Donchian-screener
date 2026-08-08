"use client";

import { useEffect, useRef, useState } from "react";

import { ScanResults } from "@/components/scan-results";
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

interface RequestError {
  title: string;
  detail: string;
}

const TIMEFRAMES: Array<{ value: Timeframe; label: string }> = [
  { value: "5m", label: "5 minutes" },
  { value: "15m", label: "15 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "1d", label: "1 day" },
  { value: "1wk", label: "1 week" },
  { value: "1mo", label: "1 month" },
];

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
  const [error, setError] = useState<RequestError>();
  const errorRef = useRef<HTMLDivElement>(null);

  const instruments = parseResult?.instruments ?? [];
  const isBusy = phase === "parsing" || phase === "scanning" || phase === "exporting";

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  async function parseFile(file: File): Promise<void> {
    setFileName(file.name);
    setParseResult(undefined);
    setResults([]);
    setError(undefined);
    setPhase("parsing");

    const formData = new FormData();
    formData.set("file", file);

    try {
      const response = await fetch("/api/universe/parse", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await readError(response, "The file could not be parsed."));
      }

      const parsed = (await response.json()) as UniverseParseResult;
      if (!Array.isArray(parsed.instruments) || !Array.isArray(parsed.rejected)) {
        throw new Error("The server returned an invalid stock list summary.");
      }

      setParseResult(parsed);
      setPhase(parsed.instruments.length > 0 ? "ready" : "empty");
    } catch (cause) {
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

    setError(undefined);
    setResults([]);
    setPhase("scanning");

    try {
      const response = await fetch("/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruments, timeframe }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "The scan could not be completed."));
      }

      const body = (await response.json()) as { results?: unknown };
      if (!Array.isArray(body.results)) {
        throw new Error("The server returned invalid scan results.");
      }
      setResults(body.results as ScanItemResult[]);
      setPhase("complete");
    } catch (cause) {
      setError({
        title: "We couldn't complete this scan.",
        detail: cause instanceof Error ? cause.message : "Try the scan again.",
      });
      setPhase("ready");
    }
  }

  async function exportVisibleResults(): Promise<void> {
    if (results.length === 0) {
      return;
    }

    setError(undefined);
    setPhase("exporting");

    try {
      const response = await fetch("/api/scans/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ results }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "The results could not be exported."));
      }

      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = "scan-results.csv";
      link.click();
      URL.revokeObjectURL(blobUrl);
      setPhase("complete");
    } catch (cause) {
      setError({
        title: "We couldn't export these results.",
        detail: cause instanceof Error ? cause.message : "Try exporting again.",
      });
      setPhase("complete");
    }
  }

  const buyCount = results.filter(({ status }) => status === "BUY").length;

  return (
    <>
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
              disabled={isBusy}
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
              onChange={(event) => setTimeframe(event.currentTarget.value as Timeframe)}
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
      </section>

      <section className="results-area" aria-labelledby="results-heading">
        <div className="results-heading-row">
          <h2 id="results-heading">Scan results</h2>
          <button
            className="secondary-action"
            type="button"
            disabled={results.length === 0 || isBusy}
            onClick={() => void exportVisibleResults()}
          >
            {phase === "exporting" ? "Exporting…" : "Export results"}
          </button>
        </div>
        {results.length > 0 ? (
          <ScanResults results={results} />
        ) : (
          <p className="empty-state">
            {parseResult && instruments.length > 0
              ? `Ready to scan ${plural(instruments.length, "instrument")}.`
              : "Upload a stock list to begin."}
          </p>
        )}
      </section>

      <p className="disclaimer">
        Quantitative research output, not a guarantee or personalized investment advice.
      </p>
    </>
  );
}
