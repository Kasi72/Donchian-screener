import { describe, expect, it } from "vitest";
import { classifySignalTier, tierLabel } from "@/lib/signals/signal-tier";

const base = {
  confirmation: { score: 80 } as any,
  sequential: { reversalScore: .8, trendPersistenceScore: .8, trendState: "DEVELOPING_FLIP", sgSlope: .01 } as any,
  rewardRisk: 2, dataQuality: "SESSION_WINDOW_COMPLETE" as const,
  stop: 90, target1: 110,
};

describe("tiered trader presentation", () => {
  it("ranks a well-supported, executable-quality setup as confirmed", () => {
    const result = classifySignalTier(base);
    expect(result.tier).toBe("CONFIRMED_REVERSAL");
    expect(result.tierScore).toBeGreaterThan(75);
    expect(result.entryReadiness).toBe("WAIT_NEXT_OPEN");
    expect(tierLabel(result.tier)).toContain("CONFIRMED REVERSAL");
  });

  it("does not promote weak evidence even when the reward/risk is attractive", () => {
    const result = classifySignalTier({ ...base, confirmation: { score: 45 } as any, sequential: { reversalScore: .2, trendPersistenceScore: .1, trendState: "REVERSAL_CANDIDATE" } as any });
    expect(result.tier).toBe("EARLY_CANDIDATE");
    expect(result.warnings).toContain("Trend follow-through is not confirmed");
  });

  it("marks a known bad next-open execution as skip without changing the tier", () => {
    const result = classifySignalTier({ ...base, nextOpen: 111 });
    expect(result.tier).toBe("CONFIRMED_REVERSAL");
    expect(result.entryReadiness).toBe("SKIP");
  });

  it("keeps incomplete data from receiving a false quality boost", () => {
    const result = classifySignalTier({ ...base, dataQuality: "NOT_AUDITED" });
    expect(result.tier).not.toBe("CONFIRMED_REVERSAL");
    expect(result.tierScore).toBeLessThan(90);
    expect(result.warnings).toContain("Data-quality audit is incomplete");
  });
});
