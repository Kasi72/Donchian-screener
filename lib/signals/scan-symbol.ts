import type { UniverseInstrument } from "@/lib/domain/types";
import type {
  Candle,
  CandleResponse,
  MarketDataProvider,
  Timeframe,
} from "@/lib/market/provider";
import { selectRulesPeriod } from "./period-selector";
import { calculateTradeLevels } from "./risk-levels";
import {
  ATR_PERIOD,
  DEFAULT_TICK_SIZE,
  PIVOT_RIGHT_BARS,
  STRATEGY_VERSION,
} from "./strategy-config";

export interface BuyRecommendation {
  recommendation: "BUY";
  symbol: string;
  yahooSymbol: string;
  timeframe: Timeframe;
  signalTime: number;
  autoPeriod: number;
  probability: null;
  entry: number;
  stop: number;
  target1: number;
  target2: number;
  currentLdc: number;
  previousLdc: number;
  anchorTime: number;
  strategyVersion: typeof STRATEGY_VERSION;
  dataAsOf: number;
}

export type ScanStatus =
  | "BUY"
  | "NO_SIGNAL"
  | CandleResponse["status"]
  | "PROVIDER_ERROR";

export interface ScanItemResult {
  symbol: string;
  status: ScanStatus;
  recommendation?: BuyRecommendation;
  message?: string;
}

function providerFailure(symbol: string): ScanItemResult {
  return {
    symbol,
    status: "PROVIDER_ERROR",
    message: `Market data provider failed for ${symbol}.`,
  };
}

const CANDLE_STATUSES = new Set<CandleResponse["status"]>([
  "OK",
  "INSUFFICIENT_HISTORY",
  "SYMBOL_NOT_FOUND",
  "PROVIDER_RATE_LIMITED",
  "STALE_DATA",
  "INVALID_CANDLES",
]);

function isCandle(value: unknown): value is Candle {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return ["time", "open", "high", "low", "close", "volume"].every(
    (field) =>
      typeof candidate[field] === "number" &&
      Number.isFinite(candidate[field]),
  );
}

function isCandleResponse(value: unknown): value is CandleResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.status === "string" &&
    CANDLE_STATUSES.has(candidate.status as CandleResponse["status"]) &&
    Array.isArray(candidate.candles) &&
    candidate.candles.every(isCandle) &&
    typeof candidate.asOf === "number" &&
    Number.isFinite(candidate.asOf)
  );
}

export async function scanSymbol(
  instrument: UniverseInstrument,
  timeframe: Timeframe,
  provider: MarketDataProvider,
  now?: Date,
): Promise<ScanItemResult> {
  let candleResponse: CandleResponse;
  try {
    const response: unknown = await provider.getCandles(
      instrument.yahooSymbol,
      timeframe,
      now,
    );
    if (!isCandleResponse(response)) {
      return providerFailure(instrument.symbol);
    }
    candleResponse = response;
  } catch {
    return providerFailure(instrument.symbol);
  }

  if (candleResponse.status !== "OK") {
    return { symbol: instrument.symbol, status: candleResponse.status };
  }

  const signalIndex = candleResponse.candles.length - 1;
  if (signalIndex < ATR_PERIOD + PIVOT_RIGHT_BARS) {
    return { symbol: instrument.symbol, status: "INSUFFICIENT_HISTORY" };
  }

  try {
    const selection = selectRulesPeriod(candleResponse.candles, signalIndex);
    if (selection.selected === undefined) {
      return { symbol: instrument.symbol, status: "NO_SIGNAL" };
    }

    const selected = selection.selected;
    const levels = calculateTradeLevels(
      candleResponse.candles,
      signalIndex,
      selected.anchor.index,
      DEFAULT_TICK_SIZE,
    );
    if (levels === null) {
      return { symbol: instrument.symbol, status: "NO_SIGNAL" };
    }

    const signal = candleResponse.candles[signalIndex];
    const recommendation: BuyRecommendation = {
      recommendation: "BUY",
      symbol: instrument.symbol,
      yahooSymbol: instrument.yahooSymbol,
      timeframe,
      signalTime: signal.time,
      autoPeriod: selected.period,
      probability: null,
      entry: levels.entry,
      stop: levels.stop,
      target1: levels.target1,
      target2: levels.target2,
      currentLdc: selected.currentLdc,
      previousLdc: selected.previousLdc,
      anchorTime: selected.anchor.time,
      strategyVersion: STRATEGY_VERSION,
      dataAsOf: candleResponse.asOf,
    };

    return { symbol: instrument.symbol, status: "BUY", recommendation };
  } catch {
    return {
      symbol: instrument.symbol,
      status: "PROVIDER_ERROR",
      message: `Scan evaluation failed for ${instrument.symbol}.`,
    };
  }
}
