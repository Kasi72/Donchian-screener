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

function RowGroup({ children }: { children: ReactNode }) {
  return <Fragment>{children}</Fragment>;
}

export function SignalDetails({
  id,
  recommendation,
}: {
  id: string;
  recommendation: BuyRecommendation;
}) {
  const confirmation = recommendation.confirmation;
  const channelRollover = recommendation.currentLdc > recommendation.previousLdc;
  const fields = [
    ["Current Donchian low", formatPrice(recommendation.currentLdc)],
    ["Previous Donchian low", formatPrice(recommendation.previousLdc)],
    [
      "Donchian reversal gate",
      channelRollover
        ? "PASS — signal low touches the current LDC and the LDC has risen"
        : "FAIL — the channel is flat/falling; a touch alone is not a BUY",
    ],
    ["Signal candle", dateFormatter.format(recommendation.signalTime)],
    ["Confirmed pivot anchor", dateFormatter.format(recommendation.anchorTime)],
    ["Yahoo symbol", recommendation.yahooSymbol],
    ["Candle timeframe", recommendation.timeframe],
    ["Price adjustment", recommendation.adjustmentMode],
    ["Tick size / policy", `${recommendation.tickSize} / ${recommendation.tickPolicy}`],
    ...(recommendation.periodAudit
      ? [[
          "Period audit (N±2)",
          recommendation.periodAudit
            .map(({ period, touchPassed, rolloverPassed, valid }) =>
              `${period}:${valid ? "VALID" : `${touchPassed ? "touch" : "no-touch"}/${rolloverPassed ? "rollover" : "no-rollover"}`}`,
            )
            .join(" | "),
        ]]
      : []),
    ...(recommendation.windowAudit
      ? [[
          "Daily window integrity",
          recommendation.windowAudit.complete
            ? `${recommendation.windowAudit.observedSessions}/${recommendation.windowAudit.expectedSessions} NSE sessions present`
            : `${recommendation.windowAudit.missingSessions} NSE sessions missing`,
        ]]
      : []),
    ["Reaction high", formatPrice(recommendation.reactionHigh)],
    ["Planned reward/risk", recommendation.rewardRisk.toFixed(2)],
    ["Structural score", `${recommendation.score.toFixed(4)} (${recommendation.scoreVersion})`],
    ["Higher timeframe", "Neutral (input unavailable)"],
    ...(recommendation.sequentialEvidence
      ? [
          ["Signal state", recommendation.signalState ?? recommendation.sequentialEvidence.state],
          [
            "Sequential evidence score",
            `${(recommendation.sequentialEvidence.reversalScore * 100).toFixed(1)}% (${recommendation.sequentialEvidence.calibration})`,
          ],
          ...(recommendation.sequentialEvidence.calibratedProbability === null
            ? []
            : [[
                "Calibrated reversal probability",
                `${(recommendation.sequentialEvidence.calibratedProbability * 100).toFixed(1)}%`,
              ]]),
          ["CUSUM evidence", `${(recommendation.sequentialEvidence.cusumScore * 100).toFixed(1)}%`],
          [
            "Bayesian change-point evidence",
            `${(recommendation.sequentialEvidence.changePointProbability * 100).toFixed(1)}%`,
          ],
          ["Causal evidence model", recommendation.sequentialEvidence.version],
        ]
      : []),
    ...(confirmation
      ? [
          ["Reversal confirmation", `${confirmation.grade} (${confirmation.score.toFixed(2)}/100)`],
          ["Close location", `${(confirmation.closeLocation * 100).toFixed(1)}%`],
          ["Lower-wick rejection", `${(confirmation.lowerWickRatio * 100).toFixed(1)}%`],
          ["ATR recovery", `${confirmation.atrRecovery.toFixed(2)} ATR`],
          [
            "Volume surprise",
            confirmation.volumeZScore === null ? "Unavailable" : `${confirmation.volumeZScore.toFixed(2)} z-score`,
          ],
          ["Change-point score", confirmation.changePointScore.toFixed(2)],
          [
            "Stable periods",
            `${confirmation.validPeriodRange[0]}–${confirmation.validPeriodRange[1]} (${confirmation.validPeriodCount} valid)`,
          ],
          ["Confirmation reasons", confirmation.reasons.join("; ")],
        ]
      : []),
    ["Anchor rationale", recommendation.anchorRationale],
    ["Strategy version", recommendation.strategyVersion],
  ];

  return (
    <tr className="details-row">
      <td colSpan={10}>
        <section
          id={id}
          role="region"
          aria-label={`Calculation details for ${recommendation.symbol}`}
          className="details-region"
        >
          <dl>
            {fields.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </td>
    </tr>
  );
}

SignalDetails.RowGroup = RowGroup;
