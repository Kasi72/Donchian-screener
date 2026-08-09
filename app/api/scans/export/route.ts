import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import type { ScanItemResult } from "@/lib/signals/scan-symbol";
import {
  MAX_EXPORT_BODY_BYTES,
  MAX_EXPORT_ITEMS,
  PayloadTooLargeError,
  readBoundedJson,
} from "@/lib/server/request-limits";

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
  "adjustmentMode",
  "tickSize",
  "tickPolicy",
  "reactionHigh",
  "rewardRisk",
  "scoreVersion",
  "score",
  "higherTimeframeInput",
  "anchorRationale",
  "companyName",
  "industry",
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
  adjustmentMode: z.enum(["RAW", "BACK_ADJUSTED"]),
  tickSize: z.number().positive().finite(),
  tickPolicy: z.enum([
    "nse-cm-price-band-2025-v1",
    "nse-cm-legacy-0.05-v1",
    "nse-index-metadata-v1",
  ]),
  reactionHigh: z.number().finite(),
  rewardRisk: z.number().finite(),
  scoreVersion: z.literal("structural-v1"),
  score: z.number().finite(),
  scoreComponents: z.object({
    prominence: z.number().finite(),
    recovery: z.number().finite(),
    recency: z.number().finite(),
    retests: z.number().finite(),
    relativeVolume: z.number().finite(),
    higherTimeframeAgreement: z.number().finite(),
  }),
  higherTimeframeInput: z.literal("NEUTRAL_UNAVAILABLE"),
  anchorRationale: z.string(),
  companyName: z.string().optional(),
  industry: z.string().optional(),
});

const buyResultSchema = z.object({
  symbol: z.string(),
  status: z.literal("BUY"),
  recommendation: recommendationSchema,
  message: z.string().optional(),
});

const nonBuyResultSchema = z.object({
  symbol: z.string(),
  status: z.enum([
    "NO_SIGNAL",
    "OK",
    "INSUFFICIENT_HISTORY",
    "SYMBOL_NOT_FOUND",
    "PROVIDER_RATE_LIMITED",
    "STALE_DATA",
    "INVALID_CANDLES",
    "PROVIDER_ERROR",
    "DATA_QUALITY_LIMITATION",
    "PROVIDER_TIMEOUT",
    "INVALID_INSTRUMENT",
    "TICK_SIZE_UNRESOLVED",
  ]),
  recommendation: z.never().optional(),
  message: z.string().optional(),
});

const resultSchema = z
  .discriminatedUnion("status", [buyResultSchema, nonBuyResultSchema])
  .superRefine((result, context) => {
    if (
      result.status === "BUY" &&
      result.symbol !== result.recommendation.symbol
    ) {
      context.addIssue({
        code: "custom",
        path: ["recommendation", "symbol"],
        message: "Recommendation symbol must match row symbol",
      });
    }
  });

const exportRequestSchema = z.object({ results: z.array(resultSchema).max(MAX_EXPORT_ITEMS) });

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
      adjustmentMode: recommendation?.adjustmentMode,
      tickSize: recommendation?.tickSize,
      tickPolicy: recommendation?.tickPolicy,
      reactionHigh: recommendation?.reactionHigh,
      rewardRisk: recommendation?.rewardRisk,
      scoreVersion: recommendation?.scoreVersion,
      score: recommendation?.score,
      higherTimeframeInput: recommendation?.higherTimeframeInput,
      anchorRationale: recommendation?.anchorRationale,
      companyName: recommendation?.companyName,
      industry: recommendation?.industry,
      message: result.message,
    };
    return CSV_HEADERS.map((header) => escapeCsvCell(values[header])).join(",");
  });

  return [CSV_HEADERS.join(","), ...rows].join("\r\n");
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await readBoundedJson(request, MAX_EXPORT_BODY_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: "Export request is too large" }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid export request" }, { status: 400 });
  }

  const parsed = exportRequestSchema.safeParse(body);
  if (!parsed.success) {
    const tooMany = Array.isArray((body as { results?: unknown })?.results) &&
      (body as { results: unknown[] }).results.length > MAX_EXPORT_ITEMS;
    return NextResponse.json(
      { error: tooMany ? "Export has too many rows" : "Invalid export request" },
      { status: tooMany ? 413 : 400 },
    );
  }

  return new Response(scanResultsToCsv(parsed.data.results), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="scan-results.csv"',
    },
  });
}
