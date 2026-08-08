import { describe, expect, it } from "vitest";

import {
  MINIMUM_CANDLE_COUNT,
  isCandleComplete,
  normalizeCandles,
} from "@/lib/market/normalize-candles";

const IST = "+05:30";

function candle(time: string, overrides: Record<string, unknown> = {}) {
  return {
    date: new Date(time),
    open: 100,
    high: 105,
    low: 99,
    close: 103,
    volume: 1_000,
    ...overrides,
  };
}

describe("normalizeCandles", () => {
  it("sorts chronologically, keeps one candle per timestamp, rejects null OHLC, and excludes a forming candle", () => {
    const now = new Date(`2026-08-10T10:07:00${IST}`);
    const older = candle(`2026-08-10T09:55:00${IST}`);
    const duplicate = candle(`2026-08-10T10:00:00${IST}`, { close: 104 });
    const duplicateReplacement = candle(`2026-08-10T10:00:00${IST}`, {
      high: 107,
      close: 106,
    });
    const invalid = candle(`2026-08-10T09:50:00${IST}`, { close: null });
    const forming = candle(`2026-08-10T10:05:00${IST}`);

    const result = normalizeCandles(
      [forming, duplicate, invalid, older, duplicateReplacement],
      "5m",
      now,
    );

    expect(result.candles).toEqual([
      expect.objectContaining({ time: older.date.getTime(), close: 103 }),
      expect.objectContaining({ time: duplicate.date.getTime(), close: 106 }),
    ]);
    expect(result.status).toBe("INSUFFICIENT_HISTORY");
    expect(result.asOf).toBe(duplicate.date.getTime());
  });

  it("rejects a completed feed whose newest candle is stale", () => {
    const now = new Date(`2026-08-10T12:00:00${IST}`);
    const stale = candle(`2026-08-10T11:30:00${IST}`);

    const result = normalizeCandles(
      Array.from({ length: MINIMUM_CANDLE_COUNT }, () => stale),
      "5m",
      now,
    );

    expect(result.status).toBe("STALE_DATA");
    expect(result.candles).toHaveLength(1);
  });

  it("reports insufficient history after cleaning otherwise valid completed candles", () => {
    const now = new Date(`2026-08-10T12:00:00${IST}`);
    const firstCandle = new Date(`2026-08-10T03:45:00${IST}`).getTime();
    const candles = Array.from({ length: MINIMUM_CANDLE_COUNT - 1 }, (_, index) =>
      candle(new Date(firstCandle + index * 5 * 60_000).toISOString()),
    );

    const result = normalizeCandles(candles, "5m", now);

    expect(result.status).toBe("INSUFFICIENT_HISTORY");
    expect(result.candles).toHaveLength(MINIMUM_CANDLE_COUNT - 1);
  });

  it("reports invalid candles when no completed quote has a usable OHLC payload", () => {
    const now = new Date(`2026-08-10T10:07:00${IST}`);

    const result = normalizeCandles(
      [candle(`2026-08-10T09:00:00${IST}`, { high: null })],
      "5m",
      now,
    );

    expect(result).toMatchObject({
      status: "INVALID_CANDLES",
      candles: [],
      asOf: 0,
    });
  });

  it("keeps a valid duplicate when a later duplicate has invalid OHLC values", () => {
    const now = new Date(`2026-08-10T10:07:00${IST}`);
    const valid = candle(`2026-08-10T10:00:00${IST}`);
    const invalidLaterDuplicate = candle(`2026-08-10T10:00:00${IST}`, { close: null });

    const result = normalizeCandles([valid, invalidLaterDuplicate], "5m", now);

    expect(result).toMatchObject({
      status: "INSUFFICIENT_HISTORY",
      candles: [expect.objectContaining({ time: valid.date.getTime(), close: 103 })],
    });
  });

  it("reports invalid candles for a nonempty feed with only unparseable timestamps", () => {
    const now = new Date(`2026-08-10T12:00:00${IST}`);

    const result = normalizeCandles([candle("not-a-date")], "5m", now);

    expect(result).toMatchObject({
      status: "INVALID_CANDLES",
      candles: [],
      asOf: 0,
    });
  });

  it("does not mark a complete final intraday bar stale overnight", () => {
    const finalBar = candle(`2026-08-10T15:25:00${IST}`);

    const result = normalizeCandles(
      [finalBar],
      "5m",
      new Date(`2026-08-11T08:00:00${IST}`),
    );

    expect(result.status).toBe("INSUFFICIENT_HISTORY");
  });

  it("does not mark a Friday final intraday candle stale during the weekend", () => {
    const friday = candle(`2026-08-07T15:25:00${IST}`);

    const result = normalizeCandles(
      [friday],
      "5m",
      new Date(`2026-08-09T12:00:00${IST}`),
    );

    expect(result.status).toBe("INSUFFICIENT_HISTORY");
  });
});

describe("isCandleComplete", () => {
  it("uses Asia/Kolkata interval boundaries for intraday candles", () => {
    const candleStart = new Date(`2026-08-10T10:00:00${IST}`).getTime();

    expect(isCandleComplete(candleStart, "15m", new Date(`2026-08-10T10:14:59${IST}`))).toBe(false);
    expect(isCandleComplete(candleStart, "15m", new Date(`2026-08-10T10:15:00${IST}`))).toBe(true);
  });

  it("closes a daily candle at 15:30 on its Kolkata trading date", () => {
    const dayStart = new Date(`2026-08-10T09:15:00${IST}`).getTime();

    expect(isCandleComplete(dayStart, "1d", new Date(`2026-08-10T15:29:59${IST}`))).toBe(false);
    expect(isCandleComplete(dayStart, "1d", new Date(`2026-08-10T15:30:00${IST}`))).toBe(true);
  });

  it("closes a final shortened hourly bar at the Kolkata session close", () => {
    const finalHour = new Date(`2026-08-10T15:15:00${IST}`).getTime();

    expect(isCandleComplete(finalHour, "1h", new Date(`2026-08-10T15:29:59${IST}`))).toBe(false);
    expect(isCandleComplete(finalHour, "1h", new Date(`2026-08-10T15:30:00${IST}`))).toBe(true);
  });

  it("closes a weekly candle at Friday 15:30 Kolkata time", () => {
    const weekStart = new Date(`2026-08-03T09:15:00${IST}`).getTime();

    expect(isCandleComplete(weekStart, "1wk", new Date(`2026-08-07T15:29:59${IST}`))).toBe(false);
    expect(isCandleComplete(weekStart, "1wk", new Date(`2026-08-07T15:30:00${IST}`))).toBe(true);
  });

  it("closes a monthly candle on the final weekday at 15:30 Kolkata time", () => {
    const monthStart = new Date(`2026-05-01T09:15:00${IST}`).getTime();

    expect(isCandleComplete(monthStart, "1mo", new Date(`2026-05-29T15:29:59${IST}`))).toBe(false);
    expect(isCandleComplete(monthStart, "1mo", new Date(`2026-05-29T15:30:00${IST}`))).toBe(true);
  });
});
