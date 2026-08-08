import type { Candle } from "@/lib/market/provider";

function assertPeriod(period: number): void {
  if (!Number.isInteger(period) || period <= 0) {
    throw new RangeError("ATR period must be a positive integer");
  }
}

function assertIndex(candles: Candle[], endIndex: number): void {
  if (
    !Number.isInteger(endIndex) ||
    endIndex < 0 ||
    endIndex >= candles.length
  ) {
    throw new RangeError("ATR end index is outside candle history");
  }
}

export function trueRange(candle: Candle, previousClose?: number): number {
  if (previousClose === undefined) {
    return candle.high - candle.low;
  }

  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previousClose),
    Math.abs(candle.low - previousClose),
  );
}

/** Returns an array aligned to candles; values before the seed are null. */
export function wilderAtr(
  candles: Candle[],
  period: number,
): Array<number | null> {
  assertPeriod(period);

  const values: Array<number | null> = Array(candles.length).fill(null);
  if (candles.length < period) {
    return values;
  }

  const ranges = candles.map((candle, index) =>
    trueRange(candle, index === 0 ? undefined : candles[index - 1].close),
  );
  let atr = ranges.slice(0, period).reduce((sum, range) => sum + range, 0) / period;
  values[period - 1] = atr;

  for (let index = period; index < candles.length; index += 1) {
    atr = (atr * (period - 1) + ranges[index]) / period;
    values[index] = atr;
  }

  return values;
}

export function atrAt(
  candles: Candle[],
  endIndex: number,
  period: number,
): number {
  assertPeriod(period);
  assertIndex(candles, endIndex);
  if (endIndex + 1 < period) {
    throw new RangeError("Not enough candle history for ATR period");
  }

  const value = wilderAtr(candles.slice(0, endIndex + 1), period)[endIndex];
  if (value === null) {
    throw new RangeError("Not enough candle history for ATR period");
  }
  return value;
}
