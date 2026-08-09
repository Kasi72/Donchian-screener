import Papa from "papaparse";
import { z } from "zod";
import type { UniverseInstrument, UniverseParseResult } from "@/lib/domain/types";
import { providerSymbolForCanonical } from "@/lib/instruments/nse-instruments";

type CsvRow = Record<string, string | undefined>;

const rowSchema = z.object({
  symbol: z.string({ error: "Symbol is required" }).trim().min(1, "Symbol is required"),
  series: z.string().optional(),
  companyName: z.string().optional(),
  industry: z.string().optional(),
  isin: z.string().optional(),
});

const normalizeHeader = (header: string) => header.trim().toLowerCase().replace(/\s+/g, " ");
const trim = (value: string | undefined) => value?.trim() || undefined;
const canonicalizeSymbol = (value: string | undefined) => trim(value)?.toUpperCase();
// NSE derivative contracts end in a dated `FUT` suffix or a dated strike followed by `CE`/`PE`.
const derivativeContractPattern = /\d{2}[A-Z]{3}(?:FUT|\d+(?:\.\d+)?(?:CE|PE))$/;

function normalizedRow(row: CsvRow): Record<string, unknown> {
  return {
    symbol: canonicalizeSymbol(row.symbol),
    series: trim(row.series),
    companyName: trim(row["company name"]),
    industry: trim(row.industry),
    isin: trim(row["isin code"]),
  };
}

export function parseUniverseCsv(csv: string): UniverseParseResult {
  const parsed = Papa.parse<CsvRow>(csv, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
  });
  const parseErrorsByRow = new Map<number, string>();

  for (const error of parsed.errors) {
    if (error.code === "UndetectableDelimiter") {
      continue;
    }
    const row = (error.row ?? 0) + 2;
    parseErrorsByRow.set(row, error.message);
  }

  const instruments: UniverseInstrument[] = [];
  const rejected: UniverseParseResult["rejected"] = [];
  const symbols = new Set<string>();
  let duplicateCount = 0;
  const hasSeriesHeader = parsed.meta.fields?.includes("series") ?? false;

  parsed.data.forEach((row, index) => {
    const rowNumber = index + 2;
    const parseError = parseErrorsByRow.get(rowNumber);
    const rawSymbol = canonicalizeSymbol(row.symbol);

    if (parseError) {
      rejected.push({ row: rowNumber, ...(rawSymbol ? { symbol: rawSymbol } : {}), reason: parseError });
      return;
    }

    const validation = rowSchema.safeParse(normalizedRow(row));
    if (!validation.success) {
      rejected.push({
        row: rowNumber,
        ...(rawSymbol ? { symbol: rawSymbol } : {}),
        reason: validation.error.issues[0].message,
      });
      return;
    }

    const { symbol, series, companyName, industry, isin } = validation.data;
    const normalizedSeries = series?.toUpperCase();
    const mappedSymbol = providerSymbolForCanonical(symbol);
    const isKnownIndex = mappedSymbol?.startsWith("^") === true;
    if (hasSeriesHeader && normalizedSeries !== "EQ" && !(normalizedSeries === undefined && isKnownIndex)) {
      rejected.push({ row: rowNumber, symbol, reason: "Series must be EQ" });
      return;
    }

    if (derivativeContractPattern.test(symbol)) {
      rejected.push({ row: rowNumber, symbol, reason: "Derivative contracts are not supported" });
      return;
    }

    if (symbols.has(symbol)) {
      duplicateCount += 1;
      return;
    }
    symbols.add(symbol);

    const yahooSymbol = mappedSymbol;
    if (yahooSymbol === undefined) {
      rejected.push({ row: rowNumber, symbol, reason: "Unsupported NSE instrument identity" });
      return;
    }

    instruments.push({
      symbol,
      yahooSymbol,
      ...(companyName ? { companyName } : {}),
      ...(industry ? { industry } : {}),
      ...(normalizedSeries ? { series: normalizedSeries } : {}),
      ...(isin ? { isin } : {}),
    });
  });

  return { instruments, rejected, duplicateCount, totalRows: parsed.data.length };
}
