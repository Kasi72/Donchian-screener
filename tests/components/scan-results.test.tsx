// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ScanResults } from "@/components/scan-results";
import type { ScanItemResult } from "@/lib/signals/scan-symbol";

const stylesheet = document.createElement("style");
stylesheet.textContent = readFileSync("app/globals.css", "utf8");
document.head.append(stylesheet);

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
      adjustmentMode: "BACK_ADJUSTED",
      tickSize: 0.05,
      tickPolicy: "nse-cm-legacy-0.05-v1",
      reactionHigh: 1450,
      rewardRisk: 2,
      scoreVersion: "structural-v1",
      score: 0.5705,
      scoreComponents: { prominence: 0.5, recovery: 0.5, recency: 0.5, retests: 0.5, relativeVolume: 0.5, higherTimeframeAgreement: 0 },
      higherTimeframeInput: "NEUTRAL_UNAVAILABLE",
      anchorRationale: "Confirmed structural pivot selected causally.",
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

  it("keeps the details action at least 44 CSS pixels tall", () => {
    const targetRule = Array.from(stylesheet.sheet?.cssRules ?? []).find(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule &&
        rule.selectorText === ".details-button" &&
        rule.style.minHeight.length > 0,
    );

    expect(targetRule).toBeDefined();
    expect(Number.parseFloat(targetRule?.style.minHeight ?? "0")).toBeGreaterThanOrEqual(44);
  });

  it("keeps BUY, NO_SIGNAL, and data failures visible in one results table", () => {
    render(<ScanResults results={RESULTS} />);

    const table = screen.getByRole("table", { name: "Scan results" });
    expect(table).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Scrollable scan results" })).toContainElement(table);
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

  it("exposes sortable headers and filters for both signal diagnostics", () => {
    render(<ScanResults results={RESULTS} />);

    expect(screen.getByRole("button", { name: "Sort by Signal state" })).toHaveClass("sort-button--wrap");
    expect(screen.getByRole("button", { name: "Sort by Reversal confirmation" })).toHaveClass("sort-button--wrap");
    expect(screen.getByLabelText("Signal state filter")).toBeInTheDocument();
    expect(screen.getByLabelText("Reversal confirmation filter")).toBeInTheDocument();
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
    expect(details).toHaveTextContent("Price adjustmentBACK_ADJUSTED");
    expect(details).toHaveTextContent("Planned reward/risk2.00");
    expect(details).toHaveTextContent("Anchor rationaleConfirmed structural pivot selected causally.");
  });

  it("colors candidate and confirmed signal states distinctly", async () => {
    const user = userEvent.setup();
    const recommendation = RESULTS[0].recommendation!;
    render(
      <ScanResults
        results={[{
          ...RESULTS[0],
          recommendation: {
            ...recommendation,
            signalState: "EARLIEST_CANDIDATE",
            sequentialEvidence: {
              version: "sequential-v1",
              cusumScore: 0.4,
              changePointProbability: 0.4,
              trendProbability: 0.4,
              candleQuality: 0.4,
              reversalScore: 0.4,
              calibration: "UNCALIBRATED",
              calibratedProbability: null,
              state: "EARLIEST_CANDIDATE",
              sampleSize: 30,
              sgSlope: 0.002,
              sgCurvature: 0.0004,
              volatilityZ: 1.2,
              overlayScore: 0.78,
            },
            confirmation: {
              version: "confirmation-v1",
              score: 66.05,
              grade: "CONFIRMED",
              closeLocation: 0.7,
              lowerWickRatio: 0.6,
              atrRecovery: 1,
              volumeZScore: null,
              changePointScore: 0.7,
              validPeriodCount: 2,
              validPeriodRange: [40, 41],
              higherTimeframe: "UNAVAILABLE",
              relativeStrength: "UNAVAILABLE",
              reasons: [],
            },
          },
        }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Show calculation details for RELIANCE" }));
    expect(screen.getByText("EARLIEST_CANDIDATE", { selector: "dd" })).toHaveClass("signal-state--candidate");
    expect(screen.getByText("CONFIRMED (66.05/100)", { selector: "dd" })).toHaveClass("confirmation-grade--confirmed");
    expect(screen.getByText("0.78/1.00", { selector: "dd" })).toBeInTheDocument();

    cleanup();
    render(
      <ScanResults
        results={[{
          ...RESULTS[0],
          recommendation: {
            ...recommendation,
            signalState: "CONFIRMED_REVERSAL",
            sequentialEvidence: {
              version: "sequential-v1",
              cusumScore: 0.9,
              changePointProbability: 0.9,
              trendProbability: 0.9,
              candleQuality: 0.9,
              reversalScore: 0.9,
              calibration: "UNCALIBRATED",
              calibratedProbability: null,
              state: "CONFIRMED_REVERSAL",
              sampleSize: 30,
            },
            confirmation: {
              version: "confirmation-v1",
              score: 88,
              grade: "STRONG",
              closeLocation: 0.9,
              lowerWickRatio: 0.9,
              atrRecovery: 2,
              volumeZScore: 2,
              changePointScore: 0.9,
              validPeriodCount: 4,
              validPeriodRange: [39, 42],
              higherTimeframe: "UNAVAILABLE",
              relativeStrength: "UNAVAILABLE",
              reasons: [],
            },
          },
        }]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Show calculation details for RELIANCE" }));
    expect(screen.getByText("CONFIRMED_REVERSAL", { selector: "dd" })).toHaveClass("signal-state--confirmed");
    expect(screen.getByText("STRONG (88.00/100)", { selector: "dd" })).toHaveClass("confirmation-grade--strong");
  });

  it("sorts a column in ascending then descending order", async () => {
    const user = userEvent.setup();
    render(<ScanResults results={RESULTS} />);

    const sortButton = screen.getByRole("button", { name: "Sort by Instrument" });
    await user.click(sortButton);

    expect(sortButton.closest("th")).toHaveAttribute("aria-sort", "ascending");
    expect(document.querySelector("tbody > tr")?.textContent).toContain("BROKEN");

    await user.click(sortButton);

    expect(sortButton.closest("th")).toHaveAttribute("aria-sort", "descending");
    expect(document.querySelector("tbody > tr")?.textContent).toContain("TCS");
  });

  it("filters by instrument, status, numeric value, and date before clearing filters", async () => {
    const user = userEvent.setup();
    render(<ScanResults results={RESULTS} />);

    await user.type(screen.getByLabelText("Instrument filter"), "reli");
    expect(screen.getByText("1 result visible")).toBeInTheDocument();
    expect(screen.getByText("RELIANCE")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Instrument filter"));
    await user.type(screen.getByLabelText("Status filter"), "rate limited");
    expect(screen.getByText("SBIN")).toBeInTheDocument();
    expect(screen.getByText("1 result visible")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Status filter"));
    await user.type(screen.getByLabelText("Minimum Entry"), "1400");
    expect(screen.getByText("RELIANCE")).toBeInTheDocument();
    expect(screen.getByText("1 result visible")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Minimum Entry"));
    await user.type(screen.getByLabelText("Data as of from"), "2026-08-08");
    expect(screen.getByText("No results match these table filters", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear table filters" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Clear table filters" }));
    expect(screen.getByText("5 results visible")).toBeInTheDocument();
  });

  it("selects visible rows, preserves hidden selections, and reports selections in input order", async () => {
    const user = userEvent.setup();
    const reports: Array<{ filtered: ScanItemResult[]; selected: ScanItemResult[] }> = [];
    render(<ScanResults results={RESULTS} onProjectionChange={(projection) => reports.push(projection)} />);

    await user.click(screen.getByRole("checkbox", { name: "Select RELIANCE" }));
    await user.click(screen.getByRole("checkbox", { name: "Select TCS" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(reports.at(-1)?.selected.map(({ symbol }) => symbol)).toEqual(["RELIANCE", "TCS"]);

    await user.type(screen.getByLabelText("Instrument filter"), "TCS");
    expect(screen.getByText("1 result visible")).toBeInTheDocument();
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByText("0 selected")).toBeInTheDocument();
    expect(reports.at(-1)?.selected).toEqual([]);
  });

  it("clears selection when a replacement result set reuses an existing row ID", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ScanResults results={RESULTS} />);

    await user.click(screen.getByRole("checkbox", { name: "Select RELIANCE" }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    rerender(<ScanResults results={RESULTS.map((result) => ({ ...result }))} />);

    expect(screen.getByText("0 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select RELIANCE" })).not.toBeChecked();
  });

  it("retains selection when a fresh array contains the same result objects", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ScanResults results={RESULTS} />);

    await user.click(screen.getByRole("checkbox", { name: "Select RELIANCE" }));
    rerender(<ScanResults results={[...RESULTS]} />);

    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select RELIANCE" })).toBeChecked();
  });

  it("selects all visible rows and exposes an indeterminate header checkbox", async () => {
    const user = userEvent.setup();
    render(<ScanResults results={RESULTS} />);

    const allVisible = screen.getByRole("checkbox", { name: "Select all visible results" });
    await user.click(allVisible);
    expect(screen.getByText("5 selected")).toBeInTheDocument();
    expect(allVisible).toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: "Select RELIANCE" }));
    expect(screen.getByText("4 selected")).toBeInTheDocument();
    expect(allVisible).not.toBeChecked();
    expect((allVisible as HTMLInputElement).indeterminate).toBe(true);
  });

  it("keeps calculation details associated with the correct row after sorting", async () => {
    const user = userEvent.setup();
    render(<ScanResults results={RESULTS} />);

    await user.click(screen.getByRole("button", { name: "Sort by Instrument" }));
    await user.click(screen.getByRole("button", { name: "Show calculation details for RELIANCE" }));

    expect(screen.getByRole("region", { name: "Calculation details for RELIANCE" })).toBeInTheDocument();
  });
});
