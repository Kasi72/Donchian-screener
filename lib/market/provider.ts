export type Timeframe = "5m" | "15m" | "1h" | "1d" | "1wk" | "1mo";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type CandleStatus =
  | "OK"
  | "INSUFFICIENT_HISTORY"
  | "SYMBOL_NOT_FOUND"
  | "PROVIDER_RATE_LIMITED"
  | "STALE_DATA"
  | "INVALID_CANDLES"
  | "DATA_QUALITY_LIMITATION"
  | "PROVIDER_TIMEOUT";

export type AdjustmentMode = "RAW" | "BACK_ADJUSTED";

export interface CandleResponse {
  status: CandleStatus;
  candles: Candle[];
  asOf: number;
  adjustmentMode: AdjustmentMode;
}

export interface MarketDataProvider {
  getCandles(
    symbol: string,
    timeframe: Timeframe,
    now?: Date,
    options?: MarketDataRequestOptions,
  ): Promise<CandleResponse>;
}

export interface MarketDataRequestOptions {
  signal?: AbortSignal;
  deadlineMs?: number;
}
