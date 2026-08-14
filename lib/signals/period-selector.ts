import type { Candle } from "@/lib/market/provider";
import { atrAt } from "./atr";
import { bullishRollover } from "./donchian";
import { findConfirmedPivotLows, type PivotLow } from "./pivots";
import {
  ATR_PERIOD,
  STRUCTURAL_SCORE_CONFIG,
  STRUCTURAL_SCORE_VERSION,
} from "./strategy-config";

export interface PeriodCandidate {
  anchor: PivotLow;
  period: number;
  score: number;
  scoreVersion: typeof STRUCTURAL_SCORE_VERSION;
  scoreComponents: StructuralScoreComponents;
  currentLdc: number;
  previousLdc: number;
}

export interface PeriodAudit {
  period: number;
  currentLdc: number | null;
  previousLdc: number | null;
  currentLdcTick: number | null;
  previousLdcTick: number | null;
  signalLowTick: number | null;
  touchPassed: boolean;
  rolloverPassed: boolean;
  valid: boolean;
}

export interface PeriodStability {
  period: number;
  validNeighborCount: number;
  neighborhoodSize: number;
  stabilityScore: number;
}

export interface StructuralScoreComponents {
  prominence: number;
  recovery: number;
  recency: number;
  retests: number;
  relativeVolume: number;
  higherTimeframeAgreement: number;
}

