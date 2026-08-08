import type { Candle } from "@/lib/market/provider";
import { wilderAtr } from "./atr";
import {
  ATR_PERIOD,
  MIN_PIVOT_PROMINENCE_ATR,
  MIN_PIVOT_RECOVERY_ATR,
  PIVOT_LEFT_BARS,
  PIVOT_RIGHT_BARS,
} from "./strategy-config";

export interface PivotLow {
  index: number;
  time: number;
  low: number;
  prominenceAtr: number;
  recoveryAtr: number;
  confirmedAt: number;
}

function assertEvaluationIndex(candles: Candle[], evaluationIndex: number): void {
  if (
    !Number.isInteger(evaluationIndex) ||
    evaluationIndex < 0 ||
    evaluationIndex >= candles.length
  ) {
    throw new RangeError("Evaluation index is outside candle history");
  }
  if (evaluationIndex < ATR_PERIOD + PIVOT_RIGHT_BARS) {
    throw new RangeError("Not enough causal history to confirm an ATR pivot");
  }
}

export function findConfirmedPivotLows(
  candles: Candle[],
  evaluationIndex: number,
): PivotLow[] {
  assertEvaluationIndex(candles, evaluationIndex);

  // The signal candle at evaluationIndex is deliberately absent from every
  // calculation. A scan at t may consume only candles closed by t-1.
  const causalCandles = candles.slice(0, evaluationIndex);
  const atr = wilderAtr(causalCandles, ATR_PERIOD);
  const lastPivotIndex = evaluationIndex - 1 - PIVOT_RIGHT_BARS;
  const firstPivotIndex = Math.max(PIVOT_LEFT_BARS, ATR_PERIOD - 1);
  const pivots: PivotLow[] = [];

  for (let index = firstPivotIndex; index <= lastPivotIndex; index += 1) {
    const pivot = causalCandles[index];
    const left = causalCandles.slice(index - PIVOT_LEFT_BARS, index);
    const right = causalCandles.slice(index + 1, index + 1 + PIVOT_RIGHT_BARS);
    const isStrictLow = [...left, ...right].every(
      (neighbour) => pivot.low < neighbour.low,
    );
    if (!isStrictLow) {
      continue;
    }

    const pivotAtr = atr[index];
    if (pivotAtr === null || pivotAtr <= 0) {
      continue;
    }

    const neighbouringFloor = Math.min(
      ...left.map((candle) => candle.low),
      ...right.map((candle) => candle.low),
    );
    const recoveryHigh = Math.max(...right.map((candle) => candle.high));
    const prominenceAtr = (neighbouringFloor - pivot.low) / pivotAtr;
    const recoveryAtr = (recoveryHigh - pivot.low) / pivotAtr;

    if (
      prominenceAtr < MIN_PIVOT_PROMINENCE_ATR ||
      recoveryAtr < MIN_PIVOT_RECOVERY_ATR
    ) {
      continue;
    }

    pivots.push({
      index,
      time: pivot.time,
      low: pivot.low,
      prominenceAtr,
      recoveryAtr,
      confirmedAt: index + PIVOT_RIGHT_BARS,
    });
  }

  return pivots;
}
