import type { BuyRecommendation } from "@/lib/signals/scan-symbol";
import { displayedGate, traderAssessmentFields } from "@/lib/signals/trader-assessment";

export type TearSheetFormat = "word" | "pdf" | "pdf-compact";

export interface TearSheetSection {
  title: string;
  description: string;
  fields: Array<[label: string, value: string]>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function money(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function date(value: number): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

function valueOrUnavailable(value: number | undefined, formatter: (value: number) => string): string {
  return value === undefined ? "Unavailable" : formatter(value);
}

export function buildTearSheetSections(recommendation: BuyRecommendation): TearSheetSection[] {
  const confirmation = recommendation.confirmation;
  const sequential = recommendation.sequentialEvidence;
  const diagnostics = recommendation.tradeDiagnostics;
  const signalState = recommendation.signalState ?? sequential?.state ?? "EARLIEST_CANDIDATE";
  const calibrationText = diagnostics?.calibration && diagnostics.calibration !== "UNAVAILABLE"
    ? diagnostics.calibration
    : "Not active - purged walk-forward calibration pending";

  return [
    {
      title: "Decision",
      description: "The plain-language answer and confidence status.",
      fields: [
        ...traderAssessmentFields(recommendation),
        ["Signal", "BUY"],
        ["Signal state", signalState],
        ["Reversal confirmation", confirmation ? `${confirmation.grade} (${confirmation.score.toFixed(2)}/100)` : "Unavailable"],
        ["Reversal probability", diagnostics?.reversalProbability === null || diagnostics === undefined ? "Not calibrated - evidence score only (walk-forward outcomes pending)" : `${(diagnostics.reversalProbability * 100).toFixed(1)}%`],
        ["Calibrated uncertainty interval", diagnostics?.reversalConfidenceInterval ? `${(diagnostics.reversalConfidenceInterval[0] * 100).toFixed(1)}%-${(diagnostics.reversalConfidenceInterval[1] * 100).toFixed(1)}%` : "Pending calibration - needs purged walk-forward outcomes"],
        ["Target 1 before stop", diagnostics?.target1BeforeStopProbability === null || diagnostics === undefined ? "Pending calibration - needs completed triple-barrier outcomes" : `${(diagnostics.target1BeforeStopProbability * 100).toFixed(1)}%`],
        ["Evidence quality", diagnostics ? `${diagnostics.evidenceQualityScore.toFixed(1)}/100` : "Unavailable"],
        ["Trade quality score", diagnostics?.tradeQualityScore === null || diagnostics === undefined ? "Pending calibration - needs cost-adjusted out-of-sample outcomes" : `${diagnostics.tradeQualityScore.toFixed(1)}/100`],
        ["Calibration", calibrationText],
        ["Trader read", sequential?.traderSummary ?? "Donchian rules pass; follow-through is not confirmed."],
        ["Tier score", recommendation.tierScore === undefined ? "Unavailable" : `${recommendation.tierScore.toFixed(1)}/100`],
        ["Entry readiness", recommendation.entryReadiness ?? "Unavailable"],
      ],
    },
    {
      title: "Trade plan",
      description: "Prices and risk levels derived from the completed signal candle.",
      fields: [
        ["Entry reference", money(recommendation.entry)],
        ["Protective stop", money(recommendation.stop)],
        ["Target 1", money(recommendation.target1)],
        ["Target 2", money(recommendation.target2)],
        ["Risk per share", money(recommendation.riskPerShare ?? recommendation.entry - recommendation.stop)],
        ["Risk percentage", `${(recommendation.riskPercent ?? ((recommendation.entry - recommendation.stop) / recommendation.entry) * 100).toFixed(2)}%`],
        ["Target 1 reward/risk", ((recommendation.target1 - recommendation.entry) / (recommendation.entry - recommendation.stop)).toFixed(2)],
        ["Target 2 reward/risk", ((recommendation.target2 - recommendation.entry) / (recommendation.entry - recommendation.stop)).toFixed(2)],
        ["Room to reaction high (R)", recommendation.rewardRisk === null ? "Unavailable — no confirmed overhead pivot" : recommendation.rewardRisk.toFixed(2)],
        ["Execution", "Next obtainable price; recalculate risk and reward after gaps. Reference prices are not guaranteed fills."],
        ["Stop buffer", recommendation.stopBuffer === undefined ? "Unavailable" : `${money(recommendation.stopBuffer)} (${recommendation.stopBufferAtr?.toFixed(2) ?? "-"} ATR)`],
        ["Maximum holding period", `${diagnostics?.maximumHoldingCandles ?? 10} candles`],
        ["Execution quality", recommendation.executionQuality?.status ?? "Unavailable"],
        ["Gap risk", recommendation.executionQuality ? `${recommendation.executionQuality.gapRisk} (${recommendation.executionQuality.maximumRecentGapAtr.toFixed(2)} ATR)` : "Unavailable"],
        ["Estimated median daily turnover", recommendation.executionQuality ? money(recommendation.executionQuality.medianDailyTurnoverInr) : "Unavailable"],
      ],
    },
    {
      title: "Donchian validation",
      description: "The original reversal rule remains the mandatory BUY gate.",
      fields: [
        ["Current Donchian low", money(recommendation.currentLdc)],
        ["Previous Donchian low", money(recommendation.previousLdc)],
        ["Signal candle low", valueOrUnavailable(recommendation.signalLow, money)],
        ["Signal candle close", valueOrUnavailable(recommendation.signalClose, money)],
        ["Reversal gate", displayedGate(recommendation)],
        ["Auto period", String(recommendation.autoPeriod)],
        ["Period audit meaning", "Only one period can pass exact touch plus rising LDC. Neighbour counts do not measure confidence."],
        ["Period audit", recommendation.periodAudit?.map(({ period, valid }) => `${period}:${valid ? "valid" : "invalid"}`).join(" | ") ?? "Unavailable"],
      ],
    },
    {
      title: "Confirmation evidence",
      description: "Secondary evidence strengthens or weakens conviction but never overrides the Donchian gate.",
      fields: confirmation && sequential ? [
        ["Close location", `${(confirmation.closeLocation * 100).toFixed(1)}%`],
        ["Lower-wick rejection", `${(confirmation.lowerWickRatio * 100).toFixed(1)}%`],
        ["ATR recovery", `${confirmation.atrRecovery.toFixed(2)} ATR`],
        ["Volume surprise", confirmation.volumeZScore === null ? "Unavailable" : `${confirmation.volumeZScore.toFixed(2)} z-score`],
        ["Regime-shift evidence", `${(sequential.changePointProbability * 100).toFixed(1)}%`],
        ["CUSUM evidence", `${(sequential.cusumScore * 100).toFixed(1)}%`],
        ["Bayesian bullish-change evidence", sequential.bayesianChangePoint ? `${(sequential.bayesianChangePoint.bullishChangeEvidence * 100).toFixed(1)}% evidence - not win probability` : "Unavailable"],
        ["Latent slope probability", sequential.stateSpaceTrend ? `${(sequential.stateSpaceTrend.slopePositiveProbability * 100).toFixed(1)}% evidence - not win probability` : "Unavailable"],
        ["SG slope agreement", sequential.sgPositiveSlopeAgreement === undefined ? "Unavailable" : `${Math.round(sequential.sgPositiveSlopeAgreement * 3)}/3 positive`],
        ["SG curvature agreement", sequential.sgPositiveCurvatureAgreement === undefined ? "Unavailable" : `${Math.round(sequential.sgPositiveCurvatureAgreement * 3)}/3 improving`],
        ["Higher-timeframe trend", sequential.context?.higherTimeframeTrend ?? "Unavailable"],
        ["NIFTY relative strength", sequential.context?.relativeStrengthZ === null || sequential.context === undefined ? "Unavailable" : `${sequential.context.relativeStrengthZ.toFixed(2)} z-score (${sequential.context.relativeStrengthState})`],
        ["Trend state", sequential.trendState ?? "Unavailable"],
        ["Trend persistence", sequential.trendPersistenceScore === undefined ? "Unavailable" : `${(sequential.trendPersistenceScore * 100).toFixed(1)}%`],
        ["Regime trend z-score", sequential.regimeTrendZ === undefined ? "Unavailable" : sequential.regimeTrendZ.toFixed(2)],
        ["Regime volatility percentile", sequential.regimeVolatilityPercentile === undefined ? "Unavailable" : `${(sequential.regimeVolatilityPercentile * 100).toFixed(1)}%`],
        ["MA evidence score", sequential.maEvidenceScore === undefined ? "Unavailable" : `${(sequential.maEvidenceScore * 100).toFixed(1)}%`],
        ["EMA fast / slow", sequential.movingAverages ? `${money(sequential.movingAverages.emaFast)} / ${money(sequential.movingAverages.emaSlow)}` : "Unavailable"],
        ["KAMA / T3", sequential.movingAverages ? `${money(sequential.movingAverages.kama)} / ${money(sequential.movingAverages.t3)}` : "Unavailable"],
        ["MA slope agreement", sequential.movingAverages ? `${[sequential.movingAverages.emaSlope, sequential.movingAverages.wmaSlope, sequential.movingAverages.kamaSlope, sequential.movingAverages.t3Slope].filter((value) => value > 0).length}/4 positive` : "Unavailable"],
        ["Independent evidence groups", sequential.independentGroupCount === undefined ? "Unavailable" : `${sequential.independentGroupCount}/4 (${sequential.evidenceGroups?.join(", ") || "none"})`],
        ["Confirmation reasons", confirmation.reasons.join("; ")],
        ...(diagnostics?.validationNotes?.length ? [["Validation safeguards", diagnostics.validationNotes.join(" ")] as [string, string]] : []),
      ] : [["Status", "Confirmation evidence unavailable"]],
    },
    {
      title: "Data and audit trail",
      description: "Provenance and integrity information for review and record keeping.",
      fields: [
        ["Signal candle", date(recommendation.signalTime)],
        ["Timeframe", recommendation.timeframe],
        ["Data as of", date(recommendation.dataAsOf)],
        ["Yahoo symbol", recommendation.yahooSymbol],
        ["Price adjustment", recommendation.adjustmentMode],
        ["Tick size / policy", `${recommendation.tickSize} / ${recommendation.tickPolicy}`],
        ["Market regime", diagnostics?.marketRegime ?? "Unavailable"],
        ["Data quality", diagnostics?.dataQuality ?? "Unavailable"],
        ["Higher timeframe", sequential?.context?.higherTimeframe ? `${sequential.context.higherTimeframe} / ${sequential.context.higherTimeframeTrend}` : "Unavailable - neutral by design"],
        ["Benchmark context", sequential?.context?.benchmarkSymbol ? `${sequential.context.benchmarkSymbol}; ${sequential.context.benchmarkBars} aligned bars` : "Unavailable - neutral by design"],
        ["Data provider", recommendation.dataProvider ?? "Unavailable"],
        ["Provider consensus", recommendation.providerConsensus ?? "UNAVAILABLE"],
        ["Candle snapshot hash", recommendation.candleSnapshotHash ?? "Unavailable"],
        ["Historical comparable signals", diagnostics?.comparableSignals === null || diagnostics === undefined ? "Pending - calibration dataset not loaded" : String(diagnostics.comparableSignals)],
        ["Median MAE / MFE", diagnostics?.medianMae === null || diagnostics?.medianMfe === null || diagnostics === undefined ? "Pending - requires completed triple-barrier outcomes" : `${money(diagnostics.medianMae)} / ${money(diagnostics.medianMfe)}`],
        ["Anchor rationale", recommendation.anchorRationale],
      ],
    },
  ];
}

export function buildTearSheetHtml(recommendation: BuyRecommendation, title = "Donchian Reversal Screener", compact = false) {
  const sections = buildTearSheetSections(recommendation);
  const sectionsHtml = sections.map((section) => `
    <section class="section">
      <div class="section-head"><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.description)}</p></div>
      <div class="grid">${section.fields.map(([label, value]) => `<div class="field"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`).join("")}</div>
    </section>`).join("");
  const diagnostics = recommendation.tradeDiagnostics;
  const state = recommendation.signalState ?? recommendation.sequentialEvidence?.state ?? "EARLIEST_CANDIDATE";
  const grade = recommendation.confirmation?.grade ?? "UNAVAILABLE";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)} - ${escapeHtml(recommendation.symbol)}</title><style>
    @page{size:Letter;margin:${compact ? "10mm" : "16mm"}}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#172538;background:#fff;margin:0;font-size:${compact ? "9pt" : "10pt"};line-height:1.4}.masthead{border-bottom:3px solid #087f5b;padding-bottom:${compact ? "9px" : "14px"};margin-bottom:${compact ? "10px" : "16px"}}.eyebrow{font-size:9pt;text-transform:uppercase;letter-spacing:.12em;font-weight:700;color:#087f5b;margin:0 0 5px}.title{font-size:${compact ? "19pt" : "23pt"};font-weight:700;margin:0}.subtitle{color:#506176;margin:5px 0 0}.badges{margin-top:8px;display:flex;gap:7px;flex-wrap:wrap}.badge{display:inline-block;border:1px solid #a7b4c3;border-radius:14px;padding:3px 8px;font-size:8pt;font-weight:700}.buy{color:#087f5b;border-color:#087f5b}.state{color:#9b6b00}.grade{color:#087f5b}.section{break-inside:avoid;margin:0 0 ${compact ? "10px" : "15px"}}.section-head{display:flex;align-items:baseline;gap:10px;border-bottom:1px solid #d7dfe8;padding-bottom:4px;margin-bottom:6px}.section-head h2{font-size:${compact ? "11pt" : "13pt"};margin:0}.section-head p{font-size:8pt;color:#627286;margin:0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${compact ? "6px 14px" : "9px 18px"}}.field{break-inside:avoid}.label{font-size:8pt;color:#627286}.value{font-size:${compact ? "9pt" : "10pt"};font-weight:700;overflow-wrap:anywhere}.footer{border-top:1px solid #d7dfe8;color:#627286;font-size:8pt;padding-top:8px;margin-top:10px}.warning{background:#fff7df;border-left:3px solid #d69e00;padding:6px 8px;margin:8px 0;font-size:8pt}@media print{.section{break-inside:avoid}}
  </style></head><body><header class="masthead"><p class="eyebrow">${escapeHtml(title)}</p><h1 class="title">${escapeHtml(recommendation.symbol)} reversal setup</h1><p class="subtitle">Prepared from completed ${escapeHtml(recommendation.timeframe)} candles. Core Donchian rules remain the mandatory BUY gate.</p><div class="badges"><span class="badge buy">BUY</span><span class="badge state">${escapeHtml(state)}</span><span class="badge grade">${escapeHtml(grade)}</span></div></header>${sectionsHtml}<div class="warning">Probabilities and historical outcome metrics are shown only when a walk-forward calibration dataset is available. Uncalibrated evidence must not be interpreted as a win probability.</div><footer class="footer">Quantitative research output, not a guarantee or personalized investment advice. Generated ${escapeHtml(new Date().toLocaleString("en-IN"))}.${diagnostics ? ` Diagnostics version: ${escapeHtml(diagnostics.version)}.` : ""}</footer></body></html>`;
}

export function buildWhatsAppSummary(recommendation: BuyRecommendation): string {
  const state = recommendation.signalTier?.replaceAll("_", " ") ?? recommendation.signalState?.replaceAll("_", " ") ?? "CANDIDATE";
  const risk = recommendation.riskPerShare ?? recommendation.entry - recommendation.stop;
  const riskPct = recommendation.riskPercent ?? (risk / recommendation.entry) * 100;
  const t1R = recommendation.target1RewardRisk ?? (recommendation.target1 - recommendation.entry) / risk;
  const t2R = recommendation.target2RewardRisk ?? (recommendation.target2 - recommendation.entry) / risk;
  return [
    `📈 *${recommendation.symbol} — ${state}*`,
    `🟢 Signal: BUY | ${recommendation.timeframe}`,
    `🎯 Entry: ${money(recommendation.entry)}`,
    `🛡️ Stop: ${money(recommendation.stop)} (risk ${money(risk)} / ${riskPct.toFixed(2)}%)`,
    `✅ Target 1: ${money(recommendation.target1)} (${t1R.toFixed(2)}R)`,
    `🚀 Target 2: ${money(recommendation.target2)} (${t2R.toFixed(2)}R)`,
    `📊 Donchian period: ${recommendation.autoPeriod} | Gate: PASS`,
    `🕯️ Signal candle: ${date(recommendation.signalTime)}`,
    `⚠️ Next obtainable price; recalculate risk after gaps. Not investment advice.`,
  ].join("\n");
}

export function exportTraderTearSheet(recommendation: BuyRecommendation, format: TearSheetFormat): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const html = buildTearSheetHtml(recommendation, "Donchian Reversal Screener", format === "pdf-compact");
  if (format === "word") {
    const blob = new Blob([html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `donchian-tear-sheet-${recommendation.symbol.toLowerCase()}.doc`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Some browsers resolve the download asynchronously. Revoking in the
    // same tick can leave a zero-byte or missing Word file.
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    return;
  }
  // Keep the popup same-origin so document.write() can populate it. Using
  // noopener here can produce an inaccessible blank tab in some browsers.
  const printWindow = window.open("", "_blank");
  if (!printWindow) throw new Error("Please allow pop-ups to export the PDF tear sheet.");
  let printed = false;
  const print = () => {
    if (printed || printWindow.closed) return;
    printed = true;
    printWindow.focus();
    printWindow.print();
  };
  printWindow.addEventListener("load", print, { once: true });
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  // The load event is the normal path; the fallback handles browsers that do
  // not emit it for a document populated with document.write().
  window.setTimeout(print, 750);
}
