import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import type { ScanItemResult } from "@/lib/signals/scan-symbol";

const CSV_HEADERS = [
  "symbol",
  "yahooSymbol",
  "timeframe",
  "status",
  "recommendation",
  "signalTime",
  "autoPeriod",
  "probability",
  "entry",
  "stop",
  "target1",
  "target2",
  "currentLdc",
  "previousLdc",
  "anchorTime",
  "strategyVersion",
  "dataAsOf",
  "message",
] as const;

const recommendationSchema = z.object({
  recommendation: z.literal("BUY"),
  symbol: z.string(),
  yahooSymbol: z.string(),
  timeframe: z.enum(["5m", "15m", "1h", "1d", "1wk", "1mo"]),
  signalTime: z.number().finite(),
  autoPeriod: z.number().int().positive(),
  probability: z.null(),
  entry: z.number().finite(),
  stop: z.number().finite(),
  target1: z.number().finite(),
  target2: z.number().finite(),
  currentLdc: z.number().finite(),
  previousLdc: z.number().finite(),
  anchorTime: z.number().finite(),
  strategyVersion: z.literal("rules-v1"),
  dataAsOf: z.number().finite(),
});

const resultSchema = z.object({
  symbol: z.string(),
  status: z.enum([
    "BUY",
    "NO_SIGNAL",
    "OK",
    "INSUFFICIENT_HISTORY",
    "SYMBOL_NOT_FOUND",
    "PROVIDER_RATE_LIMITED",
    "STALE_DATA",
    "INVALID_CANDLES",
    "PROVIDER_ERROR",
  ]),
  recommendation: recommendationSchema.optional(),
  message: z.string().optional(),
});

const exportRequestSchema = z.object({ results: z.array(resultSchema) });

function escapeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function scanResultsToCsv(results: readonly ScanItemResult[]): string {
  const rows = results.map((result) => {
    const recommendation = result.recommendation;
    const values: Record<(typeof CSV_HEADERS)[number], unknown> = {
      symbol: result.symbol,
      yahooSymbol: recommendation?.yahooSymbol,
      timeframe: recommendation?.timeframe,
      status: result.status,
      recommendation: recommendation?.recommendation,
      signalTime: recommendation?.signalTime,
      autoPeriod: recommendation?.autoPeriod,
      probability: recommendation?.probability,
      entry: recommendation?.entry,
      stop: recommendation?.stop,
      target1: recommendation?.target1,
      target2: recommendation?.target2,
      currentLdc: recommendation?.currentLdc,
      previousLdc: recommendation?.previousLdc,
      anchorTime: recommendation?.anchorTime,
      strategyVersion: recommendation?.strategyVersion,
      dataAsOf: recommendation?.dataAsOf,
      message: result.message,
    };
    return CSV_HEADERS.map((header) => escapeCsvCell(values[header])).join(",");
  });

  return [CSV_HEADERS.join(","), ...rows].join("\r\n");
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid export request" }, { status: 400 });
  }

  const parsed = exportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid export request" }, { status: 400 });
  }

  return new Response(scanResultsToCsv(parsed.data.results), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="scan-results.csv"',
    },
  });
}
