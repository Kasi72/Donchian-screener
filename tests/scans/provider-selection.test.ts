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
  it("runs the real route and scan pipeline from normalized provider-boundary fixtures", async () => {
    process.env[FIXTURE_ENVIRONMENT] = "deterministic-v1";

    const response = await scanResults(
      scanRequest(["RELIANCE", "TCS", "BROKEN"]),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [
        expect.objectContaining({
          symbol: "RELIANCE",
          status: "BUY",
          recommendation: expect.objectContaining({
            recommendation: "BUY",
            symbol: "RELIANCE",
            yahooSymbol: "RELIANCE.NS",
            timeframe: "1h",
            signalTime: 1_786_095_900_000,
            autoPeriod: 14,
            probability: null,
            entry: 102,
            stop: 94.5,
            target1: 109.5,
            target2: 117,
            currentLdc: 95.01,
            previousLdc: 90,
            anchorTime: 1_785_923_100_000,
            strategyVersion: "rules-v1",
            dataAsOf: 1_786_095_900_000,
          }),
        }),
        { symbol: "TCS", status: "NO_SIGNAL" },
        {
          symbol: "BROKEN",
          status: "PROVIDER_ERROR",
          message: "Market data provider failed for BROKEN.",
        },
      ],
    });
  });

  it.each([undefined, "1", "deterministic-v2"])(
    "fails closed to the live provider when the fixture flag is %s",
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
