import "server-only";

import type { MarketDataProvider } from "./provider";
import { YahooMarketDataProvider } from "./yahoo-provider";

const FIXTURE_ENVIRONMENT = "SCREENER_E2E_FIXTURES";
const FIXTURE_VERSION = "deterministic-v1";

export async function createMarketDataProvider(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<MarketDataProvider> {
  if (environment[FIXTURE_ENVIRONMENT] !== FIXTURE_VERSION) {
    return new YahooMarketDataProvider();
  }

  const { PlaywrightFixtureMarketDataProvider } = await import(
    "./playwright-fixture-provider"
  );
  return new PlaywrightFixtureMarketDataProvider();
}
