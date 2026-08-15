import { describe, expect, it } from "vitest";
import { calculateTradeDiagnostics } from "@/lib/signals/trade-diagnostics";
import type { ReversalConfirmation } from "@/lib/signals/reversal-confirmation";
import type { SequentialEvidence } from "@/lib/signals/sequential-evidence";

const confirmation: ReversalConfirmation = {
  version: "confirmation-v1",
  score: 78,
  grade: "STRONG",
  closeLocation: 0.8,
  lowerWickRatio: 0.6,
  atrRecovery: 1,
  volumeZScore: 1,
  changePointScore: 0.7,
  validPeriodCount: 4,
  validPeriodRange: [128, 132],
  higherTimeframe: "UNAVAILABLE",
  relativeStrength: "UNAVAILABLE",
  reasons: [],
};

const sequential: SequentialEvidence = {
  version: "sequential-v1",
  cusumScore: 0.7,
  changePointProbability: 0.7,
  trendProbability: 0.7,
  candleQuality: 0.8,
  reversalScore: 0.72,
  calibration: "UNCALIBRATED",
  calibratedProbability: null,
  state: "CONFIRMED_REVERSAL",
  sampleSize: 30,
  trendPersistenceScore: 0.68,
  trendState: "DEVELOPING_FLIP",
};

describe("calculateTradeDiagnostics", () => {
  it("never fabricates outcome probability or historical counts", () => {
    const result = calculateTradeDiagnostics({
      confirmation,
      sequential,
      rewardRisk: 1.5,
    });

    expect(result.reversalProbability).toBeNull();
    expect(result.reversalConfidenceInterval).toBeNull();
    expect(result.target1BeforeStopProbability).toBeNull();
    expect(result.comparableSignals).toBeNull();
    expect(result.tradeQualityScore).toBeNull();
    expect(result.calibration).toBe("UNAVAILABLE");
    expect(result.evidenceQualityScore).toBeGreaterThan(0);
    expect(result.marketRegime).toBe("NEUTRAL_TO_BULLISH");
  });

  it("marks incomplete session data as limited", () => {
    const result = calculateTradeDiagnostics({
      confirmation,
      sequential,
      rewardRisk: 2,
      windowAudit: { expectedSessions: 10, observedSessions: 9, missingSessions: 1, complete: false },
    });

    expect(result.dataQuality).toBe("LIMITED");
  });
});
