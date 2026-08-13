import type { Candle } from "./provider";
import { NSE_TRADING_CALENDAR, type NseTradingCalendar } from "./nse-session";

export interface DailyCandleWindowAudit {
  expectedSessions: number;
  observedSessions: number;
  missingSessions: number;
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
