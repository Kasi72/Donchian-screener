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
  const fields = [
    ["Current Donchian low", formatPrice(recommendation.currentLdc)],
    ["Previous Donchian low", formatPrice(recommendation.previousLdc)],
    ["Signal candle", dateFormatter.format(recommendation.signalTime)],
    ["Confirmed pivot anchor", dateFormatter.format(recommendation.anchorTime)],
    ["Yahoo symbol", recommendation.yahooSymbol],
    ["Candle timeframe", recommendation.timeframe],
    ["Strategy version", recommendation.strategyVersion],
  ];

  return (
    <tr className="details-row">
      <td colSpan={9}>
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
