import { describe, expect, it } from "vitest";
import { STRATEGY_VERSION } from "@/lib/signals/strategy-config";

describe("application", () => {
  it("publishes a frozen strategy version", () => {
    expect(STRATEGY_VERSION).toBe("rules-v1");
  });
});
