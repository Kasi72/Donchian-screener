export const PLATT_CALIBRATION_VERSION = "platt-v1" as const;

export interface PlattCalibrationModel {
  version: typeof PLATT_CALIBRATION_VERSION;
  intercept: number;
  slope: number;
  trainingSize: number;
}

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

export function fitPlattCalibration(
  scores: readonly number[],
  outcomes: readonly (0 | 1)[],
): PlattCalibrationModel {
  if (scores.length !== outcomes.length || scores.length < 4) {
    throw new RangeError("Platt calibration requires at least four paired observations");
  }
  if (scores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)) {
    throw new RangeError("Platt scores must be finite values between zero and one");
  }
  if (outcomes.some((outcome) => outcome !== 0 && outcome !== 1) || new Set(outcomes).size < 2) {
    throw new RangeError("Platt outcomes must contain both classes");
  }

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

export function applyPlattCalibration(model: PlattCalibrationModel, score: number): number {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new RangeError("Platt score must be a finite value between zero and one");
  }
  return sigmoid(model.intercept + model.slope * logit(score));
}
