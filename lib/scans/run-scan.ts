import type { UniverseInstrument } from "@/lib/domain/types";
import type { MarketDataProvider, Timeframe } from "@/lib/market/provider";
import { scanSymbol, type ScanItemResult } from "@/lib/signals/scan-symbol";

export const SCAN_CONCURRENCY = 6;
export const DEFAULT_ITEM_TIMEOUT_MS = 15_000;

export interface RunScanOptions {
  now?: Date;
  signal?: AbortSignal;
  itemTimeoutMs?: number;
  includeMarketContext?: boolean;
  benchmarkSymbol?: string;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Scan aborted", "AbortError");
}

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

export async function runScan(
  instruments: readonly UniverseInstrument[],
  timeframe: Timeframe,
  provider: MarketDataProvider,
  options: RunScanOptions = {},
): Promise<ScanItemResult[]> {
  const results = new Array<ScanItemResult>(instruments.length);
  const itemTimeoutMs = Math.max(
    1,
    Math.floor(options.itemTimeoutMs ?? DEFAULT_ITEM_TIMEOUT_MS),
  );
  let nextIndex = 0;
  const benchmarkSymbol = options.benchmarkSymbol ?? "^NSEI";
  let benchmarkResponse: Awaited<ReturnType<MarketDataProvider["getCandles"]>> | undefined;
  let benchmarkCandles: Awaited<ReturnType<MarketDataProvider["getCandles"]>>["candles"] | undefined;
  if (options.includeMarketContext && !options.signal?.aborted) {
    try {
      const benchmark = await provider.getCandles(benchmarkSymbol, timeframe, options.now, {
        signal: options.signal,
        deadlineMs: Date.now() + itemTimeoutMs,
      });
      if (benchmark.status === "OK") {
        benchmarkResponse = benchmark;
        benchmarkCandles = benchmark.candles;
      }
    } catch {
      // Market context is deliberately non-gating. The per-symbol scan remains
      // available and labels the context as unavailable.
    }
  }

  async function scanOne(instrument: UniverseInstrument): Promise<ScanItemResult> {
    if (options.signal?.aborted) throw abortReason(options.signal);
    const controller = new AbortController();
    const onRequestAbort = () => controller.abort(abortReason(options.signal!));
    options.signal?.addEventListener("abort", onRequestAbort, { once: true });
    const deadlineMs = Date.now() + itemTimeoutMs;
    const timeout = setTimeout(
      () => controller.abort(new DOMException("Provider request timed out", "TimeoutError")),
      itemTimeoutMs,
    );

    try {
      const symbolProvider = benchmarkResponse && instrument.symbol.trim().toUpperCase() === benchmarkSymbol
        ? { getCandles: async () => benchmarkResponse! }
        : provider;
      return await scanSymbol(instrument, timeframe, symbolProvider, {
        now: options.now,
        signal: controller.signal,
        deadlineMs,
        ...(benchmarkCandles ? { benchmarkCandles, benchmarkSymbol } : {}),
      });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onRequestAbort);
    }
  }

  async function worker(): Promise<void> {
    while (nextIndex < instruments.length) {
      if (options.signal?.aborted) throw abortReason(options.signal);
      const index = nextIndex;
      nextIndex += 1;
      const instrument = instruments[index];
      try {
        results[index] = await scanOne(instrument);
      } catch (error) {
        if (isAbortLike(error)) throw error;
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
