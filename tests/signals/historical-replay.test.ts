import { expect, it, vi } from "vitest";
import * as evidence from "@/lib/signals/sequential-evidence";
import { replayHistoricalSignals } from "@/lib/signals/historical-replay";
import { scanSymbol } from "@/lib/signals/scan-symbol";

function fixture() {
  const candle = (time: number, low = 110, high = 112, close = 111) => ({ time: time * 60_000, open: close, low, high, close, volume: 1000 });
  const candles = Array.from({ length: 100 }, (_, i) => candle(i));
  candles[85] = candle(85, 90, 110, 100);
  candles[86] = candle(86, 108, 114, 112);
  candles[87] = candle(87, 109, 116, 114);
  candles[91] = candle(91, 95.01, 108, 100);
  candles[92] = candle(92, 108, 111, 110);
  candles[93] = candle(93, 109, 112, 111);
  candles[99] = candle(99, 95.02, 108, 102);
  return candles;
}

it("replays the production signal engine with prefix-only data", async () => {
  const candles = fixture();
  const instrument = { symbol: "RELIANCE" };
  const direct = await scanSymbol(instrument, "1h", { getCandles: async () => ({
    status: "OK", candles, asOf: candles[99].time, adjustmentMode: "RAW",
  }) });
  const replay = await replayHistoricalSignals(instrument, "1h", candles, { slippageBps: 0, feeBps: 0 });
  const signal = replay.trades.find((t) => t.signalIndex === 99);
  expect(signal?.recommendation).toEqual(direct.recommendation);
  expect(signal?.outcome.outcome).toBe("NO_ENTRY_DATA");
  const future = [...candles, { time: 100 * 60_000, open: 102, high: 120, low: 101, close: 115, volume: 1000 }];
  const extended = await replayHistoricalSignals(instrument, "1h", future, { slippageBps: 0, feeBps: 0 });
  expect(extended.trades.find((t) => t.signalIndex === 99)?.recommendation).toEqual(signal?.recommendation);
  expect(extended.trades.find((t) => t.signalIndex === 99)?.outcome.outcome).toBe("TARGET1");
});

it("rejects duplicate or malformed history instead of changing candle counts", async () => {
  const candles = fixture();
  candles[99].time = candles[98].time;
  await expect(replayHistoricalSignals({ symbol: "RELIANCE" }, "1d", candles, { slippageBps: 0, feeBps: 0 })).rejects.toThrow();
});

it("distinguishes a calculation defect from a market-data provider failure", async () => {
  const candles = fixture();
  const spy = vi.spyOn(evidence, "calculateSequentialEvidence").mockImplementation(() => { throw new Error("test calculation failure"); });
  try {
    const result = await scanSymbol({ symbol: "RELIANCE" }, "1h", { getCandles: async () => ({
      status: "OK", candles, asOf: candles[99].time, adjustmentMode: "RAW",
    }) });
    expect(result.status).toBe("CALCULATION_ERROR");
    await expect(replayHistoricalSignals({ symbol: "RELIANCE" }, "1h", candles, { slippageBps: 0, feeBps: 0 })).rejects.toThrow("Replay calculation failed");
  } finally { spy.mockRestore(); }
});
