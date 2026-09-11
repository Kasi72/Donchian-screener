import { conformalProbabilityInterval, purgedWalkForwardFolds } from "./advanced-validation";
import { applyPlattCalibration, fitPlattCalibration, type PlattCalibrationModel } from "./calibration";

export interface WalkForwardCalibration {
  model: PlattCalibrationModel | null;
  outOfSamplePredictions: number[];
  outOfSampleOutcomes: (0 | 1)[];
  conformalInterval: [number, number] | null;
  foldsUsed: number;
  status: "VALIDATED" | "INSUFFICIENT_DATA";
}

/** Fits calibration only on prior observations and evaluates it on later ones. */
export function fitPurgedWalkForwardCalibration(
  scores: readonly number[], outcomes: readonly (0 | 1)[], options: { folds?: number; purge?: number; embargo?: number; confidence?: number } = {},
): WalkForwardCalibration {
  if (scores.length !== outcomes.length || scores.some((v) => !Number.isFinite(v) || v < 0 || v > 1) || outcomes.some((v) => v !== 0 && v !== 1)) throw new RangeError("Invalid calibration observations");
  const folds = purgedWalkForwardFolds(scores.length, options.folds ?? 5, undefined, options.purge ?? 1, options.embargo ?? 1);
  const predicted: number[] = [];
  const observed: (0 | 1)[] = [];
  let foldsUsed = 0;
  for (const fold of folds) {
    const trainScores = scores.slice(fold.train[0], fold.train[1]);
    const trainOutcomes = outcomes.slice(fold.train[0], fold.train[1]);
    if (trainScores.length < 4 || new Set(trainOutcomes).size < 2) continue;
    const model = fitPlattCalibration(trainScores, trainOutcomes);
    foldsUsed += 1;
    for (let i = fold.test[0]; i < fold.test[1]; i += 1) {
      predicted.push(applyPlattCalibration(model, scores[i]));
      observed.push(outcomes[i]);
    }
  }
  if (predicted.length < 8 || new Set(observed).size < 2) return { model: null, outOfSamplePredictions: predicted, outOfSampleOutcomes: observed, conformalInterval: null, foldsUsed, status: "INSUFFICIENT_DATA" };
  const model = fitPlattCalibration(scores, outcomes);
  const pointInterval = conformalProbabilityInterval(predicted, observed, options.confidence ?? 0.9);
  return { model, outOfSamplePredictions: predicted, outOfSampleOutcomes: observed, conformalInterval: pointInterval, foldsUsed, status: "VALIDATED" };
}
