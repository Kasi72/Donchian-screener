/**
 * Small, dependency-free statistical primitives used by the research and
 * calibration layers. None of these functions creates or overrides a
 * Donchian signal; they only quantify uncertainty around already-labelled
 * outcomes.
 */

export interface BayesianRate {
  estimate: number;
  lower: number;
  upper: number;
  successes: number;
  trials: number;
}

export interface PurgedFold {
  train: [number, number];
  test: [number, number];
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function assertProbability(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${name} must be between zero and one`);
}

/** Acklam's rational inverse-normal approximation; sufficient for bounded CIs. */
function normalQuantile(probability: number): number {
  if (!(probability > 0 && probability < 1)) throw new RangeError("Normal probability must be between zero and one");
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const low = 0.02425; const high = 1 - low;
  const horner = (coefficients: readonly number[], value: number) => coefficients.reduce((accumulator, coefficient) => accumulator * value + coefficient, 0);
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    const numerator = horner(c, q);
    const denominator = horner([...d, 1], q);
    return numerator / denominator;
  }
  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    const numerator = horner(c, q);
    const denominator = horner([...d, 1], q);
    return -numerator / denominator;
  }
  const q = probability - 0.5; const r = q * q;
  const numerator = horner(a, r) * q;
  const denominator = horner([...b, 1], r);
  return numerator / denominator;
}

/** Jeffreys-prior (Beta(1/2,1/2)) estimate with a conservative normal interval. */
export function bayesianRate(successes: number, trials: number, priorAlpha = 0.5, priorBeta = 0.5): BayesianRate {
  if (![successes, trials, priorAlpha, priorBeta].every(Number.isFinite) ||
    !Number.isInteger(successes) || !Number.isInteger(trials) || successes < 0 || trials < 0 || successes > trials ||
    priorAlpha <= 0 || priorBeta <= 0) throw new RangeError("Invalid Bayesian rate inputs");
  if (trials === 0) return { estimate: 0.5, lower: 0, upper: 1, successes, trials };
  const posteriorTrials = trials + priorAlpha + priorBeta;
  const estimate = (successes + priorAlpha) / posteriorTrials;
  const variance = estimate * (1 - estimate) / (posteriorTrials + 1);
  const margin = 1.96 * Math.sqrt(Math.max(variance, 0));
  return { estimate, lower: clamp(estimate - margin), upper: clamp(estimate + margin), successes, trials };
}

/** Split-conformal interval for a new bounded probability using prior OOS residuals. */
export function conformalProbabilityIntervalFor(point: number, scores: readonly number[], outcomes: readonly (0 | 1)[], confidence = 0.9): [number, number] {
  if (scores.length !== outcomes.length || scores.length < 8) throw new RangeError("Conformal calibration requires at least eight paired observations");
  if (!Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) throw new RangeError("Confidence must be between zero and one");
  assertProbability(point, "Point");
  scores.forEach((score) => assertProbability(score, "Score"));
  const residuals = scores.map((score, index) => Math.abs(outcomes[index] - score)).sort((a, b) => a - b);
  const rank = Math.min(residuals.length - 1, Math.ceil((residuals.length + 1) * confidence) - 1);
  const radius = residuals[rank];
  return [clamp(point - radius), clamp(point + radius)];
}

/**
 * Local outcome-conditioned Bayesian interval.  Nearby historical scores are
 * weighted as comparable signals; the interval is therefore about observed
 * outcomes, not a binary residual radius around an arbitrary point.
 */
export function localBayesianProbabilityIntervalFor(point: number, scores: readonly number[], outcomes: readonly (0 | 1)[], confidence = 0.9): [number, number] {
  if (scores.length !== outcomes.length || scores.length < 8) throw new RangeError("Local calibration requires at least eight paired observations");
  if (!Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) throw new RangeError("Confidence must be between zero and one");
  assertProbability(point, "Point");
  scores.forEach((score) => assertProbability(score, "Score"));
  const nearest = scores.map((score, index) => ({ distance: Math.abs(score - point), outcome: outcomes[index] }))
    .sort((left, right) => left.distance - right.distance);
  const neighborhood = Math.min(nearest.length, Math.max(8, Math.ceil(Math.sqrt(nearest.length) * 4)));
  const successes = nearest.slice(0, neighborhood).reduce((sum, item) => sum + item.outcome, 0);
  const posteriorTrials = neighborhood + 1;
  const estimate = (successes + 0.5) / posteriorTrials;
  const variance = estimate * (1 - estimate) / (posteriorTrials + 1);
  const z = normalQuantile((1 + confidence) / 2);
  const margin = z * Math.sqrt(Math.max(variance, 0));
  return [clamp(estimate - margin), clamp(estimate + margin)];
}

/** @deprecated Prefer conformalProbabilityIntervalFor with an explicit live point. */
export function conformalProbabilityInterval(scores: readonly number[], outcomes: readonly (0 | 1)[], confidence = 0.9): [number, number] {
  if (!scores.length) throw new RangeError("Conformal calibration requires scores");
  return conformalProbabilityIntervalFor(scores.at(-1)!, scores, outcomes, confidence);
}

/**
 * Chronological folds with a purge gap and embargo after each test window.
 * Returned indexes are half-open and safe for array slicing.
 */
export function purgedWalkForwardFolds(length: number, folds = 5, testSize?: number, purge = 1, embargo = 1): PurgedFold[] {
  if (![length, folds, purge, embargo].every(Number.isInteger) || length < 1 || folds < 1 || purge < 0 || embargo < 0) throw new RangeError("Invalid walk-forward inputs");
  const width = testSize ?? Math.max(1, Math.floor(length / (folds + 1)));
  if (!Number.isInteger(width) || width < 1) throw new RangeError("Test size must be a positive integer");
  const result: PurgedFold[] = [];
  for (let fold = 0; fold < folds; fold += 1) {
    const testStart = length - (folds - fold) * width;
    const testEnd = Math.min(length, testStart + width);
    const trainEnd = Math.max(0, testStart - purge - embargo);
    const trainStart = 0;
    if (trainEnd <= trainStart || testEnd <= testStart) continue;
    result.push({ train: [trainStart, trainEnd], test: [testStart, testEnd] });
  }
  return result;
}

/** Benjamini-Hochberg false-discovery adjustment, retaining original order. */
export function benjaminiHochberg(pValues: readonly number[]): number[] {
  if (pValues.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) throw new RangeError("p-values must be between zero and one");
  const indexed = pValues.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const adjusted = new Array<number>(pValues.length);
  let running = 1;
  for (let rank = indexed.length; rank >= 1; rank -= 1) {
    const item = indexed[rank - 1];
    running = Math.min(running, item.value * indexed.length / rank);
    adjusted[item.index] = clamp(running);
  }
  return adjusted;
}
