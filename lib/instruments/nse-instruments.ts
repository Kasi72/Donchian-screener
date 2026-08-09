import type { UniverseInstrument } from "@/lib/domain/types";
import type { Candle } from "@/lib/market/provider";

export type NseInstrumentKind = "EQUITY" | "INDEX";

export interface ResolvedNseInstrument extends UniverseInstrument {
  symbol: string;
  yahooSymbol: string;
  providerSymbol: string;
  kind: NseInstrumentKind;
}

export type InstrumentResolution =
  | { status: "OK"; instrument: ResolvedNseInstrument }
  | { status: "INVALID_INSTRUMENT"; instrument?: undefined };

export type TickSizeResolution =
  | {
      status: "OK";
      tickSize: number;
      policy:
        | "nse-cm-price-band-2025-v1"
        | "nse-cm-legacy-0.05-v1"
        | "nse-index-metadata-v1";
      referencePrice: number | null;
    }
  | { status: "TICK_SIZE_UNRESOLVED" };

const BUILT_IN_INDEX_SYMBOLS = new Set([
  "^NSEI",
  "^NSEBANK",
  "^CRSLDX",
  "^INDIAVIX",
]);
const INDEX_ALIASES: Readonly<Record<string, string>> = {
  NIFTY: "^NSEI",
  NIFTY50: "^NSEI",
  BANKNIFTY: "^NSEBANK",
  NIFTYBANK: "^NSEBANK",
  INDIAVIX: "^INDIAVIX",
};
const EQUITY_SYMBOL = /^[A-Z0-9][A-Z0-9&-]{0,29}$/;
const PRICE_BAND_POLICY_EFFECTIVE = new Date("2025-04-15T00:00:00+05:30").getTime();

export function providerSymbolForCanonical(symbol: string): string | undefined {
  const canonical = symbol.trim().toUpperCase();
  const indexAlias = INDEX_ALIASES[canonical];
  if (indexAlias !== undefined) {
    return indexAlias;
  }
  if (BUILT_IN_INDEX_SYMBOLS.has(canonical)) {
    return canonical;
  }
  return EQUITY_SYMBOL.test(canonical) ? `${canonical}.NS` : undefined;
}

export function resolveCanonicalNseInstrument(
  input: Pick<UniverseInstrument, "symbol"> & Partial<UniverseInstrument>,
): InstrumentResolution {
  const symbol = input.symbol.trim().toUpperCase();
  const providerSymbol = providerSymbolForCanonical(symbol);
  if (providerSymbol === undefined) {
    return { status: "INVALID_INSTRUMENT" };
  }

  return {
    status: "OK",
    instrument: {
      symbol,
      yahooSymbol: providerSymbol,
      providerSymbol,
      kind: providerSymbol.startsWith("^") ? "INDEX" : "EQUITY",
      ...(input.companyName ? { companyName: input.companyName } : {}),
      ...(input.industry ? { industry: input.industry } : {}),
      ...(input.series ? { series: input.series } : {}),
      ...(input.isin ? { isin: input.isin } : {}),
    },
  };
}

function kolkataMonthStart(time: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(time));
  const year = Number(parts.find(({ type }) => type === "year")?.value);
  const month = Number(parts.find(({ type }) => type === "month")?.value);
  return Date.UTC(year, month - 1, 1) - (5 * 60 + 30) * 60_000;
}

function tickForReferencePrice(price: number): number | undefined {
  if (!Number.isFinite(price) || price <= 0) return undefined;
  if (price < 250) return 0.01;
  if (price <= 1_000) return 0.05;
  if (price <= 5_000) return 0.1;
  if (price <= 10_000) return 0.5;
  if (price <= 20_000) return 1;
  return 5;
}

export function resolveNseTickSize(
  instrument: ResolvedNseInstrument,
  candles: readonly Candle[],
  signalIndex: number,
): TickSizeResolution {
  if (instrument.kind === "INDEX") {
    return {
      status: "OK",
      tickSize: 0.05,
      policy: "nse-index-metadata-v1",
      referencePrice: null,
    };
  }

  const signal = candles[signalIndex];
  if (signal === undefined || !Number.isFinite(signal.time)) {
    return { status: "TICK_SIZE_UNRESOLVED" };
  }
  if (signal.time < PRICE_BAND_POLICY_EFFECTIVE) {
    return {
      status: "OK",
      tickSize: 0.05,
      policy: "nse-cm-legacy-0.05-v1",
      referencePrice: null,
    };
  }

  const cutoff = kolkataMonthStart(signal.time);
  const reference = candles
    .slice(0, signalIndex)
    .filter((candle) => candle.time < cutoff)
    .at(-1)?.close;
  if (reference === undefined) {
    return { status: "TICK_SIZE_UNRESOLVED" };
  }
  const tickSize = tickForReferencePrice(reference);
  if (tickSize === undefined) return { status: "TICK_SIZE_UNRESOLVED" };
  return {
    status: "OK",
    tickSize,
    policy: "nse-cm-price-band-2025-v1",
    referencePrice: reference,
  };
}
