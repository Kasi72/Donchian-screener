import type { Candle } from "@/lib/market/provider";
import { applyPlattCalibration, type PlattCalibrationModel } from "./calibration";

export const SEQUENTIAL_EVIDENCE_VERSION = "sequential-v1" as const;

export type ReversalState = "EARLIEST_CANDIDATE" | "CONFIRMED_REVERSAL";
export type TrendState = "REVERSAL_CANDIDATE" | "DEVELOPING_FLIP" | "CONFIRMED_FLIP";

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
  /** Causal endpoint Savitzky–Golay slope of log-close. */
  sgSlope?: number;
  /** Causal endpoint Savitzky–Golay curvature of log-close. */
  sgCurvature?: number;
  /** Robust MAD-normalized latest return. */
  volatilityZ?: number;
  /** Non-gating overlay score combining the additional evidence. */
  overlayScore?: number;
  /** Persistence evidence is informational and never changes the Donchian gate. */
  trendPersistenceScore?: number;
  trendState?: TrendState;
  traderSummary?: string;
}

const EPSILON = 1e-9;
const LOOKBACK = 30;
const MIN_HISTORY = 12;
const CUSUM_REFERENCE = 0.25;
const CUSUM_DECISION = 4;
const SG_WINDOW = 7;

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

function quantile(values: number[], probability: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function robustScale(values: number[], center: number): number {
  const mad = median(values.map((value) => Math.abs(value - center)));
  if (mad > EPSILON) return 1.4826 * mad;
  // MAD is legitimately zero for a quantized/two-regime sample even when
  // the observations are not constant. Use IQR only as a fallback; a truly
  // constant series still returns zero and is handled neutrally by callers.
  const iqr = quantile(values, 0.75) - quantile(values, 0.25);
  return iqr > EPSILON ? iqr / 1.349 : 0;
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
  if (scale === 0) return 0.5;
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
  // If the baseline is flat, estimate dispersion from the complete causal
  // sample so a genuine step-change is not discarded as "zero volatility".
  const scale = robustScale(baseline, baselineCenter) || robustScale(values, baselineCenter);
  if (scale === 0) return 0.5;
  const recentCenter = median(recent);
  const standardError = scale / Math.sqrt(recent.length);
  // Robust Gaussian-style regime-shift evidence for a positive
  // recent-vs-baseline drift. This is deliberately not labelled as a true
  // Bayesian posterior: calibration requires walk-forward outcomes.
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
  if (scale === 0) return 0.5;
  return sigmoid((slope / scale) * 6);
}

function solve3(matrix: number[][], vector: number[]): number[] {
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < 3; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < 3; row += 1) {
      if (Math.abs(a[row][pivot]) > Math.abs(a[best][pivot])) best = row;
    }
    [a[pivot], a[best]] = [a[best], a[pivot]];
    const divisor = a[pivot][pivot] || EPSILON;
    for (let column = pivot; column <= 3; column += 1) a[pivot][column] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) continue;
      const factor = a[row][pivot];
      for (let column = pivot; column <= 3; column += 1) a[row][column] -= factor * a[pivot][column];
    }
  }
  return [a[0][3], a[1][3], a[2][3]];
}

function causalSavitzkyGolay(candles: Candle[], signalIndex: number): { slope: number; curvature: number } {
  const start = Math.max(0, signalIndex - SG_WINDOW + 1);
  const observations = candles.slice(start, signalIndex + 1).map((candle, index) => ({
    x: index - (signalIndex - start),
    y: Math.log(Math.max(candle.close, EPSILON)),
  }));
  if (observations.length < 3) return { slope: 0, curvature: 0 };
  const matrix = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const vector = [0, 0, 0];
  for (const { x, y } of observations) {
    const powers = [1, x, x * x];
    for (let row = 0; row < 3; row += 1) {
      vector[row] += powers[row] * y;
      for (let column = 0; column < 3; column += 1) matrix[row][column] += powers[row] * powers[column];
    }
  }
  const [_, slope, quadratic] = solve3(matrix, vector);
  const curvature = 2 * quadratic;
  return { slope, curvature: Math.abs(curvature) < 1e-12 ? 0 : curvature };
}

function additionalOverlay(values: number[], sgSlope: number, sgCurvature: number): { volatilityZ: number; score: number } {
  if (values.length === 0) return { volatilityZ: 0, score: 0.5 };
  const center = median(values);
  const scale = robustScale(values, center);
  if (scale === 0) return { volatilityZ: 0, score: 0.5 };
  const volatilityZ = (values.at(-1)! - center) / scale;
  const sgScale = robustScale(values, center);
  const slopeEvidence = sigmoid((sgSlope / sgScale) * 8);
  const curvatureEvidence = sigmoid((sgCurvature / sgScale) * 20);
  const recoveryEvidence = sigmoid(volatilityZ * 1.5);
  return { volatilityZ, score: clamp(0.45 * slopeEvidence + 0.35 * curvatureEvidence + 0.2 * recoveryEvidence) };
}

function trendPersistence(values: number[], trendProbabilityValue: number): { score: number; state: TrendState; summary: string } {
  const recent = values.slice(-3);
  const positiveRate = recent.length === 0 ? 0 : recent.filter((value) => value > 0).length / recent.length;
  const score = clamp(0.6 * trendProbabilityValue + 0.4 * positiveRate);
  if (score >= 0.7 && positiveRate >= 2 / 3) {
    return {
      score,
      state: "CONFIRMED_FLIP",
      summary: "Donchian reversal is confirmed and recent candles support an upward trend flip.",
    };
  }
  if (score >= 0.5) {
    return {
      score,
      state: "DEVELOPING_FLIP",
      summary: "Donchian reversal is valid; the trend flip is developing—wait for follow-through.",
    };
  }
  return {
    score,
    state: "REVERSAL_CANDIDATE",
    summary: "Donchian reversal is valid, but trend follow-through is not confirmed.",
  };
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
  const { slope: sgSlope, curvature: sgCurvature } = causalSavitzkyGolay(candles, signalIndex);
  const overlay = additionalOverlay(values, sgSlope, sgCurvature);
  const persistence = trendPersistence(values, trendProbabilityValue);
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
    sgSlope,
    sgCurvature,
    volatilityZ: overlay.volatilityZ,
    overlayScore: overlay.score,
    trendPersistenceScore: persistence.score,
    trendState: persistence.state,
    traderSummary: persistence.summary,
  };
}
