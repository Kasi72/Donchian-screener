export const STRATEGY_VERSION = "rules-v1";

export const ATR_PERIOD = 14;
export const PIVOT_LEFT_BARS = 2;
export const PIVOT_RIGHT_BARS = 2;
export const MIN_PIVOT_PROMINENCE_ATR = 0.25;
export const MIN_PIVOT_RECOVERY_ATR = 0.5;
export const DEFAULT_TICK_SIZE = 0.05;

export const STRATEGY_CONFIG = Object.freeze({
  version: STRATEGY_VERSION,
  atrPeriod: ATR_PERIOD,
  pivotLeftBars: PIVOT_LEFT_BARS,
  pivotRightBars: PIVOT_RIGHT_BARS,
  minPivotProminenceAtr: MIN_PIVOT_PROMINENCE_ATR,
  minPivotRecoveryAtr: MIN_PIVOT_RECOVERY_ATR,
  defaultTickSize: DEFAULT_TICK_SIZE,
});
