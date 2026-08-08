"use client";

import { useState } from "react";

import { SignalDetails } from "@/components/signal-details";
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

function formatPrice(value: number | undefined): string {
  return value === undefined ? "—" : priceFormatter.format(value);
}

function statusText(result: ScanItemResult): string {
  return result.message ?? STATUS_LABELS[result.status];
}

export function ScanResults({ results }: { results: ScanItemResult[] }) {
  const [selectedSymbol, setSelectedSymbol] = useState<string>();

  return (
    <div className="table-scroll" role="region" tabIndex={0} aria-label="Scrollable scan results">
      <table aria-label="Scan results">
        <thead>
          <tr>
            <th scope="col">Instrument</th>
            <th scope="col">Status</th>
            <th scope="col" className="number-cell">Entry</th>
            <th scope="col" className="number-cell">Stop</th>
            <th scope="col" className="number-cell">Target 1</th>
            <th scope="col" className="number-cell">Target 2</th>
            <th scope="col" className="number-cell">Auto period</th>
            <th scope="col">Data as of</th>
            <th scope="col" aria-label="Calculation details" />
          </tr>
        </thead>
        <tbody>
          {results.map((result, index) => {
            const recommendation = result.recommendation;
            const rowKey = `${result.symbol}-${index}`;
            const detailsId = `details-${index}`;
            const triggerId = `details-trigger-${index}`;
            const isSelected = selectedSymbol === rowKey;

            return (
              <SignalDetails.RowGroup key={rowKey}>
                <tr className={result.status === "BUY" ? "buy-row" : undefined}>
                  <th scope="row">{result.symbol}</th>
                  <td className={result.status === "BUY" ? "buy-status" : "status-copy"}>
                    {statusText(result)}
                  </td>
                  <td className="number-cell">{formatPrice(recommendation?.entry)}</td>
                  <td className="number-cell">{formatPrice(recommendation?.stop)}</td>
                  <td className="number-cell">{formatPrice(recommendation?.target1)}</td>
                  <td className="number-cell">{formatPrice(recommendation?.target2)}</td>
                  <td className="number-cell">{recommendation?.autoPeriod ?? "—"}</td>
                  <td>
                    {recommendation ? (
                      <time dateTime={new Date(recommendation.dataAsOf).toISOString()}>
                        {dateFormatter.format(recommendation.dataAsOf)}
                      </time>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {recommendation ? (
                      <button
                        id={triggerId}
                        className="details-button"
                        type="button"
                        aria-expanded={isSelected}
                        aria-controls={detailsId}
                        aria-label={`${isSelected ? "Hide" : "Show"} calculation details for ${result.symbol}`}
                        onClick={() => setSelectedSymbol(isSelected ? undefined : rowKey)}
                      >
                        {isSelected ? "Hide" : "Details"}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
                {recommendation && isSelected ? (
                  <SignalDetails
                    id={detailsId}
                    recommendation={recommendation}
                  />
                ) : null}
              </SignalDetails.RowGroup>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
