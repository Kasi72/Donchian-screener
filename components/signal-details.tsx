import { Fragment, type ReactNode } from "react";

import type { BuyRecommendation } from "@/lib/signals/scan-symbol";

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
  if (state === "CONFIRMED_REVERSAL") return "signal-state--confirmed";
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
  const confirmation = recommendation.confirmation;
  const sequential = recommendation.sequentialEvidence;
  const signalState = recommendation.signalState ?? sequential?.state ?? "EARLIEST_CANDIDATE";
  const channelRollover = recommendation.currentLdcTick !== undefined && recommendation.previousLdcTick !== undefined
    ? recommendation.currentLdcTick > recommendation.previousLdcTick
    : recommendation.currentLdc > recommendation.previousLdc;
  const gateText = channelRollover
    ? "PASS — signal low touches the current LDC and the LDC has risen"
    : "FAIL — the channel is flat/falling; a touch alone is not a BUY";
  const calibratedText = sequential?.calibratedProbability === null || sequential === undefined
    ? "Not calibrated — evidence score only"
    : `${(sequential.calibratedProbability * 100).toFixed(1)}% (walk-forward model)`;

  const decisionFields: DetailField[] = [
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
    ...(sequential ? [["Trader read", sequential.traderSummary ?? "Evidence is informational; follow-through is not confirmed."]] as DetailField[] : []),
  ];

  const tradeFields: DetailField[] = [
    ["Entry trigger", formatPrice(recommendation.entry)],
    ["Protective stop", formatPrice(recommendation.stop)],
    ["Target 1", formatPrice(recommendation.target1)],
    ["Target 2", formatPrice(recommendation.target2)],
    ["Planned reward/risk", recommendation.rewardRisk.toFixed(2)],
    ["Reaction high", formatPrice(recommendation.reactionHigh)],
  ];

  const donchianFields: DetailField[] = [
    ["Current Donchian low", formatPrice(recommendation.currentLdc)],
    ["Previous Donchian low", formatPrice(recommendation.previousLdc)],
    ["Signal candle low", recommendation.signalLow === undefined ? "Unavailable" : formatPrice(recommendation.signalLow)],
    ["Signal candle close", recommendation.signalClose === undefined ? "Unavailable" : formatPrice(recommendation.signalClose)],
    ["Reversal gate", gateText],
    ["Auto period", String(recommendation.autoPeriod)],
    ...(recommendation.periodStability
      ? [["Period robustness", recommendation.periodStability.map(({ period, validNeighborCount, neighborhoodSize }) => `${period}:${validNeighborCount}/${neighborhoodSize}`).join(" | ")]] as DetailField[]
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
        ["Stable periods", `${confirmation.validPeriodRange[0]}–${confirmation.validPeriodRange[1]} (${confirmation.validPeriodCount} valid)`],
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
