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
});
