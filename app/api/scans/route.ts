import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { createMarketDataProvider } from "@/lib/market/provider-factory";
import { runScan } from "@/lib/scans/run-scan";
import {
  MAX_SCAN_BODY_BYTES,
  MAX_SCAN_ITEMS,
  PayloadTooLargeError,
  readBoundedJson,
} from "@/lib/server/request-limits";

const instrumentSchema = z.object({
  symbol: z.string().trim().min(1),
  companyName: z.string().optional(),
  industry: z.string().optional(),
  series: z.string().optional(),
  isin: z.string().optional(),
});

const scanRequestSchema = z.object({
  instruments: z.array(instrumentSchema).min(1).max(MAX_SCAN_ITEMS),
  timeframe: z.enum(["5m", "15m", "1h", "1d", "1wk", "1mo"]),
});

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await readBoundedJson(request, MAX_SCAN_BODY_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: "Scan request is too large" }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid scan request" }, { status: 400 });
  }

  const parsed = scanRequestSchema.safeParse(body);
  if (!parsed.success) {
    const tooMany = Array.isArray((body as { instruments?: unknown })?.instruments) &&
      (body as { instruments: unknown[] }).instruments.length > MAX_SCAN_ITEMS;
    return NextResponse.json(
      { error: tooMany ? "Scan has too many instruments" : "Invalid scan request" },
      { status: tooMany ? 413 : 400 },
    );
  }

  const seen = new Set<string>();
  const instruments = parsed.data.instruments.filter((instrument) => {
    const symbol = instrument.symbol.trim().toUpperCase();
    if (seen.has(symbol)) return false;
    seen.add(symbol);
    instrument.symbol = symbol;
    return true;
  });

  const provider = await createMarketDataProvider();
  const results = await runScan(
    instruments,
    parsed.data.timeframe,
    provider,
    { signal: request.signal },
  );
  return NextResponse.json({ results });
}
