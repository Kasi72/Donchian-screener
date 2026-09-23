"use client";

import { Fragment, useState, type ReactNode } from "react";

import type { BuyRecommendation } from "@/lib/signals/scan-symbol";
import { displayedGate, traderAssessmentFields } from "@/lib/signals/trader-assessment";
import { tierLabel } from "@/lib/signals/signal-tier";
import { buildWhatsAppSummary, exportTraderTearSheet, type TearSheetFormat } from "@/lib/export/trader-tear-sheet";

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

function DetailGroup({ title, fields }: { title: string; fields: DetailField[] }) {
  if (fields.length === 0) return null;
  return (
    <div className="details-subgroup">
      <h4>{title}</h4>
      <DetailGrid fields={fields} />
    </div>
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
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const confirmation = recommendation.confirmation;
  const sequential = recommendation.sequentialEvidence;
  const diagnostics = recommendation.tradeDiagnostics;
  const signalState = recommendation.signalState ?? sequential?.state ?? "EARLIEST_CANDIDATE";
  const gateText = displayedGate(recommendation);
  const calibratedText = diagnostics?.reversalProbability === null || diagnostics === undefined
    ? "Not calibrated — evidence score only (walk-forward outcomes pending)"
    : `${(diagnostics.reversalProbability * 100).toFixed(1)}% (walk-forward model)`;
  const calibrationText = diagnostics?.calibration && diagnostics.calibration !== "UNAVAILABLE"
    ? diagnostics.calibration
    : "Not active — purged walk-forward calibration pending";

  const decisionFields: DetailField[] = [
    ...traderAssessmentFields(recommendation),
    ["Trade tier", recommendation.signalTier ? tierLabel(recommendation.signalTier) : "Unavailable", recommendation.signalTier === "CONFIRMED_REVERSAL" ? "confirmation-grade--strong" : recommendation.signalTier === "DEVELOPING_REVERSAL" ? "confirmation-grade--confirmed" : "signal-state--candidate"],
    ["Tier score", recommendation.tierScore === undefined ? "Unavailable" : `${recommendation.tierScore.toFixed(1)}/100`],
    ["Entry readiness", recommendation.entryReadiness?.replaceAll("_", " ") ?? "Unavailable"],
    ["Tier rationale", recommendation.tierReason ?? "Unavailable"],
    ...(recommendation.tierWarnings?.length ? [["Tier warnings", recommendation.tierWarnings.join("; ")]] as DetailField[] : []),
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
      "Calibrated uncertainty interval",
      diagnostics?.reversalConfidenceInterval
        ? `${(diagnostics.reversalConfidenceInterval[0] * 100).toFixed(1)}%–${(diagnostics.reversalConfidenceInterval[1] * 100).toFixed(1)}%`
        : "Pending calibration — needs purged walk-forward outcomes",
      diagnostics?.reversalConfidenceInterval ? undefined : "detail-value--pending",
    ],
    [
      "Target 1 before stop",
      diagnostics?.target1BeforeStopProbability === null || diagnostics === undefined
        ? "Pending calibration — needs completed triple-barrier outcomes"
        : `${(diagnostics.target1BeforeStopProbability * 100).toFixed(1)}%`,
      diagnostics?.target1BeforeStopProbability === null || diagnostics === undefined ? "detail-value--pending" : undefined,
    ],
    [
      "Evidence quality score",
      diagnostics ? `${diagnostics.evidenceQualityScore.toFixed(1)}/100` : "Unavailable",
    ],
    [
      "Trade quality score",
      diagnostics?.tradeQualityScore === null || diagnostics === undefined
        ? "Pending calibration — needs cost-adjusted out-of-sample outcomes"
        : `${diagnostics.tradeQualityScore.toFixed(1)}/100`,
      diagnostics?.tradeQualityScore === null || diagnostics === undefined ? "detail-value--pending" : undefined,
    ],
    ["Actionability", diagnostics?.actionability ?? "STRUCTURAL_ONLY"],
    ...(sequential ? [["Trader read", sequential.traderSummary ?? "Evidence is informational; follow-through is not confirmed."]] as DetailField[] : []),
  ];

  const tradeFields: DetailField[] = [
    ["Entry reference", formatPrice(recommendation.entry)],
    ["Protective stop", formatPrice(recommendation.stop)],
    ["Target 1", formatPrice(recommendation.target1)],
    ["Target 2", formatPrice(recommendation.target2)],
    ["Risk per share", recommendation.riskPerShare === undefined ? formatPrice(recommendation.entry - recommendation.stop) : formatPrice(recommendation.riskPerShare)],
    ["Risk percentage", recommendation.riskPercent === undefined ? `${(((recommendation.entry - recommendation.stop) / recommendation.entry) * 100).toFixed(2)}%` : `${recommendation.riskPercent.toFixed(2)}%`],
    ["Target 1 reward/risk", recommendation.target1RewardRisk?.toFixed(2) ?? ((recommendation.target1 - recommendation.entry) / (recommendation.entry - recommendation.stop)).toFixed(2)],
    ["Target 2 reward/risk", recommendation.target2RewardRisk?.toFixed(2) ?? ((recommendation.target2 - recommendation.entry) / (recommendation.entry - recommendation.stop)).toFixed(2)],
    ["Room to reaction high (R)", recommendation.rewardRisk === null ? "Unavailable — no confirmed overhead pivot" : recommendation.rewardRisk.toFixed(2)],
    ["Execution", "Next obtainable price; recalculate risk and reward after gaps. Reference prices are not guaranteed fills."],
    ["Stop buffer", recommendation.stopBuffer === undefined ? "Unavailable" : `${formatPrice(recommendation.stopBuffer)} (${recommendation.stopBufferAtr?.toFixed(2) ?? "—"} ATR)`],
    ["Reaction high", recommendation.reactionHigh === null ? "Unavailable" : formatPrice(recommendation.reactionHigh)],
    ["Maximum holding period", diagnostics ? `${diagnostics.maximumHoldingCandles} candles` : "Unavailable"],
    ["Execution quality", recommendation.executionQuality?.status ?? "Unavailable"],
    ["Gap risk", recommendation.executionQuality ? `${recommendation.executionQuality.gapRisk} (${recommendation.executionQuality.maximumRecentGapAtr.toFixed(2)} ATR maximum recent gap)` : "Unavailable"],
    ["Estimated median daily turnover", recommendation.executionQuality ? formatPrice(recommendation.executionQuality.medianDailyTurnoverInr) : "Unavailable"],
    ["Execution checks", recommendation.executionQuality?.reasons.join("; ") ?? "Unavailable"],
  ];

  const donchianFields: DetailField[] = [
    ["Current Donchian low", formatPrice(recommendation.currentLdc)],
    ["Previous Donchian low", formatPrice(recommendation.previousLdc)],
    ["Rollover strength", recommendation.rolloverStrengthAtr === undefined ? "Unavailable" : `${recommendation.rolloverStrengthAtr.toFixed(3)} ATR (${recommendation.rolloverQuality ?? "UNAVAILABLE"})`],
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
        ["SG slope agreement", sequential.sgPositiveSlopeAgreement === undefined ? "Unavailable" : `${Math.round(sequential.sgPositiveSlopeAgreement * 3)}/3 windows positive`],
        ["SG curvature agreement", sequential.sgPositiveCurvatureAgreement === undefined ? "Unavailable" : `${Math.round(sequential.sgPositiveCurvatureAgreement * 3)}/3 windows improving`],
        ["SG stability", sequential.sgStabilityScore === undefined ? "Unavailable" : `${(sequential.sgStabilityScore * 100).toFixed(1)}%`],
        ["ATR-normalized SG slope", sequential.atrNormalizedSlope === undefined ? "Unavailable" : sequential.atrNormalizedSlope.toFixed(3)],
        ["Bayesian short-run evidence", sequential.bayesianChangePoint ? `${(sequential.bayesianChangePoint.shortRunProbability * 100).toFixed(1)}% (run length ${sequential.bayesianChangePoint.mostLikelyRunLength})` : "Unavailable"],
        ["Bayesian bullish-change evidence", sequential.bayesianChangePoint ? `${(sequential.bayesianChangePoint.bullishChangeEvidence * 100).toFixed(1)}% evidence — not win probability` : "Unavailable"],
        ["Latent slope probability", sequential.stateSpaceTrend ? `${(sequential.stateSpaceTrend.slopePositiveProbability * 100).toFixed(1)}% evidence — not win probability` : "Unavailable"],
        ["Latent slope / uncertainty", sequential.stateSpaceTrend ? `${sequential.stateSpaceTrend.slope.toFixed(6)} ± ${sequential.stateSpaceTrend.slopeStandardError.toFixed(6)}` : "Unavailable"],
        ["Higher-timeframe trend", sequential.context?.higherTimeframeTrend ?? "Unavailable"],
        ["NIFTY relative strength", sequential.context?.relativeStrengthZ === null || sequential.context === undefined ? "Unavailable" : `${sequential.context.relativeStrengthZ.toFixed(2)} z-score (${sequential.context.relativeStrengthState})`],
        ["Robust volatility z-score", sequential.volatilityZ === undefined ? "Unavailable" : sequential.volatilityZ.toFixed(2)],
        ["Overlay evidence score", sequential.overlayScore === undefined ? "Unavailable" : `${sequential.overlayScore.toFixed(2)}/1.00`],
        ["Trend state", sequential.trendState ?? "Unavailable"],
        ["Market regime", diagnostics?.marketRegime ?? sequential.marketRegime ?? "Unavailable"],
        ["Regime trend z-score", sequential.regimeTrendZ === undefined ? "Unavailable" : sequential.regimeTrendZ.toFixed(2)],
        ["Regime volatility percentile", sequential.regimeVolatilityPercentile === undefined ? "Unavailable" : `${(sequential.regimeVolatilityPercentile * 100).toFixed(1)}%`],
        ["MA evidence score", sequential.maEvidenceScore === undefined ? "Unavailable" : `${(sequential.maEvidenceScore * 100).toFixed(1)}%`],
        ["EMA fast / slow", sequential.movingAverages ? `${formatPrice(sequential.movingAverages.emaFast)} / ${formatPrice(sequential.movingAverages.emaSlow)}` : "Unavailable"],
        ["KAMA / T3", sequential.movingAverages ? `${formatPrice(sequential.movingAverages.kama)} / ${formatPrice(sequential.movingAverages.t3)}` : "Unavailable"],
        ["MA slope agreement", sequential.movingAverages ? `${[sequential.movingAverages.emaSlope, sequential.movingAverages.wmaSlope, sequential.movingAverages.kamaSlope, sequential.movingAverages.t3Slope].filter((value) => value > 0).length}/4 positive` : "Unavailable"],
        ["Independent evidence groups", sequential.independentGroupCount === undefined ? "Unavailable" : `${sequential.independentGroupCount}/4 (${sequential.evidenceGroups?.join(", ") || "none"})`],
        ["Trend persistence", sequential.trendPersistenceScore === undefined ? "Unavailable" : `${(sequential.trendPersistenceScore * 100).toFixed(1)}%`],
        ["Qualifying period audit", `${confirmation.validPeriodRange[0]}–${confirmation.validPeriodRange[1]} (${confirmation.validPeriodCount} valid)`],
        ["Confirmation reasons", confirmation.reasons.join("; ")],
        ...(diagnostics?.validationNotes?.length ? [["Validation safeguards", diagnostics.validationNotes.join(" ")] as DetailField] : []),
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
    ["Higher timeframe", sequential?.context?.higherTimeframe
      ? `${sequential.context.higherTimeframe} / ${sequential.context.higherTimeframeTrend} (completed bars only)`
      : "Unavailable — neutral by design", sequential?.context?.higherTimeframe ? undefined : "detail-value--pending"],
    ["Benchmark context", sequential?.context?.benchmarkSymbol
      ? `${sequential.context.benchmarkSymbol}; ${sequential.context.benchmarkBars} aligned bars`
      : "Unavailable — neutral by design", sequential?.context?.benchmarkSymbol ? undefined : "detail-value--pending"],
    ["Data provider", recommendation.dataProvider ?? "Unavailable"],
    ["Provider consensus", recommendation.providerConsensus ?? "UNAVAILABLE", recommendation.providerConsensus === "AGREED" ? "confirmation-grade--strong" : "detail-value--pending"],
    ["Candle snapshot hash", recommendation.candleSnapshotHash ?? "Unavailable"],
    ["Market regime", diagnostics?.marketRegime ?? "Unavailable"],
    ["Data quality", diagnostics?.dataQuality ?? "Unavailable"],
    ["Calibration", calibrationText, diagnostics?.calibration && diagnostics.calibration !== "UNAVAILABLE" ? undefined : "detail-value--pending"],
    ["Comparable historical signals", diagnostics?.comparableSignals === null || diagnostics === undefined ? "Pending — calibration dataset not loaded" : String(diagnostics.comparableSignals), diagnostics?.comparableSignals === null || diagnostics === undefined ? "detail-value--pending" : undefined],
    ["Median MAE / MFE", diagnostics?.medianMae === null || diagnostics?.medianMfe === null || diagnostics === undefined ? "Pending — requires completed triple-barrier outcomes" : `${formatPrice(diagnostics.medianMae)} / ${formatPrice(diagnostics.medianMfe)}`, diagnostics?.medianMae === null || diagnostics?.medianMfe === null || diagnostics === undefined ? "detail-value--pending" : undefined],
  ];

  const pickDecisionFields = (labels: string[]) => decisionFields.filter(([label]) => labels.includes(label));
  const verdictFields = pickDecisionFields([
    "Signal state", "Reversal confirmation", "Reversal probability", "Calibrated uncertainty interval", "Target 1 before stop", "Evidence quality score",
  ]);
  const readinessFields = pickDecisionFields([
    "Trade tier", "Tier score", "Entry readiness", "Trade quality score", "Actionability",
  ]);
  const interpretationFields = pickDecisionFields(["Evidence interpretation", "Conflicting evidence", "Prediction readiness", "What a future probability will mean", "Trade discipline", "Tier rationale", "Tier warnings", "Trader read"]);

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
                  <option value="pdf-compact">PDF (compact tear sheet)</option>
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
              <button
                type="button"
                className="details-copy-button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(buildWhatsAppSummary(recommendation));
                    setCopyState("copied");
                  } catch {
                    setCopyState("failed");
                  }
                }}
              >
                {copyState === "copied" ? "Copied for WhatsApp" : "Copy WhatsApp summary"}
              </button>
              {copyState === "failed" ? <p className="details-export-error" role="alert">Clipboard access was blocked. Use the PDF tear sheet instead.</p> : null}
              {exportError ? <p className="details-export-error" role="alert">{exportError}</p> : null}
            </div>
          </header>
          <DetailSection title="Decision" description="Start here: identify the setup, judge the evidence, then check whether the trade is actionable.">
            <div className="details-subgroups">
              <DetailGroup title="Signal verdict" fields={verdictFields} />
              <DetailGroup title="Trade readiness" fields={readinessFields} />
              <DetailGroup title="Trader interpretation" fields={interpretationFields} />
            </div>
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
