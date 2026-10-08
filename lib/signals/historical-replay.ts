import type { UniverseInstrument } from "@/lib/domain/types";
import type { Candle, Timeframe } from "@/lib/market/provider";
import { scanSymbol } from "./scan-symbol";
import { evaluateTradeOutcome, summarizeTradeOutcomes, type ExecutionOptions } from "./trade-outcome";
import { predictionObservation } from "./prediction-observation";

/** Replays already-completed, raw candles through the production signal engine.
 * No alternative Python implementation of pivots, tick policy or gates is used.
 * The caller must supply the correct exchange sessions and adjustment convention.
 */
export async function replayHistoricalSignals(
  instrument: UniverseInstrument, timeframe: Timeframe, candles: readonly Candle[], execution: ExecutionOptions,
) {
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (![c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) || c.low <= 0 ||
      c.volume < 0 || c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close) ||
      (i > 0 && c.time <= candles[i - 1].time)) throw new RangeError("Replay requires valid, strictly ordered OHLCV");
  }
  const trades = [];
  const signals = [];
  const statusCounts: Record<string, number> = {};
  let nextSignalIndex = 0;
  for (let i = 20; i < candles.length; i++) {
    // Prefix-only provider is the leakage barrier; future candles are visible
    // solely to the separate outcome evaluator after the signal is frozen.
    const result = await scanSymbol(instrument, timeframe, {
      getCandles: async () => ({ status: "OK", candles: candles.slice(0, i + 1), asOf: candles[i].time, adjustmentMode: "RAW" }),
    });
    statusCounts[result.status] = (statusCounts[result.status] ?? 0) + 1;
    if (result.status === "PROVIDER_ERROR" || result.status === "CALCULATION_ERROR") throw new Error(`Replay calculation failed for ${instrument.symbol} at ${candles[i].time}`);
    if (!result.recommendation) continue;
    signals.push(predictionObservation(candles, i, result.recommendation, execution));
    if (i < nextSignalIndex) continue;
    const outcome = evaluateTradeOutcome(candles, i, result.recommendation, execution);
    trades.push({ signalIndex: i, recommendation: result.recommendation, outcome });
    if (outcome.exitIndex !== null) nextSignalIndex = outcome.exitIndex;
    else if (outcome.outcome === "CENSORED") nextSignalIndex = candles.length;
    // A fresh signal at an exit day's close may enter on the following open.
  }
  return { symbol: instrument.symbol, timeframe, statusCounts, execution, signals, trades,
    summary: summarizeTradeOutcomes(trades.map((t) => t.outcome)),
    calibration: "NOT_FITTED" as const };
}
