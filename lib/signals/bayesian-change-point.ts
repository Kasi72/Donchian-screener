const EPSILON = 1e-12;

export interface BayesianChangePointEvidence {
  /** Posterior mass assigned to run lengths of at most three observations. */
  shortRunProbability: number;
  mostLikelyRunLength: number;
  /** Directional probability that the post-change location exceeds the prior location. */
  positiveShiftProbability: number;
  /** Joint, directional evidence. This is not an outcome or win probability. */
  bullishChangeEvidence: number;
  hazard: number;
  sampleSize: number;
}

interface NormalGammaState {
  mean: number;
  kappa: number;
  alpha: number;
  beta: number;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

// Lanczos approximation, sufficient for the small positive arguments used by
// the Student-t predictive density below.
function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ];
  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  let x = 0.9999999999998099;
  const shifted = value - 1;
  for (let index = 0; index < coefficients.length; index += 1) {
    x += coefficients[index] / (shifted + index + 1);
  }
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
}

function studentTDensity(value: number, state: NormalGammaState): number {
  const degrees = 2 * state.alpha;
  const scaleSquared = state.beta * (state.kappa + 1) / (state.alpha * state.kappa);
  if (!(degrees > 0) || !(scaleSquared > 0)) return EPSILON;
  const logDensity = logGamma((degrees + 1) / 2) - logGamma(degrees / 2) -
    0.5 * Math.log(degrees * Math.PI * scaleSquared) -
    ((degrees + 1) / 2) * Math.log1p(((value - state.mean) ** 2) / (degrees * scaleSquared));
  return Math.max(Math.exp(logDensity), EPSILON);
}

function update(state: NormalGammaState, value: number): NormalGammaState {
  const kappa = state.kappa + 1;
  return {
    mean: (state.kappa * state.mean + value) / kappa,
    kappa,
    alpha: state.alpha + 0.5,
    beta: state.beta + (state.kappa * (value - state.mean) ** 2) / (2 * kappa),
  };
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  if (!ordered.length) return 0;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function robustScale(values: readonly number[], center: number): number {
  const deviations = values.map((value) => Math.abs(value - center));
  return Math.max(1.4826 * median(deviations), EPSILON);
}

function normalCdf(value: number): number {
  // Abramowitz-Stegun normal-CDF approximation.
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.2316419 * absolute);
  const density = Math.exp(-0.5 * absolute * absolute) / Math.sqrt(2 * Math.PI);
  const tail = density * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return value >= 0 ? 1 - tail : tail;
}

/**
 * Causal Bayesian online run-length inference with a Student-t predictive
 * distribution. Values should be stationary increments such as log returns.
 * The result is evidence about a distributional change, never a trade-outcome
 * probability.
 */
export function bayesianOnlineChangePoint(
  values: readonly number[],
  options: { expectedRunLength?: number; maximumRunLength?: number } = {},
): BayesianChangePointEvidence {
  if (values.some((value) => !Number.isFinite(value))) throw new RangeError("Change-point inputs must be finite");
  const expectedRunLength = options.expectedRunLength ?? 40;
  const maximumRunLength = options.maximumRunLength ?? 120;
  if (!Number.isFinite(expectedRunLength) || expectedRunLength < 5 || !Number.isInteger(maximumRunLength) || maximumRunLength < 5) {
    throw new RangeError("Invalid change-point configuration");
  }
  const hazard = 1 / expectedRunLength;
  if (values.length < 12) {
    return { shortRunProbability: 0.5, mostLikelyRunLength: 0, positiveShiftProbability: 0.5, bullishChangeEvidence: 0.5, hazard, sampleSize: values.length };
  }

  const center = median(values);
  const scale = robustScale(values, center);
  const standardized = values.map((value) => (value - center) / scale);
  const prior: NormalGammaState = { mean: 0, kappa: 0.5, alpha: 1, beta: 1 };
  let probabilities = [1];
  let states = [prior];

  for (const value of standardized) {
    const predictive = states.map((state) => studentTDensity(value, state));
    const nextLength = Math.min(probabilities.length + 1, maximumRunLength + 1);
    const next = new Array<number>(nextLength).fill(0);
    const priorPredictive = studentTDensity(value, prior);
    next[0] = probabilities.reduce((sum, probability) => sum + probability * hazard * priorPredictive, 0);
    for (let runLength = 0; runLength < probabilities.length && runLength + 1 < nextLength; runLength += 1) {
      next[runLength + 1] += probabilities[runLength] * (1 - hazard) * predictive[runLength];
    }
    const normalizer = next.reduce((sum, probability) => sum + probability, 0);
    probabilities = normalizer > EPSILON ? next.map((probability) => probability / normalizer) : [1];
    states = [update(prior, value), ...states.slice(0, nextLength - 1).map((state) => update(state, value))];
  }

  const shortRunProbability = clamp(probabilities.slice(0, 4).reduce((sum, value) => sum + value, 0));
  const mostLikelyRunLength = probabilities.reduce((best, probability, index) => probability > probabilities[best] ? index : best, 0);
  const recentLength = Math.max(2, Math.min(5, Math.floor(values.length / 3)));
  const priorValues = values.slice(0, -recentLength);
  const recentValues = values.slice(-recentLength);
  const priorCenter = median(priorValues);
  const recentCenter = median(recentValues);
  const directionalScale = robustScale(priorValues, priorCenter) / Math.sqrt(recentValues.length);
  const shiftProbability = clamp(normalCdf((recentCenter - priorCenter) / directionalScale));
  const positiveDriftProbability = clamp(normalCdf(recentCenter / directionalScale));
  // A smaller loss is a change, but it is not yet a bullish drift. Requiring
  // both conditions prevents persistent negative returns from being labelled
  // as a positive reversal merely because their magnitude eased slightly.
  const positiveShiftProbability = Math.min(shiftProbability, positiveDriftProbability);
  const bullishChangeEvidence = clamp(Math.sqrt(shortRunProbability * positiveShiftProbability));
  return { shortRunProbability, mostLikelyRunLength, positiveShiftProbability, bullishChangeEvidence, hazard, sampleSize: values.length };
}
