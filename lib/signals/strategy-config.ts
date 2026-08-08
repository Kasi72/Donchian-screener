export const STRATEGY_VERSION = "rules-v1";

export const ATR_PERIOD = 14;
export const PIVOT_LEFT_BARS = 2;
export const PIVOT_RIGHT_BARS = 2;
export const MIN_PIVOT_PROMINENCE_ATR = 0.25;
export const MIN_PIVOT_RECOVERY_ATR = 0.5;
export const DEFAULT_TICK_SIZE = 0.05;

export const STRUCTURAL_SCORE_VERSION = "structural-v1";
export const STRUCTURAL_SCORE_CONFIG = Object.freeze({
  version: STRUCTURAL_SCORE_VERSION,
  weights: Object.freeze({
    prominence: 0.3,
    recovery: 0.25,
    recency: 0.15,
    retests: 0.15,
    relativeVolume: 0.1,
    higherTimeframeAgreement: 0.05,
  }),
  prominenceAtrCap: 2,
  recoveryAtrCap: 3,
  ageBarsCap: 200,
  retestZoneAtr: 0.25,
  retestCountCap: 3,
  relativeVolumeLookback: 20,
  relativeVolumeCap: 2,
  // The current selector has no higher-timeframe input. Keeping the component
  // explicit and neutral prevents an unavailable feature from being invented.
  unavailableHigherTimeframeAgreement: 0,
});

export const STRATEGY_CONFIG = Object.freeze({
  version: STRATEGY_VERSION,
  atrPeriod: ATR_PERIOD,
  pivotLeftBars: PIVOT_LEFT_BARS,
  pivotRightBars: PIVOT_RIGHT_BARS,
  minPivotProminenceAtr: MIN_PIVOT_PROMINENCE_ATR,
  minPivotRecoveryAtr: MIN_PIVOT_RECOVERY_ATR,
  defaultTickSize: DEFAULT_TICK_SIZE,
  structuralScore: STRUCTURAL_SCORE_CONFIG,
});
