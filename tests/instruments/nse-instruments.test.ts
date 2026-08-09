import { describe, expect, it } from "vitest";

import type { Candle } from "@/lib/market/provider";
import {
  resolveCanonicalNseInstrument,
  resolveNseTickSize,
} from "@/lib/instruments/nse-instruments";

function candle(time: string, close: number): Candle {
  return {
    time: new Date(time).getTime(),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
  };
}

describe("canonical NSE instruments", () => {
  it.each([
    ["^NSEI", "^NSEI"],
    ["^NSEBANK", "^NSEBANK"],
    ["^CRSLDX", "^CRSLDX"],
    ["^INDIAVIX", "^INDIAVIX"],
    ["NIFTY", "^NSEI"],
    ["BANKNIFTY", "^NSEBANK"],
    ["INDIAVIX", "^INDIAVIX"],
    ["reliance", "RELIANCE.NS"],
  ])("derives %s as provider symbol %s", (symbol, providerSymbol) => {
    expect(resolveCanonicalNseInstrument({ symbol, yahooSymbol: "MALICIOUS" })).toMatchObject({
      status: "OK",
      instrument: { symbol: symbol.toUpperCase(), providerSymbol },
    });
  });

  it.each(["TCS.NS", "^UNKNOWN", "../RELIANCE", "NIFTY26AUGFUT", "BANKNIFTY26AUG54000CE", ""])(
    "rejects the non-canonical identity %j",
    (symbol) => {
      expect(resolveCanonicalNseInstrument({ symbol, yahooSymbol: "TCS.NS" })).toEqual({
        status: "INVALID_INSTRUMENT",
      });
    },
  );
});

describe("NSE tick-size policy", () => {
  const signalTime = "2026-08-07T15:25:00+05:30";

  it.each([
    [249.99, 0.01],
    [250, 0.05],
    [1_000, 0.05],
    [1_000.01, 0.1],
    [5_000.01, 0.5],
    [10_000.01, 1],
    [20_000.01, 5],
  ])("resolves previous-month reference price %s to tick %s", (referencePrice, tickSize) => {
    const resolution = resolveNseTickSize(
      resolveCanonicalNseInstrument({ symbol: "ACME", yahooSymbol: "WRONG" }).instrument!,
      [
        candle("2026-07-31T15:25:00+05:30", referencePrice),
        candle(signalTime, referencePrice),
      ],
      1,
    );

    expect(resolution).toEqual({
      status: "OK",
      tickSize,
      policy: "nse-cm-price-band-2025-v1",
      referencePrice,
    });
  });

  it("returns a data status when an equity tick cannot be resolved", () => {
    const instrument = resolveCanonicalNseInstrument({
      symbol: "ACME",
      yahooSymbol: "ACME.NS",
    }).instrument!;

    expect(resolveNseTickSize(instrument, [candle(signalTime, 500)], 0)).toEqual({
      status: "TICK_SIZE_UNRESOLVED",
    });
  });

  it("uses explicit fixed metadata for built-in indices", () => {
    const instrument = resolveCanonicalNseInstrument({
      symbol: "^NSEI",
      yahooSymbol: "WRONG",
    }).instrument!;

    expect(resolveNseTickSize(instrument, [candle(signalTime, 25_000)], 0)).toEqual({
      status: "OK",
      tickSize: 0.05,
      policy: "nse-index-metadata-v1",
      referencePrice: null,
    });
  });

  it("treats a common index alias as an index for tick metadata", () => {
    const instrument = resolveCanonicalNseInstrument({
      symbol: "NIFTY",
      yahooSymbol: "MALICIOUS",
    }).instrument!;

    expect(instrument).toMatchObject({ kind: "INDEX", providerSymbol: "^NSEI" });
    expect(resolveNseTickSize(instrument, [candle(signalTime, 25_000)], 0)).toMatchObject({
      status: "OK",
      policy: "nse-index-metadata-v1",
    });
  });
});
