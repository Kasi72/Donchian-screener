import type { UniverseInstrument } from "@/lib/domain/types";
import type { MarketDataProvider, Timeframe } from "@/lib/market/provider";
import { scanSymbol, type ScanItemResult } from "@/lib/signals/scan-symbol";

export const SCAN_CONCURRENCY = 6;

export async function runScan(
  instruments: readonly UniverseInstrument[],
  timeframe: Timeframe,
  provider: MarketDataProvider,
  now?: Date,
): Promise<ScanItemResult[]> {
  const results = new Array<ScanItemResult>(instruments.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < instruments.length) {
      const index = nextIndex;
      nextIndex += 1;
      const instrument = instruments[index];
      try {
        results[index] = await scanSymbol(
          instrument,
          timeframe,
          provider,
          now,
        );
      } catch {
        results[index] = {
          symbol: instrument.symbol,
          status: "PROVIDER_ERROR",
          message: `Scan failed for ${instrument.symbol}.`,
        };
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(SCAN_CONCURRENCY, instruments.length) },
      () => worker(),
    ),
  );
  return results;
}