export interface StructuralScore {
  version: typeof STRUCTURAL_SCORE_VERSION;
  score: number;
  components: StructuralScoreComponents;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function countSuccessfulRetests(
  candles: Candle[],
  signalIndex: number,
  anchor: PivotLow,
): number {
  const pivotAtr = atrAt(candles, anchor.index, ATR_PERIOD);
  const zoneCeiling =
    anchor.low + STRUCTURAL_SCORE_CONFIG.retestZoneAtr * pivotAtr;
  let count = 0;
  let wasInZone = false;

  for (
    let index = anchor.confirmedAt + 1;
    index < signalIndex;
    index += 1
  ) {
    const candle = candles[index];
    const isSuccessfulTest =
      candle.low >= anchor.low &&
      candle.low <= zoneCeiling &&
      candle.close > anchor.low;

    if (isSuccessfulTest && !wasInZone) {
      count += 1;
    }
    wasInZone = isSuccessfulTest;
  }

  return count;
}

function relativePivotVolume(candles: Candle[], anchorIndex: number): number {
  const start = Math.max(
    0,
    anchorIndex - STRUCTURAL_SCORE_CONFIG.relativeVolumeLookback,
  );
  const baseline = median(
    candles
      .slice(start, anchorIndex)
      .map((candle) => candle.volume)
      .filter((volume) => Number.isFinite(volume) && volume > 0),
  );

  if (baseline <= 0) {
    return 0;
  }
  return candles[anchorIndex].volume / baseline;
}

/** Frozen engineering heuristic for Rules BUY candidate ranking. */
export function structuralScore(
  candles: Candle[],
  signalIndex: number,
  anchor: PivotLow,
): StructuralScore {
  const components: StructuralScoreComponents = {
    prominence: clampUnit(
      anchor.prominenceAtr / STRUCTURAL_SCORE_CONFIG.prominenceAtrCap,
    ),
    recovery: clampUnit(
      anchor.recoveryAtr / STRUCTURAL_SCORE_CONFIG.recoveryAtrCap,
    ),
    recency: clampUnit(
      1 -
        (signalIndex - anchor.index) / STRUCTURAL_SCORE_CONFIG.ageBarsCap,
    ),
    retests: clampUnit(
      countSuccessfulRetests(candles, signalIndex, anchor) /
        STRUCTURAL_SCORE_CONFIG.retestCountCap,
    ),
    relativeVolume: clampUnit(
      relativePivotVolume(candles, anchor.index) /
        STRUCTURAL_SCORE_CONFIG.relativeVolumeCap,
    ),
    higherTimeframeAgreement:
      STRUCTURAL_SCORE_CONFIG.unavailableHigherTimeframeAgreement,
  };
  const weights = STRUCTURAL_SCORE_CONFIG.weights;
  const score =
    components.prominence * weights.prominence +
    components.recovery * weights.recovery +
    components.recency * weights.recency +
    components.retests * weights.retests +
    components.relativeVolume * weights.relativeVolume +
    components.higherTimeframeAgreement * weights.higherTimeframeAgreement;

  return { version: STRUCTURAL_SCORE_VERSION, score, components };
}

function ranksBefore(left: PeriodCandidate, right: PeriodCandidate): boolean {
  if (left.score !== right.score) {
    return left.score > right.score;
  }
  if (left.anchor.prominenceAtr !== right.anchor.prominenceAtr) {
    return left.anchor.prominenceAtr > right.anchor.prominenceAtr;
  }
  return left.anchor.index > right.anchor.index;
}

export function selectHighestPeriodCandidate(
  candidates: PeriodCandidate[],
): PeriodCandidate | undefined {
  let selected: PeriodCandidate | undefined;
  for (const candidate of candidates) {
    if (selected === undefined || ranksBefore(candidate, selected)) {
      selected = candidate;
    }
  }
  return selected;
}

/**
 * Ranks valid periods by local stability before using the structural score.
 * A period remains eligible when its own Donchian gate passes; neighboring
 * periods are evidence about parameter fragility, not an additional hard gate.
 */
export function selectStablePeriodCandidate(
  candidates: PeriodCandidate[],
  stability: PeriodStability[],
): PeriodCandidate | undefined {
  const stabilityByPeriod = new Map(stability.map((item) => [item.period, item]));
  let selected: PeriodCandidate | undefined;
  for (const candidate of candidates) {
    const currentStability = stabilityByPeriod.get(candidate.period)?.stabilityScore ?? 0;
    if (selected === undefined) {
      selected = candidate;
      continue;
    }
    const selectedStability = stabilityByPeriod.get(selected.period)?.stabilityScore ?? 0;
    if (currentStability > selectedStability ||
      (currentStability === selectedStability && ranksBefore(candidate, selected))) {
      selected = candidate;
    }
  }
  return selected;
}

function periodStability(
  candles: Candle[],
  signalIndex: number,
  period: number,
  tickSize: number,
  radius = 2,
): PeriodStability {
  const audits = auditPeriodNeighborhood(candles, signalIndex, period, tickSize, radius);
  const validNeighborCount = audits.filter((audit) => audit.valid).length;
  const neighborhoodSize = audits.length;
  return {
    period,
    validNeighborCount,
    neighborhoodSize,
    stabilityScore: neighborhoodSize === 0 ? 0 : validNeighborCount / neighborhoodSize,
  };
}

export function isUniquePeriodSelection(candidates: PeriodCandidate[]): boolean {
  return candidates.length === 1;
}

export function auditPeriodNeighborhood(
  candles: Candle[],
  signalIndex: number,
  selectedPeriod: number,
  tickSize: number,
  radius = 2,
): PeriodAudit[] {
  if (!Number.isInteger(selectedPeriod) || selectedPeriod <= 0) return [];
  const toTicks = (value: number): number => Math.round(value / tickSize);
  const signalLowTick =
    signalIndex >= 0 && signalIndex < candles.length
      ? toTicks(candles[signalIndex].low)
      : null;
  const audits: PeriodAudit[] = [];
  for (
    let period = Math.max(1, selectedPeriod - Math.max(0, Math.floor(radius)));
    period <= selectedPeriod + Math.max(0, Math.floor(radius));
    period += 1
  ) {
    try {
      const rollover = bullishRollover(candles, signalIndex, period, tickSize);
      const currentLdcTick = toTicks(rollover.currentLdc);
      const previousLdcTick = toTicks(rollover.previousLdc);
      const touchPassed = signalLowTick !== null && signalLowTick === currentLdcTick;
      const rolloverPassed = currentLdcTick > previousLdcTick;
      audits.push({
        period,
        currentLdc: rollover.currentLdc,
        previousLdc: rollover.previousLdc,
        currentLdcTick,
        previousLdcTick,
        signalLowTick,
        touchPassed,
        rolloverPassed,
        valid: touchPassed && rolloverPassed,
      });
    } catch {
      audits.push({
        period,
        currentLdc: null,
        previousLdc: null,
        currentLdcTick: null,
        previousLdcTick: null,
        signalLowTick,
        touchPassed: false,
        rolloverPassed: false,
        valid: false,
      });
    }
  }
  return audits;
}

/**
 * Defense-in-depth check for the exact period/window contract exported to users.
 * A candidate is valid only when recomputing its period reproduces both
 * Donchian windows and the tick-normalized rollover gate at the signal bar.
 */
export function isExactPeriodCandidate(
  candles: Candle[],
  signalIndex: number,
  candidate: PeriodCandidate,
  tickSize: number,
): boolean {
  if (!Number.isInteger(candidate.period) || candidate.period <= 0) {
    return false;
  }
  try {
    const rollover = bullishRollover(
      candles,
      signalIndex,
      candidate.period,
      tickSize,
    );
    const toTicks = (value: number): number => Math.round(value / tickSize);
    return (
      rollover.passed &&
      toTicks(rollover.currentLdc) === toTicks(candidate.currentLdc) &&
      toTicks(rollover.previousLdc) === toTicks(candidate.previousLdc)
    );
  } catch {
    return false;
  }
}

export function selectRulesPeriod(
  candles: Candle[],
  signalIndex: number,
  tickSize: number,
): { selected?: PeriodCandidate; candidates: PeriodCandidate[]; stability: PeriodStability[] } {
  const anchors = findConfirmedPivotLows(candles, signalIndex);
  const candidates: PeriodCandidate[] = [];

  for (const anchor of anchors) {
    const period = signalIndex - anchor.index;
    const rollover = bullishRollover(candles, signalIndex, period, tickSize);
    if (!rollover.passed) {
      continue;
    }

    const score = structuralScore(candles, signalIndex, anchor);
    candidates.push({
      anchor,
      period,
      score: score.score,
      scoreVersion: score.version,
      scoreComponents: score.components,
      currentLdc: rollover.currentLdc,
      previousLdc: rollover.previousLdc,
    });
  }

  const stability = candidates.map((candidate) =>
    periodStability(candles, signalIndex, candidate.period, tickSize),
  );
  const selected = selectStablePeriodCandidate(candidates, stability);

  return selected === undefined ? { candidates, stability } : { selected, candidates, stability };
}
