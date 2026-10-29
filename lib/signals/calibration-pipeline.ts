import { localBayesianProbabilityIntervalFor, purgedWalkForwardFolds } from "./advanced-validation";
import {
  applyBetaCalibration,
  applyCalibration,
  applyPlattCalibration,
  fitBetaCalibration,
  fitPlattCalibration,
  type CalibrationModel,
} from "./calibration";

export interface WalkForwardCalibration {
  model: CalibrationModel | null;
  method: "PLATT" | "BETA" | null;
  outOfSamplePredictions: number[];
  outOfSampleOutcomes: (0 | 1)[];
  conformalInterval: null;
  foldsUsed: number;
  status: "VALIDATED" | "INSUFFICIENT_DATA" | "REJECTED";
  selectionSize: number;
  validationSize: number;
  brierScore: number | null;
  rawBrierScore: number | null;
  expectedCalibrationError: number | null;
  rawExpectedCalibrationError: number | null;
  confidence: number;
  rejectionReasons: string[];
}

function brier(predictions: readonly number[], outcomes: readonly (0 | 1)[]): number {
  return predictions.reduce((sum, prediction, index) => sum + (prediction - outcomes[index]) ** 2, 0) / predictions.length;
}

function expectedCalibrationError(predictions: readonly number[], outcomes: readonly (0 | 1)[], bins = 10): number {
  let result = 0;
  for (let bin = 0; bin < bins; bin += 1) {
    const indexes = predictions.map((prediction, index) => ({ prediction, index })).filter(({ prediction }) => Math.min(bins - 1, Math.floor(prediction * bins)) === bin);
    if (!indexes.length) continue;
    const forecast = indexes.reduce((sum, item) => sum + item.prediction, 0) / indexes.length;
    const observed = indexes.reduce((sum, item) => sum + outcomes[item.index], 0) / indexes.length;
    result += (indexes.length / predictions.length) * Math.abs(forecast - observed);
  }
  return result;
}

/** Fits and selects calibration using only prior chronological folds. */
export function fitPurgedWalkForwardCalibration(
  scores: readonly number[],
  outcomes: readonly (0 | 1)[],
  options: { folds?: number; purge?: number; embargo?: number; confidence?: number; minimumOos?: number } = {},
): WalkForwardCalibration {
  if (scores.length !== outcomes.length || scores.some((value) => !Number.isFinite(value) || value < 0 || value > 1) || outcomes.some((value) => value !== 0 && value !== 1)) throw new RangeError("Invalid calibration observations");
  const confidence = options.confidence ?? 0.9;
  const folds = purgedWalkForwardFolds(scores.length, options.folds ?? 5, undefined, options.purge ?? 10, options.embargo ?? 10);
  const raw: number[] = [];
  const platt: number[] = [];
  const beta: number[] = [];
  const observed: (0 | 1)[] = [];
  let foldsUsed = 0;
  for (const fold of folds) {
    const trainScores = scores.slice(fold.train[0], fold.train[1]);
    const trainOutcomes = outcomes.slice(fold.train[0], fold.train[1]);
    if (trainScores.length < 30 || new Set(trainOutcomes).size < 2) continue;
    const plattModel = fitPlattCalibration(trainScores, trainOutcomes);
    const betaModel = fitBetaCalibration(trainScores, trainOutcomes);
    foldsUsed += 1;
    for (let index = fold.test[0]; index < fold.test[1]; index += 1) {
      raw.push(scores[index]);
      platt.push(applyPlattCalibration(plattModel, scores[index]));
      beta.push(applyBetaCalibration(betaModel, scores[index]));
      observed.push(outcomes[index]);
    }
  }
  const minimumOos = options.minimumOos ?? 100;
  const selectionSize = Math.floor(observed.length * 0.7);
  const validationSize = observed.length - selectionSize;
  if (observed.length < minimumOos || selectionSize < 50 || validationSize < 30 || new Set(observed.slice(selectionSize)).size < 2) {
    return { model: null, method: null, outOfSamplePredictions: [], outOfSampleOutcomes: observed, conformalInterval: null, foldsUsed, status: "INSUFFICIENT_DATA", selectionSize, validationSize, brierScore: null, rawBrierScore: null, expectedCalibrationError: null, rawExpectedCalibrationError: null, confidence, rejectionReasons: ["Insufficient chronological out-of-sample observations or class coverage"] };
  }

  const method = brier(beta.slice(0, selectionSize), observed.slice(0, selectionSize)) < brier(platt.slice(0, selectionSize), observed.slice(0, selectionSize)) ? "BETA" : "PLATT";
  const selected = method === "BETA" ? beta : platt;
  const validationPredictions = selected.slice(selectionSize);
  const validationRaw = raw.slice(selectionSize);
  const validationOutcomes = observed.slice(selectionSize);
  const brierScore = brier(validationPredictions, validationOutcomes);
  const rawBrierScore = brier(validationRaw, validationOutcomes);
  const expectedCalibrationErrorValue = expectedCalibrationError(validationPredictions, validationOutcomes);
  const rawExpectedCalibrationError = expectedCalibrationError(validationRaw, validationOutcomes);
  const rejectionReasons: string[] = [];
  if (!(brierScore < rawBrierScore)) rejectionReasons.push("Calibration did not improve held-out Brier score");
  if (expectedCalibrationErrorValue > rawExpectedCalibrationError) rejectionReasons.push("Calibration worsened held-out calibration error");
  const status = rejectionReasons.length ? "REJECTED" : "VALIDATED";
  const model = status === "VALIDATED" ? (method === "BETA" ? fitBetaCalibration(scores, outcomes) : fitPlattCalibration(scores, outcomes)) : null;
  return { model, method: model ? method : null, outOfSamplePredictions: validationPredictions, outOfSampleOutcomes: validationOutcomes, conformalInterval: null, foldsUsed, status, selectionSize, validationSize, brierScore, rawBrierScore, expectedCalibrationError: expectedCalibrationErrorValue, rawExpectedCalibrationError, confidence, rejectionReasons };
}

export function applyValidatedCalibration(calibration: WalkForwardCalibration, score: number): { probability: number; interval: [number, number] } | null {
  if (calibration.status !== "VALIDATED" || calibration.model === null) return null;
  const probability = applyCalibration(calibration.model, score);
  const interval = localBayesianProbabilityIntervalFor(probability, calibration.outOfSamplePredictions, calibration.outOfSampleOutcomes, calibration.confidence);
  return { probability, interval };
}
