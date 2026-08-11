import type { Candle } from "@/lib/market/provider";
import { atrAt } from "./atr";
import { bullishRollover } from "./donchian";

export const REVERSAL_CONFIRMATION_VERSION = "confirmation-v1" as const;

export type ReversalConfirmationGrade = "STRONG" | "CONFIRMED" | "CORE_ONLY";

export interface ReversalConfirmation {
  version: typeof REVERSAL_CONFIRMATION_VERSION;
  score: number;
  grade: ReversalConfirmationGrade;
  closeLocation: number;
  lowerWickRatio: number;
  atrRecovery: number;
  volumeZScore: number | null;
  changePointScore: number;
  validPeriodCount: number;
  validPeriodRange: [number, number];
  higherTimeframe: "UNAVAILABLE";
  relativeStrength: "UNAVAILABLE";
  reasons: string[];
}

const EPSILON = 1e-9;
const VOLUME_LOOKBACK = 20;
const CHANGE_LOOKBACK = 20;
const PERIOD_RADIUS = 3;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function mad(values: number[], center: number): number {
  return median(values.map((value) => Math.abs(value - center)));
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function volumeZScore(candles: Candle[], signalIndex: number): number | null {
  const start = Math.max(0, signalIndex - VOLUME_LOOKBACK);
  const baseline = candles
    .slice(start, signalIndex)
    .map((candle) => candle.volume)
    .filter((volume) => Number.isFinite(volume) && volume >= 0);
  if (baseline.length < 5) return null;
  const center = median(baseline);
  const scale = 1.4826 * mad(baseline, center);
  if (scale <= EPSILON) return null;
  return (candles[signalIndex].volume - center) / scale;
}

function changePointScore(candles: Candle[], signalIndex: number): number {
  const start = Math.max(1, signalIndex - CHANGE_LOOKBACK + 1);
  const returns: number[] = [];
  for (let index = start; index <= signalIndex; index += 1) {
    const previous = candles[index - 1].close;
    const current = candles[index].close;
    if (previous > 0 && current > 0) returns.push(Math.log(current / previous));
  }
  if (returns.length < 5) return 0.5;
  const center = median(returns);
  const scale = Math.max(1.4826 * mad(returns, center), EPSILON);
  const cumulative = returns.reduce((sum, value) => sum + (value - center), 0);
  return clamp(0.5 + cumulative / (scale * Math.sqrt(returns.length) * 4));
}

function periodStability(
  candles: Candle[],
  signalIndex: number,
  selectedPeriod: number,
  tickSize: number,
): { count: number; range: [number, number] } {
  const valid: number[] = [];
  const first = Math.max(1, selectedPeriod - PERIOD_RADIUS);
  const last = Math.min(signalIndex, selectedPeriod + PERIOD_RADIUS);
  for (let period = first; period <= last; period += 1) {
    if (bullishRollover(candles, signalIndex, period, tickSize).passed) {
      valid.push(period);
    }
  }
  if (valid.length === 0) return { count: 0, range: [selectedPeriod, selectedPeriod] };
  return { count: valid.length, range: [valid[0], valid.at(-1)!] };
}

export function calculateReversalConfirmation(
  candles: Candle[],
  signalIndex: number,
  selectedPeriod: number,
  currentLdc: number,
  tickSize: number,
): ReversalConfirmation {
  if (!Number.isInteger(signalIndex) || signalIndex < 20 || signalIndex >= candles.length) {
    throw new RangeError("Confirmation signal index does not have enough history");
  }
  if (!Number.isInteger(selectedPeriod) || selectedPeriod <= 0 || tickSize <= 0) {
    throw new RangeError("Confirmation inputs are invalid");
  }

  const signal = candles[signalIndex];
  const range = Math.max(signal.high - signal.low, EPSILON);
  const closeLocation = clamp((signal.close - signal.low) / range);
  const lowerWickRatio = clamp(
    (Math.min(signal.open, signal.close) - signal.low) / range,
  );
  const atrRecovery = (signal.close - signal.low) / Math.max(atrAt(candles, signalIndex, 14), EPSILON);
  const volumeZ = finiteOrNull(volumeZScore(candles, signalIndex) ?? Number.NaN);
  const cpScore = changePointScore(candles, signalIndex);
  const stability = periodStability(candles, signalIndex, selectedPeriod, tickSize);
  const channelTouch = Math.abs(signal.low - currentLdc) <= tickSize / 2;

  const candleScore = 25 * closeLocation;
  const wickScore = 15 * clamp(lowerWickRatio / 0.5);
  const recoveryScore = 20 * clamp(atrRecovery / 1.5);
  const volumeScore = 15 * (volumeZ === null ? 0.5 : clamp(0.5 + volumeZ / 4));
  const changeScore = 15 * cpScore;
  const stabilityScore = 10 * clamp(stability.count / (PERIOD_RADIUS * 2 + 1));
  const score = Math.round(
    (candleScore + wickScore + recoveryScore + volumeScore + changeScore + stabilityScore) * 100,
  ) / 100;
  const grade: ReversalConfirmationGrade =
    score >= 75 ? "STRONG" : score >= 60 ? "CONFIRMED" : "CORE_ONLY";

  const reasons: string[] = [];
  if (channelTouch) reasons.push("signal low is aligned with the selected lower channel");
  if (closeLocation >= 0.65) reasons.push("closed in the upper third of the signal range");
  if (lowerWickRatio >= 0.5) reasons.push("lower-wick rejection is substantial");
  if (atrRecovery >= 0.5) reasons.push("recovered at least 0.5 ATR from the low");
  if (volumeZ !== null && volumeZ >= 1) reasons.push("volume is unusually high versus its baseline");
  if (cpScore >= 0.6) reasons.push("returns show a positive change-point impulse");
  if (stability.count >= 3) reasons.push(`Donchian condition remains valid across ${stability.count} nearby periods`);
  if (reasons.length === 0) reasons.push("Donchian rules pass, but secondary confirmation is limited");

  // Keep the explicit input in the calculation contract so callers cannot
  // accidentally score a different channel than the one that triggered BUY.
  void currentLdc;
  return {
    version: REVERSAL_CONFIRMATION_VERSION,
    score,
    grade,
    closeLocation,
    lowerWickRatio,
    atrRecovery,
    volumeZScore: volumeZ,
    changePointScore: cpScore,
    validPeriodCount: stability.count,
    validPeriodRange: stability.range,
    higherTimeframe: "UNAVAILABLE",
    relativeStrength: "UNAVAILABLE",
    reasons,
  };
}
