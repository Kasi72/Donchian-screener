import type { Candle } from "@/lib/market/provider";
import { applyPlattCalibration, type PlattCalibrationModel } from "./calibration";

export const SEQUENTIAL_EVIDENCE_VERSION = "sequential-v1" as const;

export type ReversalState = "EARLIEST_CANDIDATE" | "CONFIRMED_REVERSAL";

export interface SequentialEvidence {
  version: typeof SEQUENTIAL_EVIDENCE_VERSION;
  cusumScore: number;
  changePointProbability: number;
  trendProbability: number;
  candleQuality: number;
  /** Bounded evidence score; not a calibrated probability by itself. */
  reversalScore: number;
  calibration: "UNCALIBRATED" | "PLATT";
  calibratedProbability: number | null;
  state: ReversalState;
  sampleSize: number;
}

const EPSILON = 1e-9;
const LOOKBACK = 30;
const MIN_HISTORY = 12;
const CUSUM_REFERENCE = 0.25;
const CUSUM_DECISION = 4;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function robustScale(values: number[], center: number): number {
  return Math.max(1.4826 * median(values.map((value) => Math.abs(value - center))), EPSILON);
}

function returnsThrough(candles: Candle[], signalIndex: number): number[] {
  const start = Math.max(1, signalIndex - LOOKBACK + 1);
  const values: number[] = [];
  for (let index = start; index <= signalIndex; index += 1) {
    const previous = candles[index - 1].close;
    const current = candles[index].close;
    if (previous > 0 && current > 0) values.push(Math.log(current / previous));
  }
  return values;
}

function bullishCusum(values: number[]): number {
  if (values.length < MIN_HISTORY) return 0.5;
  const center = median(values);
  const scale = robustScale(values, center);
  let cumulative = 0;
  for (const value of values) {
    cumulative = Math.max(0, cumulative + (value - center) / scale - CUSUM_REFERENCE);
  }
  return clamp(cumulative / CUSUM_DECISION);
}

function changePointProbability(values: number[]): number {
  if (values.length < MIN_HISTORY) return 0.5;
  const split = Math.max(5, values.length - 8);
  const baseline = values.slice(0, split);
  const recent = values.slice(split);
  const baselineCenter = median(baseline);
  const scale = robustScale(baseline, baselineCenter);
  const recentCenter = median(recent);
  const standardError = scale / Math.sqrt(recent.length);
  // Robust Gaussian log-odds for a positive recent-vs-baseline drift. The
  // logistic transform is calibrated later using walk-forward data.
  return sigmoid((recentCenter - baselineCenter) / Math.max(standardError, EPSILON) - 1.2);
}

function trendProbability(values: number[]): number {
  if (values.length < MIN_HISTORY) return 0.5;
  let level = 0;
  let weight = 0;
  for (const value of values) {
    level = 0.85 * level + 0.15 * value;
    weight = 0.85 * weight + 0.15;
  }
  const slope = level / Math.max(weight, EPSILON);
  const scale = robustScale(values, median(values));
  return sigmoid((slope / scale) * 6);
}

function candleQuality(candle: Candle): number {
  const range = Math.max(candle.high - candle.low, EPSILON);
  const closeLocation = clamp((candle.close - candle.low) / range);
  const lowerWick = clamp((Math.min(candle.open, candle.close) - candle.low) / range);
  return clamp(0.6 * closeLocation + 0.4 * clamp(lowerWick / 0.5));
}

export function calculateSequentialEvidence(
  candles: Candle[],
  signalIndex: number,
  calibrationModel?: PlattCalibrationModel,
): SequentialEvidence {
  if (!Number.isInteger(signalIndex) || signalIndex < MIN_HISTORY || signalIndex >= candles.length) {
    throw new RangeError("Sequential evidence requires a completed candle with sufficient history");
  }
  const values = returnsThrough(candles, signalIndex);
  const cusumScore = bullishCusum(values);
  const changeProbability = changePointProbability(values);
  const trendProbabilityValue = trendProbability(values);
  const quality = candleQuality(candles[signalIndex]);
  const reversalProbability = clamp(
    0.32 * cusumScore +
      0.28 * changeProbability +
      0.22 * trendProbabilityValue +
      0.18 * quality,
  );
  const calibratedProbability = calibrationModel
    ? applyPlattCalibration(calibrationModel, reversalProbability)
    : null;
  const decisionScore = calibratedProbability ?? reversalProbability;
  return {
    version: SEQUENTIAL_EVIDENCE_VERSION,
    cusumScore,
    changePointProbability: changeProbability,
    trendProbability: trendProbabilityValue,
    candleQuality: quality,
    reversalScore: reversalProbability,
    calibration: calibrationModel ? "PLATT" : "UNCALIBRATED",
    calibratedProbability,
    state: decisionScore >= 0.65 ? "CONFIRMED_REVERSAL" : "EARLIEST_CANDIDATE",
    sampleSize: values.length,
  };
}
