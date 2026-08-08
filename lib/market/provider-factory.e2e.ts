import "server-only";

import type { MarketDataProvider } from "./provider";
import { PlaywrightFixtureMarketDataProvider } from "./playwright-fixture-provider";
import { YahooMarketDataProvider } from "./yahoo-provider";

const FIXTURE_ENVIRONMENT = "SCREENER_E2E_FIXTURES";
const FIXTURE_VERSION = "deterministic-v1";

export async function createMarketDataProvider(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<MarketDataProvider> {
  return environment[FIXTURE_ENVIRONMENT] === FIXTURE_VERSION
    ? new PlaywrightFixtureMarketDataProvider()
    : new YahooMarketDataProvider();
}
