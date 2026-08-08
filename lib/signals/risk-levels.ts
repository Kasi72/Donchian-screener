import type { Candle } from "@/lib/market/provider";
import { atrAt } from "./atr";
import {
  ATR_PERIOD,
  PIVOT_LEFT_BARS,
  PIVOT_RIGHT_BARS,
} from "./strategy-config";

export interface TradeLevels {
  entry: number;
  stop: number;
  target1: number;
  target2: number;
  reactionHigh: number;
  rewardRisk: number;
}

function assertInputs(
  candles: Candle[],
  signalIndex: number,
  anchorIndex: number,
  tickSize: number,
): void {
  if (
    !Number.isInteger(signalIndex) ||
    signalIndex < 0 ||
    signalIndex >= candles.length
  ) {
    throw new RangeError("Signal index is outside candle history");
  }
  if (
    !Number.isInteger(anchorIndex) ||
    anchorIndex < 0 ||
    anchorIndex >= signalIndex
  ) {
    throw new RangeError("Anchor must precede the signal candle");
  }
  if (!Number.isFinite(tickSize) || tickSize <= 0) {
    throw new RangeError("Tick size must be positive and finite");
  }
}

function roundStopDown(price: number, tickSize: number): number {
  const quotient = price / tickSize;
  const nearestInteger = Math.round(quotient);
  const precisionTolerance =
    Number.EPSILON * Math.max(1, Math.abs(quotient)) * 8;
  const ticks =
    Math.abs(quotient - nearestInteger) <= precisionTolerance
      ? nearestInteger
      : Math.floor(quotient);
  return ticks * tickSize;
}

function highestConfirmedReactionHigh(
  candles: Candle[],
  signalIndex: number,
  anchorIndex: number,
): number | undefined {
  const firstIndex = Math.max(anchorIndex + 1, PIVOT_LEFT_BARS);
  const lastIndex = signalIndex - 1 - PIVOT_RIGHT_BARS;
  let reactionHigh: number | undefined;

  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const candidate = candles[index];
    let isStrictHigh = true;

    for (
      let neighbour = index - PIVOT_LEFT_BARS;
      neighbour <= index + PIVOT_RIGHT_BARS;
      neighbour += 1
    ) {
      if (neighbour !== index && candidate.high <= candles[neighbour].high) {
        isStrictHigh = false;
        break;
      }
    }

    if (
      isStrictHigh &&
      (reactionHigh === undefined || candidate.high > reactionHigh)
    ) {
      reactionHigh = candidate.high;
    }
  }

  return reactionHigh;
}

export function calculateTradeLevels(
  candles: Candle[],
  signalIndex: number,
  anchorIndex: number,
  tickSize: number,
): TradeLevels | null {
  assertInputs(candles, signalIndex, anchorIndex, tickSize);

  const signal = candles[signalIndex];
  const atr = atrAt(candles, signalIndex, ATR_PERIOD);
  const buffer = Math.max(tickSize, 0.1 * atr);
  const entry = signal.close;
  const stop = roundStopDown(signal.low - buffer, tickSize);
  const risk = entry - stop;

  if (!Number.isFinite(risk) || risk <= 0) {
    return null;
  }

  const target1 = entry + risk;
  const target2 = entry + 2 * risk;
  const reactionHigh = highestConfirmedReactionHigh(
    candles,
    signalIndex,
    anchorIndex,
  );

  if (reactionHigh === undefined || reactionHigh < target1) {
    return null;
  }

  return {
    entry,
    stop,
    target1,
    target2,
    reactionHigh,
    rewardRisk: (reactionHigh - entry) / risk,
  };
}
