"use client";

import { Fragment, useState, type ReactNode } from "react";

import type { BuyRecommendation } from "@/lib/signals/scan-symbol";
import { exportTraderTearSheet, type TearSheetFormat } from "@/lib/export/trader-tear-sheet";

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

function formatPrice(value: number): string {
  return priceFormatter.format(value);
}

type DetailField = [label: string, value: string, className?: string];

function DetailGrid({ fields }: { fields: DetailField[] }) {
  return (
    <dl className="details-grid">
      {fields.map(([label, value, className]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className={className}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DetailSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="details-section">
      <div className="details-section-heading">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {children}
    </section>
  );
}

function stateClass(state: string): string | undefined {
  if (state === "EARLIEST_CANDIDATE") return "signal-state--candidate";
  if (state === "CONFIRMED_REVERSAL" || state === "EVIDENCE_SUPPORTED") return "signal-state--confirmed";
  return undefined;
}

function gradeClass(grade: string): string | undefined {
  if (grade === "STRONG") return "confirmation-grade--strong";
  if (grade === "CONFIRMED") return "confirmation-grade--confirmed";
  if (grade === "CORE_ONLY") return "confirmation-grade--core";
  return undefined;
}

export function SignalDetails({
  id,
  recommendation,
}: {
  id: string;
  recommendation: BuyRecommendation;
}) {
  const [exportFormat, setExportFormat] = useState<TearSheetFormat>("pdf");
  const [exportError, setExportError] = useState<string | null>(null);
  const confirmation = recommendation.confirmation;
  const sequential = recommendation.sequentialEvidence;
  const diagnostics = recommendation.tradeDiagnostics;
  const signalState = recommendation.signalState ?? sequential?.state ?? "EARLIEST_CANDIDATE";
  const channelRollover = recommendation.currentLdcTick !== undefined && recommendation.previousLdcTick !== undefined
    ? recommendation.currentLdcTick > recommendation.previousLdcTick
    : recommendation.currentLdc > recommendation.previousLdc;
  const gateText = channelRollover
    ? "PASS — signal low touches the current LDC and the LDC has risen"
    : "FAIL — the channel is flat/falling; a touch alone is not a BUY";
  const calibratedText = diagnostics?.reversalProbability === null || diagnostics === undefined
    ? "Not calibrated — evidence score only"
    : `${(diagnostics.reversalProbability * 100).toFixed(1)}% (walk-forward model)`;

  const decisionFields: DetailField[] = [
    ["Confirmation meaning", "Scores describe evidence at the signal close. Subsequent price follow-through has not been evaluated."],
    ["Signal state", signalState, stateClass(signalState)],
    [
      "Reversal confirmation",
      confirmation ? `${confirmation.grade} (${confirmation.score.toFixed(2)}/100)` : "Unavailable",
      confirmation ? gradeClass(confirmation.grade) : undefined,
    ],
    [
      "Reversal probability",
      calibratedText,
    ],
    [
      "95% confidence interval",
      diagnostics?.reversalConfidenceInterval
        ? `${(diagnostics.reversalConfidenceInterval[0] * 100).toFixed(1)}%–${(diagnostics.reversalConfidenceInterval[1] * 100).toFixed(1)}%`
        : "Unavailable until calibrated",
    ],
    [
      "Target 1 before stop",
      diagnostics?.target1BeforeStopProbability === null || diagnostics === undefined
        ? "Unavailable until outcome calibration"
        : `${(diagnostics.target1BeforeStopProbability * 100).toFixed(1)}%`,
    ],
    [
      "Evidence quality score",
      diagnostics ? `${diagnostics.evidenceQualityScore.toFixed(1)}/100` : "Unavailable",
    ],
    [
      "Trade quality score",
      diagnostics?.tradeQualityScore === null || diagnostics === undefined
        ? "Unavailable until outcome calibration"
        : `${diagnostics.tradeQualityScore.toFixed(1)}/100`,
    ],
    ...(sequential ? [["Trader read", sequential.traderSummary ?? "Evidence is informational; follow-through is not confirmed."]] as DetailField[] : []),
  ];

  const tradeFields: DetailField[] = [
    ["Entry reference", formatPrice(recommendation.entry)],
    ["Protective stop", formatPrice(recommendation.stop)],
    ["Target 1", formatPrice(recommendation.target1)],
    ["Target 2", formatPrice(recommendation.target2)],
    ["Target 1 reward/risk", ((recommendation.target1 - recommendation.entry) / (recommendation.entry - recommendation.stop)).toFixed(2)],
    ["Target 2 reward/risk", ((recommendation.target2 - recommendation.entry) / (recommendation.entry - recommendation.stop)).toFixed(2)],
    ["Room to reaction high (R)", recommendation.rewardRisk.toFixed(2)],
    ["Execution", "Next obtainable price; recalculate risk and reward after gaps. Reference prices are not guaranteed fills."],
    ["Reaction high", formatPrice(recommendation.reactionHigh)],
    ["Maximum holding period", diagnostics ? `${diagnostics.maximumHoldingCandles} candles` : "Unavailable"],
  ];

  const donchianFields: DetailField[] = [
    ["Current Donchian low", formatPrice(recommendation.currentLdc)],
    ["Previous Donchian low", formatPrice(recommendation.previousLdc)],
    ["Signal candle low", recommendation.signalLow === undefined ? "Unavailable" : formatPrice(recommendation.signalLow)],
    ["Signal candle close", recommendation.signalClose === undefined ? "Unavailable" : formatPrice(recommendation.signalClose)],
    ["Reversal gate", gateText],
    ["Auto period", String(recommendation.autoPeriod)],
    ...(recommendation.periodStability
      ? [["Period audit meaning", "Only one period can pass exact touch plus rising LDC. Neighbour counts do not measure confidence."]] as DetailField[]
      : []),
    ...(recommendation.periodAudit
      ? [["Nearby-period audit (N±2)", recommendation.periodAudit.map(({ period, touchPassed, rolloverPassed, valid }) => `${period}:${valid ? "VALID" : `${touchPassed ? "touch" : "no-touch"}/${rolloverPassed ? "rollover" : "no-rollover"}`}`).join(" | ")]] as DetailField[]
      : []),
  ];

  const evidenceFields: DetailField[] = confirmation && sequential
    ? [
        ["Close location", `${(confirmation.closeLocation * 100).toFixed(1)}%`],
        ["Lower-wick rejection", `${(confirmation.lowerWickRatio * 100).toFixed(1)}%`],
        ["ATR recovery", `${confirmation.atrRecovery.toFixed(2)} ATR`],
        ["Volume surprise", confirmation.volumeZScore === null ? "Unavailable" : `${confirmation.volumeZScore.toFixed(2)} z-score`],
        ["Robust regime-shift evidence", `${(sequential.changePointProbability * 100).toFixed(1)}%`],
        ["CUSUM evidence", `${(sequential.cusumScore * 100).toFixed(1)}%`],
        ["Causal SG slope", sequential.sgSlope === undefined ? "Unavailable" : sequential.sgSlope.toFixed(6)],
        ["Causal SG curvature", sequential.sgCurvature === undefined ? "Unavailable" : sequential.sgCurvature.toFixed(6)],
        ["Robust volatility z-score", sequential.volatilityZ === undefined ? "Unavailable" : sequential.volatilityZ.toFixed(2)],
        ["Overlay evidence score", sequential.overlayScore === undefined ? "Unavailable" : `${sequential.overlayScore.toFixed(2)}/1.00`],
        ["Trend state", sequential.trendState ?? "Unavailable"],
        ["Trend persistence", sequential.trendPersistenceScore === undefined ? "Unavailable" : `${(sequential.trendPersistenceScore * 100).toFixed(1)}%`],
        ["Qualifying period audit", `${confirmation.validPeriodRange[0]}–${confirmation.validPeriodRange[1]} (${confirmation.validPeriodCount} valid)`],
        ["Confirmation reasons", confirmation.reasons.join("; ")],
      ]
    : [];

  const integrityFields: DetailField[] = [
    ["Signal candle", dateFormatter.format(recommendation.signalTime)],
    ["Confirmed pivot anchor", dateFormatter.format(recommendation.anchorTime)],
    ["Candle timeframe", recommendation.timeframe],
    ["Data as of", dateFormatter.format(recommendation.dataAsOf)],
    ["Price adjustment", recommendation.adjustmentMode],
    ["Yahoo symbol", recommendation.yahooSymbol],
    ["Tick size / policy", `${recommendation.tickSize} / ${recommendation.tickPolicy}`],
    ["Daily window integrity", recommendation.windowAudit
      ? recommendation.windowAudit.complete
        ? `${recommendation.windowAudit.observedSessions}/${recommendation.windowAudit.expectedSessions} NSE sessions present`
        : `${recommendation.windowAudit.missingSessions} NSE sessions missing`
      : "Not applicable"],
    ["Structural score", `${recommendation.score.toFixed(4)} (${recommendation.scoreVersion})`],
    ["Anchor rationale", recommendation.anchorRationale],
    ["Strategy version", sequential ? `${recommendation.strategyVersion} / evidence ${sequential.version}` : recommendation.strategyVersion],
    ["Higher timeframe", "Neutral — input unavailable"],
    ["Market regime", diagnostics?.marketRegime ?? "Unavailable"],
    ["Data quality", diagnostics?.dataQuality ?? "Unavailable"],
    ["Calibration", diagnostics?.calibration ?? "Unavailable"],
    ["Comparable historical signals", diagnostics?.comparableSignals === null || diagnostics === undefined ? "Unavailable — calibration dataset not loaded" : String(diagnostics.comparableSignals)],
    ["Median MAE / MFE", diagnostics?.medianMae === null || diagnostics?.medianMfe === null || diagnostics === undefined ? "Unavailable — requires historical outcomes" : `${formatPrice(diagnostics.medianMae)} / ${formatPrice(diagnostics.medianMfe)}`],
  ];

  return (
    <tr className="details-row">
      <td colSpan={12}>
        <section id={id} role="region" aria-label={`Calculation details for ${recommendation.symbol}`} className="details-region">
          <header className="details-hero">
            <div>
              <p className="details-eyebrow">Trader decision summary</p>
              <h2>{recommendation.symbol} reversal setup</h2>
              <p>Core Donchian rules pass. Use the confirmation and risk sections below to decide whether the setup is actionable.</p>
            </div>
            <div className="details-hero-badges" aria-label="Signal summary">
              <span className="details-badge details-badge--buy">BUY</span>
              <span className={`details-badge ${stateClass(signalState) ?? ""}`}>{signalState}</span>
              <span className={`details-badge ${confirmation ? gradeClass(confirmation.grade) ?? "" : ""}`}>{confirmation?.grade ?? "UNAVAILABLE"}</span>
            </div>
            <div className="details-export" aria-label="Export trader decision summary">
              <label htmlFor={`${id}-export-format`}>Export tear sheet</label>
              <div className="details-export-controls">
                <select
                  id={`${id}-export-format`}
                  value={exportFormat}
                  onChange={(event) => setExportFormat(event.target.value as TearSheetFormat)}
                >
                  <option value="pdf">PDF (print / save)</option>
                  <option value="word">Word (.doc)</option>
                </select>
                <button
                  type="button"
                  className="details-export-button"
                  onClick={() => {
                    setExportError(null);
                    try {
                      exportTraderTearSheet(recommendation, exportFormat);
                    } catch (error) {
                      setExportError(error instanceof Error ? error.message : "The tear sheet could not be exported.");
                    }
                  }}
                >
                  Export
                </button>
              </div>
              {exportError ? <p className="details-export-error" role="alert">{exportError}</p> : null}
            </div>
          </header>
          <DetailSection title="Decision" description="The plain-language answer and confidence status.">
            <DetailGrid fields={decisionFields} />
          </DetailSection>
          <DetailSection title="Trade plan" description="Prices and risk levels derived from the completed signal candle.">
            <DetailGrid fields={tradeFields} />
          </DetailSection>
          <DetailSection title="Donchian validation" description="The original reversal rule remains the non-negotiable BUY gate.">
            <DetailGrid fields={donchianFields} />
          </DetailSection>
          {evidenceFields.length > 0 ? (
            <DetailSection title="Confirmation evidence" description="Secondary evidence can strengthen or weaken conviction, but never overrides the Donchian gate.">
              <DetailGrid fields={evidenceFields} />
            </DetailSection>
          ) : null}
          <DetailSection title="Data and calculation integrity" description="Provenance, completeness, and model metadata for auditability.">
            <DetailGrid fields={integrityFields} />
          </DetailSection>
        </section>
      </td>
    </tr>
  );
}

SignalDetails.RowGroup = function RowGroup({ children }: { children: ReactNode }) {
  return <Fragment>{children}</Fragment>;
};
