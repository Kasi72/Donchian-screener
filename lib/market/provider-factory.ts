import "server-only";

import type { MarketDataProvider } from "./provider";
import { YahooMarketDataProvider } from "./yahoo-provider";

export async function createMarketDataProvider(): Promise<MarketDataProvider> {
  return new YahooMarketDataProvider();
}
