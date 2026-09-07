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
  "signalLow",
  "signalClose",
  "signalOpen",
  "signalHigh",
  "currentLdcTick",
  "previousLdcTick",
  "signalLowTick",
  "signalCandleTime",
  "windowStartTime",
  "windowEndTime",
  "previousWindowStartTime",
  "previousWindowEndTime",
  "providerAsOf",
  "rolloverTicks",
  "touchDistanceTicks",
  "periodCandidateCount",
  "periodAudit",
  "windowAudit",
  "anchorIndex",
  "anchorBarsAgo",
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
  "confirmationVersion",
  "confirmationScore",
  "confirmationGrade",
  "closeLocation",
  "lowerWickRatio",
  "atrRecovery",
  "volumeZScore",
  "changePointScore",
  "validPeriodCount",
  "validPeriodMin",
  "validPeriodMax",
  "confirmationReasons",
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
  signalLow: z.number().finite().optional(),
  signalClose: z.number().finite().optional(),
  signalOpen: z.number().finite().optional(),
  signalHigh: z.number().finite().optional(),
  signalLowTick: z.number().int().nonnegative().optional(),
  currentLdcTick: z.number().int().nonnegative().optional(),
  previousLdcTick: z.number().int().nonnegative().optional(),
  signalCandleTime: z.number().finite().optional(),
  windowStartTime: z.number().finite().optional(),
  windowEndTime: z.number().finite().optional(),
  previousWindowStartTime: z.number().finite().optional(),
  previousWindowEndTime: z.number().finite().optional(),
  providerAsOf: z.number().finite().optional(),
  rolloverTicks: z.number().int().nonnegative().optional(),
  touchDistanceTicks: z.number().int().nonnegative().optional(),
  periodCandidateCount: z.number().int().positive().optional(),
  periodAudit: z.array(z.object({
    period: z.number().int().positive(),
    currentLdc: z.number().finite().nullable(),
    previousLdc: z.number().finite().nullable(),
    currentLdcTick: z.number().int().nonnegative().nullable(),
    previousLdcTick: z.number().int().nonnegative().nullable(),
    signalLowTick: z.number().int().nonnegative().nullable(),
    touchPassed: z.boolean(),
    rolloverPassed: z.boolean(),
    valid: z.boolean(),
  })).optional(),
  windowAudit: z.object({
    expectedSessions: z.number().int().nonnegative(),
    observedSessions: z.number().int().nonnegative(),
    missingSessions: z.number().int().nonnegative(),
    complete: z.boolean(),
  }).optional(),
  anchorIndex: z.number().int().nonnegative().optional(),
  anchorBarsAgo: z.number().int().positive().optional(),
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
  confirmation: z.object({
    version: z.enum(["confirmation-v1", "confirmation-v2"]),
    score: z.number().finite(),
    grade: z.enum(["STRONG", "CONFIRMED", "CORE_ONLY"]),
    closeLocation: z.number().finite(),
    lowerWickRatio: z.number().finite(),
    atrRecovery: z.number().finite(),
    volumeZScore: z.number().finite().nullable(),
    changePointScore: z.number().finite(),
    validPeriodCount: z.number().int().nonnegative(),
    validPeriodRange: z.tuple([z.number().int(), z.number().int()]),
    higherTimeframe: z.literal("UNAVAILABLE"),
    relativeStrength: z.literal("UNAVAILABLE"),
    reasons: z.array(z.string()),
  }).optional(),
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
    "CALCULATION_ERROR",
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
      signalLow: recommendation?.signalLow,
      signalClose: recommendation?.signalClose,
      signalOpen: recommendation?.signalOpen,
      signalHigh: recommendation?.signalHigh,
      currentLdcTick: recommendation?.currentLdcTick,
      previousLdcTick: recommendation?.previousLdcTick,
      signalLowTick: recommendation?.signalLowTick,
      signalCandleTime: recommendation?.signalCandleTime ?? recommendation?.signalTime,
      windowStartTime: recommendation?.windowStartTime,
      windowEndTime: recommendation?.windowEndTime,
      previousWindowStartTime: recommendation?.previousWindowStartTime,
      previousWindowEndTime: recommendation?.previousWindowEndTime,
      providerAsOf: recommendation?.providerAsOf ?? recommendation?.dataAsOf,
      rolloverTicks: recommendation?.rolloverTicks,
      touchDistanceTicks: recommendation?.touchDistanceTicks,
      periodCandidateCount: recommendation?.periodCandidateCount,
      periodAudit: recommendation?.periodAudit
        ? JSON.stringify(recommendation.periodAudit)
        : undefined,
      windowAudit: recommendation?.windowAudit
        ? JSON.stringify(recommendation.windowAudit)
        : undefined,
      anchorIndex: recommendation?.anchorIndex,
      anchorBarsAgo: recommendation?.anchorBarsAgo,
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
      confirmationVersion: recommendation?.confirmation?.version,
      confirmationScore: recommendation?.confirmation?.score,
      confirmationGrade: recommendation?.confirmation?.grade,
      closeLocation: recommendation?.confirmation?.closeLocation,
      lowerWickRatio: recommendation?.confirmation?.lowerWickRatio,
      atrRecovery: recommendation?.confirmation?.atrRecovery,
      volumeZScore: recommendation?.confirmation?.volumeZScore,
      changePointScore: recommendation?.confirmation?.changePointScore,
      validPeriodCount: recommendation?.confirmation?.validPeriodCount,
      validPeriodMin: recommendation?.confirmation?.validPeriodRange[0],
      validPeriodMax: recommendation?.confirmation?.validPeriodRange[1],
      confirmationReasons: recommendation?.confirmation?.reasons.join("; "),
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
