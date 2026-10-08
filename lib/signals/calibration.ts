export const PLATT_CALIBRATION_VERSION = "platt-v1" as const;
export const BETA_CALIBRATION_VERSION = "beta-v1" as const;

export interface PlattCalibrationModel {
  version: typeof PLATT_CALIBRATION_VERSION;
  intercept: number;
  slope: number;
  trainingSize: number;
}

export interface BetaCalibrationModel {
  version: typeof BETA_CALIBRATION_VERSION;
  positiveLogCoefficient: number;
  negativeLogCoefficient: number;
  intercept: number;
  trainingSize: number;
}

export type CalibrationModel = PlattCalibrationModel | BetaCalibrationModel;

const EPSILON = 1e-6;

function clamp(value: number, minimum = EPSILON, maximum = 1 - EPSILON): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function logit(value: number): number {
  const bounded = clamp(value);
  return Math.log(bounded / (1 - bounded));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
}

function solve3(matrix: number[][], vector: number[]): number[] | null {
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < 3; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < 3; row += 1) if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    if (Math.abs(augmented[pivot][pivot]) < EPSILON) return null;
    const divisor = augmented[pivot][pivot];
    for (let column = pivot; column < 4; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column < 4; column += 1) augmented[row][column] -= factor * augmented[pivot][column];
    }
  }
  return [augmented[0][3], augmented[1][3], augmented[2][3]];
}

function validateTraining(scores: readonly number[], outcomes: readonly (0 | 1)[], name: string): void {
  if (scores.length !== outcomes.length || scores.length < 4) throw new RangeError(`${name} calibration requires at least four paired observations`);
  if (scores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)) throw new RangeError(`${name} scores must be finite values between zero and one`);
  if (outcomes.some((outcome) => outcome !== 0 && outcome !== 1) || new Set(outcomes).size < 2) throw new RangeError(`${name} outcomes must contain both classes`);
}

export function fitPlattCalibration(
  scores: readonly number[],
  outcomes: readonly (0 | 1)[],
): PlattCalibrationModel {
  validateTraining(scores, outcomes, "Platt");

  const features = scores.map(logit);
  let intercept = 0;
  let slope = 1;
  for (let iteration = 0; iteration < 2_000; iteration += 1) {
    let interceptGradient = 0;
    let slopeGradient = 0;
    let interceptHessian = 0;
    let slopeHessian = 0;
    let crossHessian = 0;
    for (let index = 0; index < features.length; index += 1) {
      const probability = sigmoid(intercept + slope * features[index]);
      const residual = probability - outcomes[index];
      const weight = Math.max(probability * (1 - probability), EPSILON);
      interceptGradient += residual;
      slopeGradient += residual * features[index];
      interceptHessian += weight;
      slopeHessian += weight * features[index] * features[index];
      crossHessian += weight * features[index];
    }
    const determinant = interceptHessian * slopeHessian - crossHessian * crossHessian;
    if (Math.abs(determinant) < EPSILON) break;
    const interceptStep = (slopeHessian * interceptGradient - crossHessian * slopeGradient) / determinant;
    const slopeStep = (-crossHessian * interceptGradient + interceptHessian * slopeGradient) / determinant;
    intercept -= 0.5 * interceptStep;
    slope -= 0.5 * slopeStep;
    if (Math.abs(interceptStep) + Math.abs(slopeStep) < 1e-8) break;
  }
  return { version: PLATT_CALIBRATION_VERSION, intercept, slope, trainingSize: scores.length };
}

/** Beta calibration includes the identity map and handles skewed scores. */
export function fitBetaCalibration(scores: readonly number[], outcomes: readonly (0 | 1)[]): BetaCalibrationModel {
  validateTraining(scores, outcomes, "Beta");
  const features = scores.map((score) => {
    const bounded = clamp(score);
    return [Math.log(bounded), -Math.log(1 - bounded), 1];
  });
  let coefficients = [1, 1, 0];
  const ridge = 1e-4;
  for (let iteration = 0; iteration < 1_000; iteration += 1) {
    const gradient = [ridge * coefficients[0], ridge * coefficients[1], ridge * coefficients[2]];
    const hessian = [[ridge, 0, 0], [0, ridge, 0], [0, 0, ridge]];
    for (let index = 0; index < features.length; index += 1) {
      const row = features[index];
      const probability = sigmoid(row.reduce((sum, value, column) => sum + value * coefficients[column], 0));
      const residual = probability - outcomes[index];
      const weight = Math.max(probability * (1 - probability), EPSILON);
      for (let left = 0; left < 3; left += 1) {
        gradient[left] += residual * row[left];
        for (let right = 0; right < 3; right += 1) hessian[left][right] += weight * row[left] * row[right];
      }
    }
    const step = solve3(hessian, gradient);
    if (!step) break;
    coefficients = coefficients.map((coefficient, index) => coefficient - 0.5 * step[index]);
    // Monotone beta-calibration family.
    coefficients[0] = Math.max(0, coefficients[0]);
    coefficients[1] = Math.max(0, coefficients[1]);
    if (step.reduce((sum, value) => sum + Math.abs(value), 0) < 1e-8) break;
  }
  return { version: BETA_CALIBRATION_VERSION, positiveLogCoefficient: coefficients[0], negativeLogCoefficient: coefficients[1], intercept: coefficients[2], trainingSize: scores.length };
}

export function applyPlattCalibration(model: PlattCalibrationModel, score: number): number {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new RangeError("Platt score must be a finite value between zero and one");
  }
  return sigmoid(model.intercept + model.slope * logit(score));
}

export function applyBetaCalibration(model: BetaCalibrationModel, score: number): number {
  if (!Number.isFinite(score) || score < 0 || score > 1) throw new RangeError("Beta score must be a finite value between zero and one");
  const bounded = clamp(score);
  return sigmoid(model.positiveLogCoefficient * Math.log(bounded) - model.negativeLogCoefficient * Math.log(1 - bounded) + model.intercept);
}

export function applyCalibration(model: CalibrationModel, score: number): number {
  return model.version === PLATT_CALIBRATION_VERSION ? applyPlattCalibration(model, score) : applyBetaCalibration(model, score);
}
