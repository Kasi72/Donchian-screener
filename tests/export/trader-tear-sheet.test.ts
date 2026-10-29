import { describe, expect, it } from "vitest";
import { buildTearSheetHtml, buildTearSheetSections, buildWhatsAppSummary } from "@/lib/export/trader-tear-sheet";
import type { BuyRecommendation } from "@/lib/signals/scan-symbol";

const recommendation: BuyRecommendation = {
  recommendation: "BUY",
  symbol: "POWER<GRID>",
  yahooSymbol: "POWERGRID.NS",
  timeframe: "1d",
  signalTime: Date.UTC(2026, 7, 15),
  autoPeriod: 130,
  probability: null,
  entry: 273.4,
  stop: 267.8,
  target1: 281.8,
  target2: 290.2,
  currentLdc: 271.6,
  previousLdc: 268,
  signalLow: 271.6,
  signalClose: 273,
  anchorTime: Date.UTC(2026, 5, 1),
  strategyVersion: "rules-v1",
  dataAsOf: Date.UTC(2026, 7, 15),
  adjustmentMode: "RAW",
  tickSize: 0.05,
  tickPolicy: "nse-cm-legacy-0.05-v1",
  reactionHigh: 290,
  rewardRisk: 2,
  scoreVersion: "structural-v1",
  score: 0.8,
  scoreComponents: { prominence: 0.5, recovery: 0.5, recency: 0.5, retests: 0.5, relativeVolume: 0.5, higherTimeframeAgreement: 0 },
  higherTimeframeInput: "NEUTRAL_UNAVAILABLE",
  anchorRationale: "Confirmed pivot selected causally.",
};

describe("trader tear sheet export", () => {
  it("contains the trader-facing sections in a stable order", () => {
    expect(buildTearSheetSections(recommendation).map((section) => section.title)).toEqual([
      "Decision",
      "Trade plan",
      "Donchian validation",
      "Confirmation evidence",
      "Data and audit trail",
    ]);
  });

  it("escapes user data and explains unavailable calibration", () => {
    const html = buildTearSheetHtml(recommendation);
    expect(html).toContain("POWER&lt;GRID&gt;");
    expect(html).not.toContain("POWER<GRID>");
    expect(html).toContain("Not calibrated - evidence score only");
    expect(html).toContain("Uncalibrated evidence must not be interpreted as a win probability");
  });

  it("includes precise trade metrics in the WhatsApp-ready summary", () => {
    const summary = buildWhatsAppSummary({ ...recommendation, riskPerShare: 5.6, riskPercent: 2.05 });
    expect(summary).toContain("Entry: ₹273.40");
    expect(summary).toContain("Stop: ₹267.80");
    expect(summary).toContain("risk ₹5.60 / 2.05%");
    expect(summary).toContain("Target 1: ₹281.80 (1.50R)");
  });
});
