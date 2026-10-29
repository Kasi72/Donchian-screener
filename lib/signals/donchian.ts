import type { Candle } from "@/lib/market/provider";
import { priceToTicks } from "./ticks";

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
  tickSize: number,
): { passed: boolean; currentLdc: number; previousLdc: number } {
  assertPeriod(period);
  assertEndIndex(candles, endIndex);
  if (endIndex - period < 0) {
    throw new RangeError("Not enough candle history for two Donchian windows");
  }

  const currentLdc = lowerChannel(candles, endIndex, period);
  const previousLdc = lowerChannel(candles, endIndex - 1, period);
  const signalLowTicks = priceToTicks(candles[endIndex].low, tickSize);
  const currentLdcTicks = priceToTicks(currentLdc, tickSize);
  const previousLdcTicks = priceToTicks(previousLdc, tickSize);

  return {
    passed: currentLdcTicks > previousLdcTicks && signalLowTicks === currentLdcTicks,
    currentLdc,
    previousLdc,
  };
}
