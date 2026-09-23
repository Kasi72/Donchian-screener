import { describe, expect, it } from "vitest";

import { auditProviderConsensus } from "@/lib/market/provider-consensus";
import type { CandleResponse } from "@/lib/market/provider";

const response = (close = 100): CandleResponse => ({
  status: "OK",
  asOf: 2,
  adjustmentMode: "RAW",
  candles: [{ time: 1, open: 99, high: 101, low: 98, close, volume: 1_000 }],
});

describe("auditProviderConsensus", () => {
  it("requires tick-identical independently supplied OHLC", () => {
    expect(auditProviderConsensus(response(), response(), 0.05).status).toBe("AGREED");
    const mismatch = auditProviderConsensus(response(), response(100.1), 0.05);
    expect(mismatch.status).toBe("DIVERGED");
    expect(mismatch.maximumTickDifference).toBe(2);
  });

  it("labels a missing secondary feed honestly", () => {
    expect(auditProviderConsensus(response(), null, 0.05).status).toBe("SINGLE_SOURCE");
    expect(auditProviderConsensus(null, null, 0.05).status).toBe("UNAVAILABLE");
  });
});
