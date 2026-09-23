const EPSILON = 1e-12;

export interface StateSpaceTrendEvidence {
  level: number;
  slope: number;
  slopeStandardError: number;
  slopePositiveProbability: number;
  previousSlope: number;
  flipProbability: number;
  acceleration: number;
  innovationZ: number;
  sampleSize: number;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  if (!ordered.length) return 0;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function normalCdf(value: number): number {
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.2316419 * absolute);
  const density = Math.exp(-0.5 * absolute * absolute) / Math.sqrt(2 * Math.PI);
  const tail = density * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return value >= 0 ? 1 - tail : tail;
}

/** Robust, causal local-linear-trend Kalman filter over log prices. */
export function estimateStateSpaceTrend(logPrices: readonly number[]): StateSpaceTrendEvidence {
  if (logPrices.some((value) => !Number.isFinite(value))) throw new RangeError("State-space inputs must be finite");
  if (logPrices.length < 8) {
    const level = logPrices.at(-1) ?? 0;
    return { level, slope: 0, slopeStandardError: Number.POSITIVE_INFINITY, slopePositiveProbability: 0.5, previousSlope: 0, flipProbability: 0.25, acceleration: 0, innovationZ: 0, sampleSize: logPrices.length };
  }
  const differences = logPrices.slice(1).map((value, index) => value - logPrices[index]);
  const differenceCenter = median(differences);
  const madScale = 1.4826 * median(differences.map((value) => Math.abs(value - differenceCenter)));
  const meanDifference = differences.reduce((sum, value) => sum + value, 0) / differences.length;
  const standardScale = Math.sqrt(differences.reduce((sum, value) => sum + (value - meanDifference) ** 2, 0) / Math.max(1, differences.length - 1));
  // Quantized or piecewise-constant returns can have zero MAD despite a real
  // regime transition. The conventional scale is a conservative fallback.
  const measurementScale = Math.max(madScale, standardScale * 0.5, 1e-6);
  const measurementVariance = measurementScale ** 2;
  const levelProcessVariance = measurementVariance * 0.1;
  const slopeProcessVariance = measurementVariance * 0.05;

  let level = logPrices[0];
  let slope = differences[0] ?? 0;
  let p00 = measurementVariance * 10;
  let p01 = 0;
  let p10 = 0;
  let p11 = measurementVariance;
  let previousSlope = slope;
  let innovationZ = 0;

  for (let index = 1; index < logPrices.length; index += 1) {
    previousSlope = slope;
    const predictedLevel = level + slope;
    const predictedSlope = slope;
    const predictedP00 = p00 + p01 + p10 + p11 + levelProcessVariance;
    const predictedP01 = p01 + p11;
    const predictedP10 = p10 + p11;
    const predictedP11 = p11 + slopeProcessVariance;
    const innovationVariance = Math.max(predictedP00 + measurementVariance, EPSILON);
    const rawInnovation = logPrices[index] - predictedLevel;
    innovationZ = rawInnovation / Math.sqrt(innovationVariance);
    const clippedInnovation = Math.max(-3, Math.min(3, innovationZ)) * Math.sqrt(innovationVariance);
    const gainLevel = predictedP00 / innovationVariance;
    const gainSlope = predictedP10 / innovationVariance;
    level = predictedLevel + gainLevel * clippedInnovation;
    slope = predictedSlope + gainSlope * clippedInnovation;
    p00 = (1 - gainLevel) * predictedP00;
    p01 = (1 - gainLevel) * predictedP01;
    p10 = predictedP10 - gainSlope * predictedP00;
    p11 = Math.max(predictedP11 - gainSlope * predictedP01, EPSILON);
  }

  const slopeStandardError = Math.sqrt(Math.max(p11, EPSILON));
  const slopePositiveProbability = clamp(normalCdf(slope / slopeStandardError));
  const previousPositiveProbability = clamp(normalCdf(previousSlope / slopeStandardError));
  const flipProbability = clamp((1 - previousPositiveProbability) * slopePositiveProbability);
  return {
    level,
    slope,
    slopeStandardError,
    slopePositiveProbability,
    previousSlope,
    flipProbability,
    acceleration: slope - previousSlope,
    innovationZ,
    sampleSize: logPrices.length,
  };
}
