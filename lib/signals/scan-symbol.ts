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
import {
  auditDailyCandleWindow,
  auditIntradayCandleWindow,
  type DailyCandleWindowAudit,
  type IntradayCandleWindowAudit,
} from "@/lib/market/window-audit";
import {
  auditPeriodNeighborhood,
  isExactPeriodCandidate,
  selectRulesPeriod,
} from "./period-selector";
import type {
  PeriodAudit,
  PeriodStability,
  StructuralScoreComponents,
} from "./period-selector";
import {
  calculateReversalConfirmation,
  type ReversalConfirmation,
} from "./reversal-confirmation";
import {
  calculateSequentialEvidence,
  type ReversalState,
  type SequentialEvidence,
} from "./sequential-evidence";
import {
  calculateTradeDiagnostics,
  type TradeDiagnostics,
} from "./trade-diagnostics";
import { calculateTradeLevels } from "./risk-levels";
import { atrAt } from "./atr";
import { classifySignalTier, type EntryReadiness, type SignalTier } from "./signal-tier";
import { priceToTicks } from "./ticks";
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
  signalLow?: number;
  signalClose?: number;
  signalOpen?: number;
  signalHigh?: number;
  signalLowTick?: number;
  currentLdcTick?: number;
  previousLdcTick?: number;
  signalCandleTime?: number;
  windowStartTime?: number;
  windowEndTime?: number;
  previousWindowStartTime?: number;
  previousWindowEndTime?: number;
  providerAsOf?: number;
  rolloverTicks?: number;
  touchDistanceTicks?: number;
  /** LDC rise normalized by causal ATR; informational and non-gating. */
  rolloverStrengthAtr?: number;
  rolloverQuality?: "MEANINGFUL" | "MARGINAL";
  periodCandidateCount?: number;
  periodStability?: PeriodStability[];
  periodAudit?: PeriodAudit[];
  windowAudit?: DailyCandleWindowAudit;
  intradayWindowAudit?: IntradayCandleWindowAudit;
  anchorIndex?: number;
  anchorBarsAgo?: number;
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
  riskPerShare?: number;
  riskPercent?: number;
  target1RewardRisk?: number;
  target2RewardRisk?: number;
  stopBuffer?: number;
  stopBufferAtr?: number;
  scoreVersion: "structural-v1";
  score: number;
  scoreComponents: StructuralScoreComponents;
  higherTimeframeInput: "NEUTRAL_UNAVAILABLE";
  anchorRationale: string;
  confirmation?: ReversalConfirmation;
  /** Causal evidence state; the Donchian gate remains the hard BUY condition. */
  signalState?: ReversalState;
  sequentialEvidence?: SequentialEvidence;
  tradeDiagnostics?: TradeDiagnostics;
  signalTier?: SignalTier;
  tierScore?: number;
  entryReadiness?: EntryReadiness;
  tierReason?: string;
  tierWarnings?: string[];
  companyName?: string;
  industry?: string;
}

