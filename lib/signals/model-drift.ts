export type DriftStatus = "STABLE" | "WATCH" | "DISABLE_MODEL" | "INSUFFICIENT_DATA";

export interface PredictionDriftAssessment {
  status: DriftStatus;
  populationStabilityIndex: number | null;
  recentBrierScore: number | null;
  calibrationError: number | null;
  reasons: string[];
}

function validate(values: readonly number[], name: string): void {
  if (values.some((value) => !Number.isFinite(value))) throw new RangeError(`${name} must be finite`);
}

/** Quantile-binned PSI using the reference distribution as the fixed baseline. */
export function populationStabilityIndex(reference: readonly number[], recent: readonly number[], bins = 10): number {
  validate(reference, "Reference values");
  validate(recent, "Recent values");
  if (reference.length < bins * 2 || recent.length < bins * 2 || !Number.isInteger(bins) || bins < 2) throw new RangeError("PSI requires adequate samples and bins");
  const ordered = [...reference].sort((left, right) => left - right);
  const boundaries = Array.from({ length: bins - 1 }, (_, index) => ordered[Math.min(ordered.length - 1, Math.floor(((index + 1) / bins) * ordered.length))]);
  const counts = (values: readonly number[]) => {
    const result = new Array<number>(bins).fill(0);
    for (const value of values) {
      let bucket = 0;
      while (bucket < boundaries.length && value > boundaries[bucket]) bucket += 1;
      result[bucket] += 1;
    }
    return result.map((count) => Math.max(count / values.length, 1e-6));
  };
  const expected = counts(reference);
  const actual = counts(recent);
  return actual.reduce((sum, proportion, index) => sum + (proportion - expected[index]) * Math.log(proportion / expected[index]), 0);
}

function calibrationError(predictions: readonly number[], outcomes: readonly (0 | 1)[], bins = 10): number {
  let total = 0;
  for (let bin = 0; bin < bins; bin += 1) {
    const indexes = predictions.map((value, index) => ({ value, index })).filter(({ value }) => Math.min(bins - 1, Math.floor(value * bins)) === bin);
    if (!indexes.length) continue;
    const forecast = indexes.reduce((sum, item) => sum + item.value, 0) / indexes.length;
    const observed = indexes.reduce((sum, item) => sum + outcomes[item.index], 0) / indexes.length;
    total += indexes.length / predictions.length * Math.abs(forecast - observed);
  }
  return total;
}

export function assessPredictionDrift({
  referenceScores,
  recentScores,
  recentOutcomes,
}: {
  referenceScores: readonly number[];
  recentScores: readonly number[];
  recentOutcomes: readonly (0 | 1)[];
}): PredictionDriftAssessment {
  validate(referenceScores, "Reference scores");
  validate(recentScores, "Recent scores");
  if (recentScores.length !== recentOutcomes.length || recentScores.some((value) => value < 0 || value > 1) || recentOutcomes.some((value) => value !== 0 && value !== 1)) throw new RangeError("Invalid drift outcomes");
  if (referenceScores.length < 100 || recentScores.length < 50) return { status: "INSUFFICIENT_DATA", populationStabilityIndex: null, recentBrierScore: null, calibrationError: null, reasons: ["Drift monitoring requires at least 100 reference and 50 matured recent observations"] };
  const psi = populationStabilityIndex(referenceScores, recentScores);
  const brier = recentScores.reduce((sum, value, index) => sum + (value - recentOutcomes[index]) ** 2, 0) / recentScores.length;
  const ece = calibrationError(recentScores, recentOutcomes);
  const reasons: string[] = [];
  if (psi >= 0.25) reasons.push("Severe score-distribution drift");
  else if (psi >= 0.1) reasons.push("Moderate score-distribution drift");
  if (ece >= 0.15) reasons.push("Severe probability miscalibration");
  else if (ece >= 0.08) reasons.push("Probability calibration requires review");
  const status: DriftStatus = psi >= 0.25 || ece >= 0.15 ? "DISABLE_MODEL" : reasons.length ? "WATCH" : "STABLE";
  return { status, populationStabilityIndex: psi, recentBrierScore: brier, calibrationError: ece, reasons };
}
