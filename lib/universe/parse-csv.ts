import Papa from "papaparse";
import { z } from "zod";
import type { UniverseInstrument, UniverseParseResult } from "@/lib/domain/types";

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

function normalizedRow(row: CsvRow): Record<string, unknown> {
  return {
    symbol: trim(row.symbol),
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

  parsed.data.forEach((row, index) => {
    const rowNumber = index + 2;
    const parseError = parseErrorsByRow.get(rowNumber);
    const rawSymbol = trim(row.symbol);

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
    if (normalizedSeries && normalizedSeries !== "EQ") {
      rejected.push({ row: rowNumber, symbol, reason: "Series must be EQ" });
      return;
    }

    if (symbols.has(symbol)) {
      duplicateCount += 1;
      return;
    }
    symbols.add(symbol);

    instruments.push({
      symbol,
      yahooSymbol: `${symbol}.NS`,
      ...(companyName ? { companyName } : {}),
      ...(industry ? { industry } : {}),
      ...(normalizedSeries ? { series: normalizedSeries } : {}),
      ...(isin ? { isin } : {}),
    });
  });

  return { instruments, rejected, duplicateCount, totalRows: parsed.data.length };
}
