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
  version: "sequential-v2",
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
    expect(result.marketRegime).toBe("UNAVAILABLE");
    expect(result.dataQuality).toBe("NOT_AUDITED");
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

  it("does not certify a fitted probability as walk-forward validated", () => {
    const result = calculateTradeDiagnostics({ confirmation, sequential: {
      ...sequential, calibratedProbability: 0.71, calibration: "PLATT",
    }, rewardRisk: 2 });
    expect(result.calibration).toBe("UNVALIDATED_MODEL");
    expect(result.reversalProbability).toBeNull();
  });

  it("limits a complete-window label to a consistent, positive session audit", () => {
    const inputs = { confirmation, sequential, rewardRisk: 2 };
    expect(calculateTradeDiagnostics({ ...inputs, windowAudit: {
      expectedSessions: 10, observedSessions: 10, missingSessions: 0, complete: true,
    } }).dataQuality).toBe("SESSION_WINDOW_COMPLETE");
    expect(calculateTradeDiagnostics({ ...inputs, windowAudit: {
      expectedSessions: 10, observedSessions: 9, missingSessions: 0, complete: true,
    } }).dataQuality).toBe("LIMITED");
  });

  it("uses the intraday continuity audit when no daily audit exists", () => {
    const result = calculateTradeDiagnostics({
      confirmation,
      sequential,
      rewardRisk: 2,
      intradayWindowAudit: { expectedBars: 40, observedBars: 40, missingBars: 0, complete: true },
    });
    expect(result.dataQuality).toBe("SESSION_WINDOW_COMPLETE");
    expect(result.validationNotes?.some((note) => note.includes("40/40 bars"))).toBe(true);
  });
});