export type ScanStatus =
  | "BUY"
  | "NO_SIGNAL"
  | CandleResponse["status"]
  | "INVALID_INSTRUMENT"
  | "TICK_SIZE_UNRESOLVED"
  | "CALCULATION_ERROR"
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
    if (
      !isExactPeriodCandidate(
        candleResponse.candles,
        signalIndex,
        selected,
        tickResolution.tickSize,
      )
    ) {
      return { symbol: instrument.symbol, status: "NO_SIGNAL" };
    }
    const windowAudit =
      timeframe === "1d"
        ? auditDailyCandleWindow(
            candleResponse.candles,
            signalIndex - selected.period + 1,
            signalIndex,
          )
        : undefined;
    if (windowAudit !== undefined && !windowAudit.complete) {
      return {
        symbol: instrument.symbol,
        status: "NO_SIGNAL",
        message: `Incomplete daily Donchian window: ${windowAudit.missingSessions} NSE session(s) missing.`,
      };
    }
    const intradayWindowAudit = timeframe === "5m" || timeframe === "15m" || timeframe === "1h"
      ? auditIntradayCandleWindow(candleResponse.candles, signalIndex - selected.period + 1, signalIndex, timeframe)
      : undefined;
    if (intradayWindowAudit !== undefined && !intradayWindowAudit.complete) {
      return {
        symbol: instrument.symbol,
        status: "NO_SIGNAL",
        message: `Incomplete intraday Donchian window: ${intradayWindowAudit.missingBars} bar(s) missing.`,
      };
    }
    const levels = calculateTradeLevels(
      candleResponse.candles,
      signalIndex,
      selected.anchor.index,
      tickResolution.tickSize,
    );
    if (levels === null) {
      return { symbol: instrument.symbol, status: "NO_SIGNAL" };
    }
    const signalAtr = atrAt(candleResponse.candles, signalIndex, ATR_PERIOD);
    const currentLdcTick = priceToTicks(selected.currentLdc, tickResolution.tickSize);
    const previousLdcTick = priceToTicks(selected.previousLdc, tickResolution.tickSize);
    const rolloverStrengthAtr = (currentLdcTick - previousLdcTick) * tickResolution.tickSize / Math.max(signalAtr, tickResolution.tickSize);
    const confirmation = calculateReversalConfirmation(
      candleResponse.candles,
      signalIndex,
      selected.period,
      selected.currentLdc,
      tickResolution.tickSize,
    );
    const sequentialEvidence = calculateSequentialEvidence(
      candleResponse.candles,
      signalIndex,
    );
    const tradeDiagnostics = calculateTradeDiagnostics({
      confirmation,
      sequential: sequentialEvidence,
      rewardRisk: levels.rewardRisk,
      ...(windowAudit ? { windowAudit } : {}),
      ...(intradayWindowAudit ? { intradayWindowAudit } : {}),
    });
    const tier = classifySignalTier({
      confirmation,
      sequential: sequentialEvidence,
      rewardRisk: levels.rewardRisk,
      dataQuality: tradeDiagnostics.dataQuality,
      stop: levels.stop,
      target1: levels.target1,
    });

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
      signalLow: signal.low,
      signalClose: signal.close,
      signalOpen: signal.open,
      signalHigh: signal.high,
      signalLowTick: priceToTicks(signal.low, tickResolution.tickSize),
      currentLdcTick: priceToTicks(selected.currentLdc, tickResolution.tickSize),
      previousLdcTick: priceToTicks(selected.previousLdc, tickResolution.tickSize),
      signalCandleTime: signal.time,
      windowStartTime: candleResponse.candles[signalIndex - selected.period + 1].time,
      windowEndTime: signal.time,
      previousWindowStartTime: candleResponse.candles[signalIndex - selected.period].time,
      previousWindowEndTime: candleResponse.candles[signalIndex - 1].time,
      providerAsOf: candleResponse.asOf,
      rolloverTicks:
        priceToTicks(selected.currentLdc, tickResolution.tickSize) -
        priceToTicks(selected.previousLdc, tickResolution.tickSize),
      touchDistanceTicks:
        Math.abs(
          priceToTicks(signal.low, tickResolution.tickSize) -
            priceToTicks(selected.currentLdc, tickResolution.tickSize),
        ),
      rolloverStrengthAtr,
      rolloverQuality: rolloverStrengthAtr >= 0.1 ? "MEANINGFUL" : "MARGINAL",
      periodCandidateCount: selection.candidates.length,
      periodStability: selection.stability,
      periodAudit: auditPeriodNeighborhood(
        candleResponse.candles,
        signalIndex,
        selected.period,
        tickResolution.tickSize,
      ),
      ...(windowAudit ? { windowAudit } : {}),
      anchorIndex: selected.anchor.index,
      anchorBarsAgo: signalIndex - selected.anchor.index,
      anchorTime: selected.anchor.time,
      strategyVersion: STRATEGY_VERSION,
      dataAsOf: candleResponse.asOf,
      adjustmentMode: candleResponse.adjustmentMode,
      tickSize: tickResolution.tickSize,
      tickPolicy: tickResolution.policy,
      reactionHigh: levels.reactionHigh,
      rewardRisk: levels.rewardRisk,
      riskPerShare: levels.riskPerShare,
      riskPercent: levels.riskPercent,
      target1RewardRisk: levels.target1RewardRisk,
      target2RewardRisk: levels.target2RewardRisk,
      stopBuffer: levels.stopBuffer,
      stopBufferAtr: levels.stopBufferAtr,
      scoreVersion: selected.scoreVersion,
      score: selected.score,
      scoreComponents: selected.scoreComponents,
      higherTimeframeInput: "NEUTRAL_UNAVAILABLE",
      anchorRationale: `Selected confirmed pivot low ${selected.period} bars earlier: prominence ${selected.anchor.prominenceAtr.toFixed(2)} ATR, recovery ${selected.anchor.recoveryAtr.toFixed(2)} ATR, ${selected.scoreVersion} score ${selected.score.toFixed(4)}. Higher-timeframe input is unavailable and contributes a neutral zero.`,
      confirmation,
      signalState: sequentialEvidence.state,
      sequentialEvidence,
      tradeDiagnostics,
      signalTier: tier.tier,
      tierScore: tier.tierScore,
      entryReadiness: tier.entryReadiness,
      tierReason: tier.tierReason,
      tierWarnings: tier.warnings,
      ...(resolvedInstrument.companyName
        ? { companyName: resolvedInstrument.companyName }
        : {}),
      ...(resolvedInstrument.industry ? { industry: resolvedInstrument.industry } : {}),
    };

    return { symbol: instrument.symbol, status: "BUY", recommendation };
  } catch {
    return {
      symbol: instrument.symbol,
      status: "CALCULATION_ERROR",
      message: `Scan evaluation failed for ${instrument.symbol}.`,
    };
  }
}
