import type { Candle } from "@/lib/market/provider";
import { atrAt } from "./atr";
import {
  ATR_PERIOD,
  PIVOT_LEFT_BARS,
  PIVOT_RIGHT_BARS,
} from "./strategy-config";
import { priceToTicks } from "./ticks";

export interface TradeLevels {
  entry: number;
  stop: number;
  target1: number;
  target2: number;
  reactionHigh: number | null;
  rewardRisk: number | null;
  hasTarget1Room?: boolean;
  /** Exchange-tick-safe risk and execution metrics for the trader summary. */
  riskPerShare?: number;
  riskPercent?: number;
  target1RewardRisk?: number;
  target2RewardRisk?: number;
  stopBuffer?: number;
  stopBufferAtr?: number;
  tickSize?: number;
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

function floorTicks(price: number, tickSize: number): number {
  const quotient = price / tickSize;
  const nearestInteger = Math.round(quotient);
  const precisionTolerance =
    Number.EPSILON * Math.max(1, Math.abs(quotient)) * 8;
  return (
    Math.abs(quotient - nearestInteger) <= precisionTolerance
      ? nearestInteger
      : Math.floor(quotient)
  );
}

function ceilTicks(price: number, tickSize: number): number {
  return -floorTicks(-price, tickSize);
}

function priceAtTicks(ticks: number, tickSize: number): number {
  return Number((ticks * tickSize).toPrecision(15));
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
  const entryTicks = ceilTicks(signal.close, tickSize);
  const stopTicks = floorTicks(signal.low - buffer, tickSize);
  const riskTicks = entryTicks - stopTicks;

  if (!Number.isFinite(riskTicks) || riskTicks <= 0) {
    return null;
  }

  const target1Ticks = entryTicks + riskTicks;
  const target2Ticks = entryTicks + 2 * riskTicks;
  const rawReactionHigh = highestConfirmedReactionHigh(
    candles,
    signalIndex,
    anchorIndex,
  );

  const reactionHighTicks = rawReactionHigh === undefined
    ? null
    : floorTicks(rawReactionHigh, tickSize);

  const entry = priceAtTicks(entryTicks, tickSize);
  const stop = priceAtTicks(stopTicks, tickSize);
  const target1 = priceAtTicks(target1Ticks, tickSize);
  const target2 = priceAtTicks(target2Ticks, tickSize);
  const reactionHigh = reactionHighTicks === null
    ? null
    : priceAtTicks(reactionHighTicks, tickSize);

  return {
    entry,
    stop,
    target1,
    target2,
    reactionHigh,
    rewardRisk: reactionHighTicks === null ? null : (reactionHighTicks - entryTicks) / riskTicks,
    hasTarget1Room: reactionHighTicks !== null && reactionHighTicks >= target1Ticks,
    riskPerShare: priceAtTicks(riskTicks, tickSize),
    riskPercent: (riskTicks * tickSize / Math.max(entryTicks * tickSize, tickSize)) * 100,
    target1RewardRisk: 1,
    target2RewardRisk: 2,
    stopBuffer: priceAtTicks(priceToTicks(signal.low, tickSize) - stopTicks, tickSize),
    stopBufferAtr: ((priceToTicks(signal.low, tickSize) - stopTicks) * tickSize) / Math.max(atr, tickSize),
    tickSize,
  };
}
