// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ScanResults } from "@/components/scan-results";
import type { ScanItemResult } from "@/lib/signals/scan-symbol";

const RESULTS: ScanItemResult[] = [
  {
    symbol: "RELIANCE",
    status: "BUY",
    recommendation: {
      recommendation: "BUY",
      symbol: "RELIANCE",
      yahooSymbol: "RELIANCE.NS",
      timeframe: "1d",
      signalTime: Date.UTC(2026, 7, 7, 10),
      autoPeriod: 51,
      probability: null,
      entry: 1400.05,
      stop: 1375.1,
      target1: 1425,
      target2: 1449.95,
      currentLdc: 1384.5,
      previousLdc: 1378.2,
      anchorTime: Date.UTC(2026, 6, 28, 10),
      strategyVersion: "rules-v1",
      dataAsOf: Date.UTC(2026, 7, 7, 10, 5),
    },
  },
  { symbol: "TCS", status: "NO_SIGNAL" },
  { symbol: "INFY", status: "INSUFFICIENT_HISTORY" },
  { symbol: "SBIN", status: "PROVIDER_RATE_LIMITED" },
  {
    symbol: "BROKEN",
    status: "PROVIDER_ERROR",
    message: "Market data provider failed for BROKEN.",
  },
];

describe("ScanResults", () => {
  afterEach(cleanup);

  it("keeps BUY, NO_SIGNAL, and data failures visible in one results table", () => {
    render(<ScanResults results={RESULTS} />);

    const table = screen.getByRole("table", { name: "Scan results" });
    expect(table).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(RESULTS.length + 1);
    expect(screen.getByText("₹1,400.05")).toBeInTheDocument();
    expect(screen.getByText("₹1,375.10")).toBeInTheDocument();
    expect(screen.getByText("₹1,425.00")).toBeInTheDocument();
    expect(screen.getByText("₹1,449.95")).toBeInTheDocument();
    expect(screen.getByText("51")).toBeInTheDocument();
    expect(screen.getByText("No completed-candle BUY signal")).toBeInTheDocument();
    expect(screen.getByText("Not enough completed candles")).toBeInTheDocument();
    expect(screen.getByText("Market data temporarily rate-limited")).toBeInTheDocument();
    expect(screen.getByText("Market data provider failed for BROKEN.")).toBeInTheDocument();
  });

  it("opens calculation details as a labelled disclosure tied to the BUY row", async () => {
    const user = userEvent.setup();
    render(<ScanResults results={RESULTS} />);

    const trigger = screen.getByRole("button", {
      name: "Show calculation details for RELIANCE",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const details = screen.getByRole("region", {
      name: "Calculation details for RELIANCE",
    });
    expect(details).toHaveTextContent("Current Donchian low₹1,384.50");
    expect(details).toHaveTextContent("Previous Donchian low₹1,378.20");
    expect(details).toHaveTextContent("Strategy versionrules-v1");
    expect(details).toHaveTextContent("Yahoo symbolRELIANCE.NS");
  });
});
