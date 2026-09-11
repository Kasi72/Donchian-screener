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

/** Split-conformal interval for a bounded probability score. */
export function conformalProbabilityInterval(scores: readonly number[], outcomes: readonly (0 | 1)[], confidence = 0.9): [number, number] {
  if (scores.length !== outcomes.length || scores.length < 8) throw new RangeError("Conformal calibration requires at least eight paired observations");
  if (!Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) throw new RangeError("Confidence must be between zero and one");
  scores.forEach((score) => assertProbability(score, "Score"));
  const residuals = scores.map((score, index) => Math.abs(outcomes[index] - score)).sort((a, b) => a - b);
  const rank = Math.min(residuals.length - 1, Math.ceil((residuals.length + 1) * confidence) - 1);
  const radius = residuals[rank];
  const point = scores[scores.length - 1];
  return [clamp(point - radius), clamp(point + radius)];
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
    const trainEnd = Math.max(0, testStart - purge);
    const trainStart = 0;
    if (trainEnd <= trainStart || testEnd <= testStart) continue;
    // The embargo is represented by excluding the post-test region from the
    // next fold's training set; it is never silently mixed into a fold.
    if (testEnd + embargo > length && fold < folds - 1) continue;
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
