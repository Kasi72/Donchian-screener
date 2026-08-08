import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { createMarketDataProvider } from "@/lib/market/provider-factory";
import { runScan } from "@/lib/scans/run-scan";

const instrumentSchema = z.object({
  symbol: z.string().trim().min(1),
  yahooSymbol: z.string().trim().min(1),
  companyName: z.string().optional(),
  industry: z.string().optional(),
  series: z.string().optional(),
  isin: z.string().optional(),
});

const scanRequestSchema = z.object({
  instruments: z.array(instrumentSchema).min(1),
  timeframe: z.enum(["5m", "15m", "1h", "1d", "1wk", "1mo"]),
});

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid scan request" }, { status: 400 });
  }

  const parsed = scanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid scan request" }, { status: 400 });
  }

  const provider = await createMarketDataProvider();
  const results = await runScan(
    parsed.data.instruments,
    parsed.data.timeframe,
    provider,
  );
  return NextResponse.json({ results });
}
