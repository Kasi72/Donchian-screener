import type { Candle } from "./provider";
import { NSE_TRADING_CALENDAR, type NseTradingCalendar } from "./nse-session";

export interface DailyCandleWindowAudit {
  expectedSessions: number;
  observedSessions: number;
  missingSessions: number;
  complete: boolean;
}

export interface IntradayCandleWindowAudit {
  expectedBars: number;
  observedBars: number;
  missingBars: number;
  complete: boolean;
}

const KOLKATA_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dateParts(time: number): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(
    KOLKATA_DATE.formatToParts(new Date(time))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
  return { year: parts.year, month: parts.month, day: parts.day };
}

function dateKey(time: number): string {
  const { year, month, day } = dateParts(time);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dayEpoch(time: number): number {
  const { year, month, day } = dateParts(time);
  return Date.UTC(year, month - 1, day);
}

function isOpen(calendar: NseTradingCalendar, time: number): boolean {
  const { year, month, day } = dateParts(time);
  const session = calendar.sessionFor({ year, month, day });
  return session.kind === "REGULAR" || session.kind === "SPECIAL";
}

export function auditDailyCandleWindow(
  candles: readonly Candle[],
  startIndex: number,
  endIndex: number,
  calendar: NseTradingCalendar = NSE_TRADING_CALENDAR,
): DailyCandleWindowAudit {
  if (
    !Number.isInteger(startIndex) ||
    !Number.isInteger(endIndex) ||
    startIndex < 0 ||
    endIndex < startIndex ||
    endIndex >= candles.length
  ) {
    throw new RangeError("Daily candle window indices are invalid");
  }

  const start = dayEpoch(candles[startIndex].time);
  const end = dayEpoch(candles[endIndex].time);
  const observed = new Set(
    candles.slice(startIndex, endIndex + 1).map(({ time }) => dateKey(time)),
  );
  let expectedSessions = 0;
  for (let day = start; day <= end; day += 24 * 60 * 60_000) {
    if (isOpen(calendar, day)) expectedSessions += 1;
  }

  const observedSessions = [...observed].filter((key) => {
    const [year, month, day] = key.split("-").map(Number);
    return calendar.sessionFor({ year, month, day }).kind === "REGULAR" ||
      calendar.sessionFor({ year, month, day }).kind === "SPECIAL";
  }).length;
  const missingSessions = Math.max(0, expectedSessions - observedSessions);
  return {
    expectedSessions,
    observedSessions,
    missingSessions,
    complete: missingSessions === 0,
  };
}

const INTRADAY_MINUTES: Record<"5m" | "15m" | "1h", number> = { "5m": 5, "15m": 15, "1h": 60 };
const KOLKATA_DATE_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
});

function localDateKey(time: number): string {
  return KOLKATA_DATE_TIME.format(new Date(time));
}

/**
 * Audits continuity inside each exchange session. It deliberately does not
 * infer bars across overnight/session boundaries, where a large gap is valid.
 */
export function auditIntradayCandleWindow(
  candles: readonly Candle[], startIndex: number, endIndex: number, timeframe: "5m" | "15m" | "1h",
): IntradayCandleWindowAudit {
  if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || startIndex < 0 || endIndex < startIndex || endIndex >= candles.length) {
    throw new RangeError("Intraday candle window indices are invalid");
  }
  const intervalMs = INTRADAY_MINUTES[timeframe] * 60_000;
  let expectedBars = endIndex - startIndex + 1;
  let observedBars = expectedBars;
  for (let i = startIndex + 1; i <= endIndex; i += 1) {
    const previous = candles[i - 1];
    const current = candles[i];
    if (localDateKey(previous.time) !== localDateKey(current.time)) continue;
    const delta = current.time - previous.time;
    if (!Number.isFinite(delta) || delta <= 0) {
      observedBars -= 1;
      continue;
    }
    if (delta > intervalMs) expectedBars += Math.max(0, Math.round(delta / intervalMs) - 1);
  }
  const missingBars = Math.max(0, expectedBars - observedBars);
  return { expectedBars, observedBars, missingBars, complete: missingBars === 0 };
}
