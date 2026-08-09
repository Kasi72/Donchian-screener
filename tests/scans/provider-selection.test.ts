import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("yahoo-finance2", () => ({
  default: class {
    async chart(): Promise<never> {
      throw new Error("Live Yahoo client reached by provider-selection test");
    }
  },
}));

import { POST as scanResults } from "@/app/api/scans/route";

const FIXTURE_ENVIRONMENT = "SCREENER_E2E_FIXTURES";
const originalFixtureEnvironment = process.env[FIXTURE_ENVIRONMENT];

function scanRequest(symbols: string[]): Request {
  return new Request("http://localhost/api/scans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      instruments: symbols.map((symbol) => ({
        symbol,
        yahooSymbol: `${symbol}.NS`,
      })),
      timeframe: "1h",
    }),
  });
}

afterEach(() => {
  if (originalFixtureEnvironment === undefined) {
    delete process.env[FIXTURE_ENVIRONMENT];
  } else {
    process.env[FIXTURE_ENVIRONMENT] = originalFixtureEnvironment;
  }
});

describe("scan route provider selection", () => {
  it.each([undefined, "1", "deterministic-v1", "deterministic-v2"])(
    "keeps the canonical route on the live provider when the fixture flag is %s",
    async (fixtureFlag) => {
      if (fixtureFlag === undefined) {
        delete process.env[FIXTURE_ENVIRONMENT];
      } else {
        process.env[FIXTURE_ENVIRONMENT] = fixtureFlag;
      }

      const response = await scanResults(scanRequest(["TCS"]));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        results: [
          {
            symbol: "TCS",
            status: "PROVIDER_ERROR",
            message: "Market data provider failed for TCS.",
          },
        ],
      });
    },
  );
});
