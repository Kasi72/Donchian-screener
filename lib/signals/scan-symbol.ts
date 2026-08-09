import type { UniverseInstrument } from "@/lib/domain/types";
import {
  resolveCanonicalNseInstrument,
  resolveNseTickSize,
} from "@/lib/instruments/nse-instruments";
import type {
  AdjustmentMode,
  Candle,
  CandleResponse,
  MarketDataProvider,
  Timeframe,
} from "@/lib/market/provider";
import { selectRulesPeriod } from "./period-selector";
import type { StructuralScoreComponents } from "./period-selector";
import { calculateTradeLevels } from "./risk-levels";
import {
  ATR_PERIOD,
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
  adjustmentMode: AdjustmentMode;
  tickSize: number;
  tickPolicy:
    | "nse-cm-price-band-2025-v1"
    | "nse-cm-legacy-0.05-v1"
    | "nse-index-metadata-v1";
  reactionHigh: number;
  rewardRisk: number;
  scoreVersion: "structural-v1";
  score: number;
  scoreComponents: StructuralScoreComponents;
  higherTimeframeInput: "NEUTRAL_UNAVAILABLE";
  anchorRationale: string;
  companyName?: string;
  industry?: string;
}

export type ScanStatus =
  | "BUY"
  | "NO_SIGNAL"
  | CandleResponse["status"]
  | "INVALID_INSTRUMENT"
  | "TICK_SIZE_UNRESOLVED"
  | "PROVIDER_ERROR";

export interface ScanItemResult {
  symbol: string;
  status: ScanStatus;
  recommendation?: BuyRecommendation;
  message?: string;
}

export interface ScanSymbolOptions {
  now?: Date;
  signal?: AbortSignal;
  deadlineMs?: number;
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
  "DATA_QUALITY_LIMITATION",
  "PROVIDER_TIMEOUT",
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
    Number.isFinite(candidate.asOf) &&
    (candidate.adjustmentMode === "RAW" || candidate.adjustmentMode === "BACK_ADJUSTED")
  );
}

export async function scanSymbol(
  instrument: UniverseInstrument,
  timeframe: Timeframe,
  provider: MarketDataProvider,
  options: ScanSymbolOptions = {},
): Promise<ScanItemResult> {
  const instrumentResolution = resolveCanonicalNseInstrument(instrument);
  if (instrumentResolution.status !== "OK") {
    return { symbol: instrument.symbol, status: instrumentResolution.status };
  }
  const resolvedInstrument = instrumentResolution.instrument;
  let candleResponse: CandleResponse;
  try {
    const response: unknown = await provider.getCandles(
      resolvedInstrument.providerSymbol,
      timeframe,
      options.now,
      { signal: options.signal, deadlineMs: options.deadlineMs },
    );
    if (!isCandleResponse(response)) {
      return providerFailure(instrument.symbol);
    }
    candleResponse = response;
  } catch (error) {
    if (options.signal?.aborted) {
      const reason = options.signal.reason;
      if (reason instanceof DOMException && reason.name === "TimeoutError") {
        return { symbol: instrument.symbol, status: "PROVIDER_TIMEOUT" };
      }
      throw reason ?? error;
    }
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
    const tickResolution = resolveNseTickSize(
      resolvedInstrument,
      candleResponse.candles,
      signalIndex,
    );
    if (tickResolution.status !== "OK") {
      return { symbol: instrument.symbol, status: tickResolution.status };
    }

    const signal = candleResponse.candles[signalIndex];
    if (signal.close <= signal.low) {
      return { symbol: instrument.symbol, status: "NO_SIGNAL" };
    }

    const selection = selectRulesPeriod(
      candleResponse.candles,
      signalIndex,
      tickResolution.tickSize,
    );
    if (selection.selected === undefined) {
      return { symbol: instrument.symbol, status: "NO_SIGNAL" };
    }

    const selected = selection.selected;
    const levels = calculateTradeLevels(
      candleResponse.candles,
      signalIndex,
      selected.anchor.index,
      tickResolution.tickSize,
    );
    if (levels === null) {
      return { symbol: instrument.symbol, status: "NO_SIGNAL" };
    }

    const recommendation: BuyRecommendation = {
      recommendation: "BUY",
      symbol: instrument.symbol,
      yahooSymbol: resolvedInstrument.providerSymbol,
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
      adjustmentMode: candleResponse.adjustmentMode,
      tickSize: tickResolution.tickSize,
      tickPolicy: tickResolution.policy,
      reactionHigh: levels.reactionHigh,
      rewardRisk: levels.rewardRisk,
      scoreVersion: selected.scoreVersion,
      score: selected.score,
      scoreComponents: selected.scoreComponents,
      higherTimeframeInput: "NEUTRAL_UNAVAILABLE",
      anchorRationale: `Selected confirmed pivot low ${selected.period} bars earlier: prominence ${selected.anchor.prominenceAtr.toFixed(2)} ATR, recovery ${selected.anchor.recoveryAtr.toFixed(2)} ATR, ${selected.scoreVersion} score ${selected.score.toFixed(4)}. Higher-timeframe input is unavailable and contributes a neutral zero.`,
      ...(resolvedInstrument.companyName
        ? { companyName: resolvedInstrument.companyName }
        : {}),
      ...(resolvedInstrument.industry ? { industry: resolvedInstrument.industry } : {}),
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
