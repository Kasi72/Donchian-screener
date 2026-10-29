import { expect, it } from "vitest";
import { predictionObservation, latestKnownSwingHigh, signalCloseFeatures } from "@/lib/signals/prediction-observation";
import { displayedGate, traderAssessmentFields } from "@/lib/signals/trader-assessment";
import type { BuyRecommendation } from "@/lib/signals/scan-symbol";

const bar = (time: number, open = 100, high = 105, low = 95, close = 100) => ({ time, open, high, low, close, volume: 1000 });
const r = { entry: 100, stop: 90, target1: 110, target2: 120, reactionHigh: 130,
  signalTime: 20, symbol: "TEST", timeframe: "1d", tickSize: .05,
  signalLow: 95, signalClose: 100, currentLdc: 95, previousLdc: 94 } as BuyRecommendation;
const history = () => Array.from({ length: 21 }, (_, i) => bar(i));

it("freezes features and known pivots even when future prices change", () => {
  const candles = history();
  candles[17] = bar(17, 100, 108);
  const changed = [...candles, bar(21, 100, 200, 50)];
  expect(signalCloseFeatures(changed, 20, r)).toEqual(signalCloseFeatures(candles, 20, r));
  expect(latestKnownSwingHigh(changed, 20)).toBe(108);
});

it("uses joint outcomes and refuses to label an incomplete horizon as a loss", () => {
  const candles = [...history(), bar(21, 100, 125, 95, 123)];
  const complete = predictionObservation(candles, 20, r, { horizon: 1, feeBps: 0, slippageBps: 0 });
  expect(complete.jointOutcome).toBe("T2");
  expect(complete.target1.outcome).toBe("TARGET1");
  expect(complete.labelEndTime).toBe(21);
  expect(predictionObservation(candles, 20, r, { horizon: 10, feeBps: 0, slippageBps: 0 }).jointOutcome).toBeNull();
});

it("reports ambiguity bounds without changing the default stop-first assumption", () => {
  const result = predictionObservation([...history(), bar(21, 100, 125, 85)], 20, r,
    { horizon: 1, feeBps: 0, slippageBps: 0 });
  expect(result.jointOutcome).toBe("STOP");
  expect(result.target1.ambiguousExitBar).toBe(true);
  expect(result.optimisticTarget1.outcome).toBe("TARGET1");
});

it("requires two subsequent closes above a swing known at signal close", () => {
  const candles = history();
  candles[17] = bar(17, 100, 108);
  const result = predictionObservation([...candles, bar(21, 100, 112, 95, 109), bar(22, 109, 115, 105, 111)], 20, r,
    { horizon: 2, feeBps: 0, slippageBps: 0 });
  expect(result.structuralFlip).toBe(true);
  expect(result.structuralFlipDelay).toBe(2);
});

it("never describes a rising channel with no exact touch as a passing gate", () => {
  expect(displayedGate(r)).toMatch(/^PASS/);
  expect(displayedGate({ ...r, signalLow: 96 })).toMatch(/^FAIL/);
  expect(displayedGate({ ...r, signalLow: undefined })).toMatch(/^UNVERIFIED/);
  expect(displayedGate({ ...r, currentLdcTick: 1 })).toMatch(/^UNVERIFIED/);
  expect(displayedGate({ ...r, signalClose: 95 })).toMatch(/^FAIL/);
  expect(traderAssessmentFields(r).find(([label]) => label === "Prediction readiness")?.[1]).toContain("unavailable");
});
