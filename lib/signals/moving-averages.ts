import type { Candle } from "@/lib/market/provider";

export interface MovingAverageEvidence {
  emaFast: number;
  emaSlow: number;
  wmaFast: number;
  kama: number;
  t3: number;
  emaSlope: number;
  wmaSlope: number;
  kamaSlope: number;
  t3Slope: number;
  efficiencyRatio: number;
  score: number;
}

const EPSILON = 1e-9;
const FAST = 10;
const SLOW = 30;

function clamp(value: number, min = 0, max = 1): number { return Math.max(min, Math.min(max, value)); }
function ema(values: readonly number[], period: number): number[] {
  const alpha = 2 / (period + 1); const result: number[] = [];
  values.forEach((value, index) => { result.push(index === 0 ? value : alpha * value + (1 - alpha) * result[index - 1]); });
  return result;
}
function wma(values: readonly number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - period + 1); const window = values.slice(start, i + 1); const denominator = window.length * (window.length + 1) / 2;
    result.push(window.reduce((sum, value, j) => sum + value * (j + 1), 0) / denominator);
  }
  return result;
}
function kama(values: readonly number[], period = 10, fast = 2, slow = 30): number[] {
  const result: number[] = [values[0]]; const fastSc = 2 / (fast + 1); const slowSc = 2 / (slow + 1);
  for (let i = 1; i < values.length; i += 1) {
    const start = Math.max(0, i - period); const change = Math.abs(values[i] - values[start]);
    let volatility = 0; for (let j = start + 1; j <= i; j += 1) volatility += Math.abs(values[j] - values[j - 1]);
    const efficiency = volatility <= EPSILON ? 0 : change / volatility;
    const smoothing = (efficiency * (fastSc - slowSc) + slowSc) ** 2;
    result.push(result[i - 1] + smoothing * (values[i] - result[i - 1]));
  }
  return result;
}
function t3(values: readonly number[], period = 10, volumeFactor = 0.7): number[] {
  const e1 = ema(values, period); const e2 = ema(e1, period); const e3 = ema(e2, period); const e4 = ema(e3, period); const e5 = ema(e4, period); const e6 = ema(e5, period);
  const v = volumeFactor; const c1 = -(v ** 3); const c2 = 3 * v ** 2 + 3 * v ** 3; const c3 = -6 * v ** 2 - 3 * v - 3 * v ** 3; const c4 = 1 + 3 * v + v ** 3 + 3 * v ** 2;
  return values.map((_, i) => c1 * e6[i] + c2 * e5[i] + c3 * e4[i] + c4 * e3[i]);
}

/** Causal moving-average evidence at a completed candle. */
export function calculateMovingAverageEvidence(candles: readonly Candle[], signalIndex: number, atr: number): MovingAverageEvidence {
  if (!Number.isInteger(signalIndex) || signalIndex < 1 || signalIndex >= candles.length || !Number.isFinite(atr) || atr <= 0) throw new RangeError("Invalid moving-average inputs");
  const closes = candles.slice(0, signalIndex + 1).map((candle) => candle.close);
  const e = ema(closes, FAST); const slow = ema(closes, SLOW); const w = wma(closes, FAST); const k = kama(closes); const t = t3(closes);
  const previous = (series: number[]) => series[Math.max(0, series.length - 2)];
  const scale = Math.max(atr, EPSILON); const latest = closes.at(-1)!;
  const emaSlope = (e.at(-1)! - previous(e)) / scale; const wmaSlope = (w.at(-1)! - previous(w)) / scale; const kamaSlope = (k.at(-1)! - previous(k)) / scale; const t3Slope = (t.at(-1)! - previous(t)) / scale;
  const start = Math.max(0, closes.length - 10); const change = Math.abs(latest - closes[start]); let volatility = 0; for (let i = start + 1; i < closes.length; i += 1) volatility += Math.abs(closes[i] - closes[i - 1]);
  const efficiencyRatio = volatility <= EPSILON ? 0 : clamp(change / volatility);
  const reclaim = [latest > e.at(-1)!, latest > slow.at(-1)!, latest > k.at(-1)!, latest > t.at(-1)!].filter(Boolean).length / 4;
  const slopeEvidence = [emaSlope, wmaSlope, kamaSlope, t3Slope].reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0) / 4;
  const flat = [emaSlope, wmaSlope, kamaSlope, t3Slope].every((value) => Math.abs(value) < 1e-12) && efficiencyRatio === 0;
  const score = flat ? 0.5 : clamp(0.45 * slopeEvidence + 0.35 * reclaim + 0.20 * efficiencyRatio);
  return { emaFast: e.at(-1)!, emaSlow: slow.at(-1)!, wmaFast: w.at(-1)!, kama: k.at(-1)!, t3: t.at(-1)!, emaSlope, wmaSlope, kamaSlope, t3Slope, efficiencyRatio, score };
}
