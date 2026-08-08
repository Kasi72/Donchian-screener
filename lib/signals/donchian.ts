import type { Candle } from "@/lib/market/provider";
import { DEFAULT_TICK_SIZE } from "./strategy-config";

function assertPeriod(period: number): void {
  if (!Number.isInteger(period) || period <= 0) {
    throw new RangeError("Donchian period must be a positive integer");
  }
}

function assertEndIndex(candles: Candle[], endIndex: number): void {
  if (
    !Number.isInteger(endIndex) ||
    endIndex < 0 ||
    endIndex >= candles.length
  ) {
    throw new RangeError("Donchian end index is outside candle history");
  }
}

function toTickUnits(price: number, tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) {
    throw new RangeError("Tick size must be positive and finite");
  }
  return Math.round(price / tickSize);
}

export function lowerChannel(
  candles: Candle[],
  endIndex: number,
  period: number,
): number {
  assertPeriod(period);
  assertEndIndex(candles, endIndex);
  const startIndex = endIndex - period + 1;
  if (startIndex < 0) {
    throw new RangeError("Not enough candle history for Donchian period");
  }

  let channel = candles[startIndex].low;
  for (let index = startIndex + 1; index <= endIndex; index += 1) {
    channel = Math.min(channel, candles[index].low);
  }
  return channel;
}

export function bullishRollover(
  candles: Candle[],
  endIndex: number,
  period: number,
  tickSize = DEFAULT_TICK_SIZE,
): { passed: boolean; currentLdc: number; previousLdc: number } {
  assertPeriod(period);
  assertEndIndex(candles, endIndex);
  if (endIndex - period < 0) {
    throw new RangeError("Not enough candle history for two Donchian windows");
  }

  const currentLdc = lowerChannel(candles, endIndex, period);
  const previousLdc = lowerChannel(candles, endIndex - 1, period);
  const signalLowTicks = toTickUnits(candles[endIndex].low, tickSize);
  const currentLdcTicks = toTickUnits(currentLdc, tickSize);

  return {
    passed: currentLdc > previousLdc && signalLowTicks === currentLdcTicks,
    currentLdc,
    previousLdc,
  };
}
