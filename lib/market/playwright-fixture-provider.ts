import "server-only";

import type {
  CandleResponse,
  MarketDataProvider,
  Timeframe,
} from "./provider";
import {
  YahooMarketDataProvider,
  type YahooChartClient,
} from "./yahoo-provider";
import type { YahooCandle } from "./normalize-candles";

const FIXTURE_NOW = new Date("2026-08-07T16:00:00+05:30");
const FIRST_FIXTURE_DAY = new Date("2026-07-20T09:15:00+05:30").getTime();
const DAY_MS = 24 * 60 * 60_000;
const ONE_HOUR_MS = 60 * 60_000;

function fixtureTimes(): number[] {
  const times: number[] = [];
  for (let dayOffset = 0; dayOffset < 19; dayOffset += 1) {
    const sessionOpen = FIRST_FIXTURE_DAY + dayOffset * DAY_MS;
    const weekday = new Date(sessionOpen).getUTCDay();
    if (weekday === 0 || weekday === 6) {
      continue;
    }
    for (let interval = 0; interval < 7; interval += 1) {
      times.push(sessionOpen + interval * ONE_HOUR_MS);
    }
  }
  return times.slice(-100);
}

function quote(
  time: number,
  low = 110,
  high = 112,
  close = 111,
  volume = 1_000,
): YahooCandle {
  return {
    date: new Date(time),
    open: close,
    high,
    low,
    close,
    volume,
  };
}

function flatQuotes(): YahooCandle[] {
  return fixtureTimes().map((time) => quote(time));
}

function buyQuotes(): YahooCandle[] {
  const times = fixtureTimes();
  const quotes = times.map((time) => quote(time));

  quotes[85] = quote(times[85], 90, 110, 100, 2_000);
  quotes[86] = quote(times[86], 108, 114, 112);
  quotes[87] = quote(times[87], 109, 116, 114);
  // Match the signal low exactly at the post-2025 ₹0.01 NSE tick. The prior
  // fixture relied on legacy ₹0.05 rounding and ceased to be a valid BUY once
  // instrument-specific tick policy was enforced.
  quotes[91] = quote(times[91], 95.02, 108, 100, 900);
  quotes[92] = quote(times[92], 108, 111, 110);
  quotes[93] = quote(times[93], 109, 112, 111);
  quotes[99] = quote(times[99], 95.02, 108, 102);
  return quotes;
}

class PlaywrightYahooChartClient implements YahooChartClient {
  async chart(
    symbol: string,
    options: Parameters<YahooChartClient["chart"]>[1],
  ): Promise<{ quotes: YahooCandle[] }> {
    if (options.interval !== "1h") {
      throw new Error(`No deterministic fixture for ${options.interval}.`);
    }
    if (symbol === "RELIANCE.NS") {
      return { quotes: buyQuotes() };
    }
    if (symbol === "TCS.NS") {
      return { quotes: flatQuotes() };
    }
    if (symbol === "BROKEN.NS") {
      throw new Error("Deterministic provider failure");
    }
    throw Object.assign(new Error(`No data found for ${symbol}.`), {
      status: 404,
    });
  }
}

export class PlaywrightFixtureMarketDataProvider
  implements MarketDataProvider
{
  private readonly provider = new YahooMarketDataProvider({
    client: new PlaywrightYahooChartClient(),
    maxAttempts: 1,
    retryDelayMs: 0,
  });

  getCandles(
    symbol: string,
    timeframe: Timeframe,
  ): Promise<CandleResponse> {
    return this.provider.getCandles(symbol, timeframe, FIXTURE_NOW);
  }
}
