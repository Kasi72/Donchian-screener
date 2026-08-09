import { describe, expect, it } from "vitest";
import { parseUniverseCsv } from "@/lib/universe/parse-csv";

describe("parseUniverseCsv", () => {
  it("normalizes five-column NSE rows into unique Yahoo instruments", () => {
    const result = parseUniverseCsv(` Company Name , Industry , Symbol , Series , ISIN Code
  Reliance Industries Ltd , Energy , RELIANCE , EQ , INE002A01018
Tata Consultancy Services, IT Services, TCS, EQ, INE467B01029`);

    expect(result).toEqual({
      instruments: [
        {
          symbol: "RELIANCE",
          yahooSymbol: "RELIANCE.NS",
          companyName: "Reliance Industries Ltd",
          industry: "Energy",
          series: "EQ",
          isin: "INE002A01018",
        },
        {
          symbol: "TCS",
          yahooSymbol: "TCS.NS",
          companyName: "Tata Consultancy Services",
          industry: "IT Services",
          series: "EQ",
          isin: "INE467B01029",
        },
      ],
      rejected: [],
      duplicateCount: 0,
      totalRows: 2,
    });
  });

  it("accepts a Symbol-only CSV and maps every symbol to NSE Yahoo notation", () => {
    const result = parseUniverseCsv(`Symbol
INFY
HDFCBANK`);

    expect(result).toEqual({
      instruments: [
        { symbol: "INFY", yahooSymbol: "INFY.NS" },
        { symbol: "HDFCBANK", yahooSymbol: "HDFCBANK.NS" },
      ],
      rejected: [],
      duplicateCount: 0,
      totalRows: 2,
    });
  });

  it("rejects recognizable futures and options contracts from a Symbol-only CSV", () => {
    const result = parseUniverseCsv(`Symbol
NIFTY26AUGFUT
BANKNIFTY26AUG54000CE
RELIANCE`);

    expect(result).toEqual({
      instruments: [{ symbol: "RELIANCE", yahooSymbol: "RELIANCE.NS" }],
      rejected: [
        { row: 2, symbol: "NIFTY26AUGFUT", reason: "Derivative contracts are not supported" },
        { row: 3, symbol: "BANKNIFTY26AUG54000CE", reason: "Derivative contracts are not supported" },
      ],
      duplicateCount: 0,
      totalRows: 3,
    });
  });

  it("canonicalizes symbols before mapping and duplicate detection", () => {
    const result = parseUniverseCsv(`Symbol
infy
INFY
Tcs`);

    expect(result).toEqual({
      instruments: [
        { symbol: "INFY", yahooSymbol: "INFY.NS" },
        { symbol: "TCS", yahooSymbol: "TCS.NS" },
      ],
      rejected: [],
      duplicateCount: 1,
      totalRows: 3,
    });
  });

  it("filters non-EQ rows, deduplicates symbols, and rejects bad rows without discarding valid rows", () => {
    const result = parseUniverseCsv(`Symbol,Series
  INFY  , EQ ${""}
INFY,EQ
NIFTY,BE
   ,EQ
TCS,EQ`);

    expect(result).toEqual({
      instruments: [
        { symbol: "INFY", yahooSymbol: "INFY.NS", series: "EQ" },
        { symbol: "TCS", yahooSymbol: "TCS.NS", series: "EQ" },
      ],
      rejected: [
        { row: 4, symbol: "NIFTY", reason: "Series must be EQ" },
        { row: 5, reason: "Symbol is required" },
      ],
      duplicateCount: 1,
      totalRows: 5,
    });
  });

  it("requires every row to be EQ when the Series header is present", () => {
    const result = parseUniverseCsv(`Symbol,Series
INFY,
TCS,${"   "}
RELIANCE,EQ`);

    expect(result).toEqual({
      instruments: [
        { symbol: "RELIANCE", yahooSymbol: "RELIANCE.NS", series: "EQ" },
      ],
      rejected: [
        { row: 2, symbol: "INFY", reason: "Series must be EQ" },
        { row: 3, symbol: "TCS", reason: "Series must be EQ" },
      ],
      duplicateCount: 0,
      totalRows: 3,
    });
  });

  it("maps only the explicit built-in NSE indices without adding an equity suffix", () => {
    const result = parseUniverseCsv(`Symbol
^NSEI
^NSEBANK
^CRSLDX
^INDIAVIX
RELIANCE`);

    expect(result.instruments.map(({ symbol, yahooSymbol }) => ({ symbol, yahooSymbol }))).toEqual([
      { symbol: "^NSEI", yahooSymbol: "^NSEI" },
      { symbol: "^NSEBANK", yahooSymbol: "^NSEBANK" },
      { symbol: "^CRSLDX", yahooSymbol: "^CRSLDX" },
      { symbol: "^INDIAVIX", yahooSymbol: "^INDIAVIX" },
      { symbol: "RELIANCE", yahooSymbol: "RELIANCE.NS" },
    ]);
  });

  it("maps common index aliases and permits their blank Series cells", () => {
    const result = parseUniverseCsv(`Symbol,Series
NIFTY,
BANKNIFTY,
INDIAVIX,`);

    expect(result).toEqual({
      instruments: [
        { symbol: "NIFTY", yahooSymbol: "^NSEI" },
        { symbol: "BANKNIFTY", yahooSymbol: "^NSEBANK" },
        { symbol: "INDIAVIX", yahooSymbol: "^INDIAVIX" },
      ],
      rejected: [],
      duplicateCount: 0,
      totalRows: 3,
    });
  });
});
