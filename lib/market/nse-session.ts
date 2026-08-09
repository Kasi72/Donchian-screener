import type { Timeframe } from "./provider";

export interface KolkataDate {
  year: number;
  month: number;
  day: number;
}

export interface NseSessionWindow {
  openMinutes: number;
  closeMinutes: number;
}

export type NseSessionDay =
  | { kind: "REGULAR"; windows: readonly NseSessionWindow[] }
  | { kind: "SPECIAL"; windows: readonly NseSessionWindow[] }
  | { kind: "CLOSED"; windows?: undefined }
  | { kind: "UNSUPPORTED"; windows?: undefined };

export interface NseTradingCalendar {
  sessionFor(date: KolkataDate): NseSessionDay;
}

export interface NseCalendarDefinition {
  supportedFrom: string;
  supportedThrough: string;
  holidays: readonly string[];
  specialSessions: Readonly<Record<string, readonly NseSessionWindow[]>>;
}

export type NseCandleEligibility =
  | "COMPLETE"
  | "FORMING"
  | "INVALID_SESSION"
  | "UNSUPPORTED_CALENDAR";

const REGULAR_SESSION: readonly NseSessionWindow[] = Object.freeze([
  Object.freeze({ openMinutes: 9 * 60 + 15, closeMinutes: 15 * 60 + 30 }),
]);
const DAY_MS = 24 * 60 * 60_000;
const INTRADAY_INTERVAL_MINUTES: Partial<Record<Timeframe, number>> = {
  "5m": 5,
  "15m": 15,
  "1h": 60,
};

function dateKey(date: KolkataDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(
    date.day,
  ).padStart(2, "0")}`;
}

function validWindow(window: NseSessionWindow): boolean {
  return (
    Number.isInteger(window.openMinutes) &&
    Number.isInteger(window.closeMinutes) &&
    window.openMinutes >= 0 &&
    window.closeMinutes <= 24 * 60 &&
    window.openMinutes < window.closeMinutes
  );
}

export function createNseTradingCalendar(
  definition: NseCalendarDefinition,
): NseTradingCalendar {
  if (definition.supportedFrom > definition.supportedThrough) {
    throw new RangeError("NSE calendar range is reversed");
  }
  const holidays = new Set(definition.holidays);
  const specialSessions = new Map(
    Object.entries(definition.specialSessions).map(([date, windows]) => {
      if (windows.length === 0 || !windows.every(validWindow)) {
        throw new RangeError(`Invalid NSE special-session window for ${date}`);
      }
      return [date, windows.map((window) => Object.freeze({ ...window }))] as const;
    }),
  );

  return Object.freeze({
    sessionFor(date: KolkataDate): NseSessionDay {
      const key = dateKey(date);
      if (key < definition.supportedFrom || key > definition.supportedThrough) {
        return { kind: "UNSUPPORTED" };
      }
      const special = specialSessions.get(key);
      if (special !== undefined) {
        return { kind: "SPECIAL", windows: special };
      }
      const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
      if (weekday === 0 || weekday === 6 || holidays.has(key)) {
        return { kind: "CLOSED" };
      }
      return { kind: "REGULAR", windows: REGULAR_SESSION };
    },
  });
}

/**
 * NSE Capital Market calendar maintained from official exchange circulars:
 * CMTR59722 (2024), CMTR65587 (2025), and CMTR71775 (2026).
 * The range ends at the repository's review date. A newly announced date must
 * be added explicitly; dates outside this range are never assumed open.
 */
export const NSE_TRADING_CALENDAR = createNseTradingCalendar({
  supportedFrom: "2024-01-01",
  supportedThrough: "2026-11-07",
  holidays: [
    "2024-01-26",
    "2024-03-08",
    "2024-03-25",
    "2024-03-29",
    "2024-04-11",
    "2024-04-17",
    "2024-05-01",
    "2024-06-17",
    "2024-07-17",
    "2024-08-15",
    "2024-10-02",
    "2024-11-01",
    "2024-11-15",
    "2024-12-25",
    "2025-02-26",
    "2025-03-14",
    "2025-03-31",
    "2025-04-10",
    "2025-04-14",
    "2025-04-18",
    "2025-05-01",
    "2025-08-15",
    "2025-08-27",
    "2025-10-02",
    "2025-10-21",
    "2025-10-22",
    "2025-11-05",
    "2025-12-25",
    "2026-01-26",
    "2026-03-03",
    "2026-03-26",
    "2026-03-31",
    "2026-04-03",
    "2026-04-14",
    "2026-05-01",
    "2026-05-28",
    "2026-06-26",
    "2026-09-14",
    "2026-10-02",
    "2026-10-20",
  ],
  specialSessions: {
    "2024-01-20": [
      { openMinutes: 9 * 60 + 15, closeMinutes: 10 * 60 },
      { openMinutes: 11 * 60 + 30, closeMinutes: 12 * 60 + 30 },
    ],
    "2024-03-02": [
      { openMinutes: 9 * 60 + 15, closeMinutes: 10 * 60 },
      { openMinutes: 11 * 60 + 30, closeMinutes: 12 * 60 + 30 },
    ],
    "2024-05-18": [
      { openMinutes: 9 * 60 + 15, closeMinutes: 10 * 60 },
      { openMinutes: 11 * 60 + 30, closeMinutes: 12 * 60 + 30 },
    ],
    "2024-11-01": [{ openMinutes: 18 * 60, closeMinutes: 19 * 60 }],
    "2025-10-21": [{ openMinutes: 13 * 60 + 45, closeMinutes: 14 * 60 + 45 }],
  },
});

interface KolkataParts extends KolkataDate {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const kolkataFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function kolkataParts(time: number): KolkataParts {
  const values = Object.fromEntries(
    kolkataFormatter
      .formatToParts(new Date(time))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
    millisecond: ((time % 1_000) + 1_000) % 1_000,
  };
}

function kolkataLocalEpoch(time: number): number {
  const parts = kolkataParts(time);
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
}

function dayStart(localTime: number): number {
  return localTime - (((localTime % DAY_MS) + DAY_MS) % DAY_MS);
}

function dateAt(day: number): KolkataDate {
  const value = new Date(day);
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

function isOpenSession(day: NseSessionDay): day is Extract<NseSessionDay, { windows: unknown }> {
  return day.kind === "REGULAR" || day.kind === "SPECIAL";
}

function lastSessionClose(day: number, calendar: NseTradingCalendar): number | undefined {
  const session = calendar.sessionFor(dateAt(day));
  return isOpenSession(session)
    ? day + session.windows.at(-1)!.closeMinutes * 60_000
    : undefined;
}

function latestTradingDayOnOrBefore(
  day: number,
  calendar: NseTradingCalendar,
): number | undefined {
  let candidate = day;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const session = calendar.sessionFor(dateAt(candidate));
    if (isOpenSession(session)) return candidate;
    if (session.kind === "UNSUPPORTED") return undefined;
    candidate -= DAY_MS;
  }
  return undefined;
}

function lastTradingDayOfWeek(
  monday: number,
  calendar: NseTradingCalendar,
): number | undefined {
  return latestTradingDayOnOrBefore(monday + 4 * DAY_MS, calendar);
}

function lastTradingDayOfMonth(
  localTime: number,
  calendar: NseTradingCalendar,
): number | undefined {
  const date = new Date(localTime);
  const finalDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0);
  return latestTradingDayOnOrBefore(finalDay, calendar);
}

function previousMonth(localTime: number): number {
  const date = new Date(localTime);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1);
}

function mondayOf(day: number): number {
  const weekday = new Date(day).getUTCDay();
  return day - ((weekday + 6) % 7) * DAY_MS;
}

function completionForIntradayStart(
  localStart: number,
  timeframe: Timeframe,
  calendar: NseTradingCalendar,
): number | undefined {
  const intervalMinutes = INTRADAY_INTERVAL_MINUTES[timeframe];
  if (intervalMinutes === undefined) return undefined;
  const startDay = dayStart(localStart);
  const session = calendar.sessionFor(dateAt(startDay));
  if (!isOpenSession(session)) return undefined;
  const startMinutes = (localStart - startDay) / 60_000;
  const window = session.windows.find(
    (candidate) =>
      startMinutes >= candidate.openMinutes && startMinutes < candidate.closeMinutes,
  );
  if (window === undefined) return undefined;
  return Math.min(
    localStart + intervalMinutes * 60_000,
    startDay + window.closeMinutes * 60_000,
  );
}

export function nseCandleEligibility(
  candleStart: number,
  timeframe: Timeframe,
  now: Date,
  calendar: NseTradingCalendar = NSE_TRADING_CALENDAR,
): NseCandleEligibility {
  const parts = kolkataParts(candleStart);
  const session = calendar.sessionFor(parts);
  if (session.kind === "UNSUPPORTED") return "UNSUPPORTED_CALENDAR";

  const intervalMinutes = INTRADAY_INTERVAL_MINUTES[timeframe];
  if (intervalMinutes !== undefined) {
    if (!isOpenSession(session)) return "INVALID_SESSION";
    const minuteOfDay = parts.hour * 60 + parts.minute;
    const window = session.windows.find(
      (candidate) =>
        minuteOfDay >= candidate.openMinutes && minuteOfDay < candidate.closeMinutes,
    );
    if (
      window === undefined ||
      parts.second !== 0 ||
      parts.millisecond !== 0 ||
      (minuteOfDay - window.openMinutes) % intervalMinutes !== 0
    ) {
      return "INVALID_SESSION";
    }
    const completion = completionForIntradayStart(
      kolkataLocalEpoch(candleStart),
      timeframe,
      calendar,
    );
    return completion !== undefined && kolkataLocalEpoch(now.getTime()) >= completion
      ? "COMPLETE"
      : "FORMING";
  }

  if (timeframe === "1d") {
    if (!isOpenSession(session)) return "INVALID_SESSION";
    const localStart = kolkataLocalEpoch(candleStart);
    const close = lastSessionClose(dayStart(localStart), calendar);
    return close !== undefined && kolkataLocalEpoch(now.getTime()) >= close
      ? "COMPLETE"
      : "FORMING";
  }

  // Weekly/monthly provider timestamps identify an aggregate, not one
  // exchange session. Historical aggregates may predate the maintained daily
  // calendar; only the current aggregate's expected close is calendar-bound.
  const startLocal = kolkataLocalEpoch(candleStart);
  const nowLocal = kolkataLocalEpoch(now.getTime());
  if (timeframe === "1wk") {
    const lastDay = lastTradingDayOfWeek(mondayOf(dayStart(startLocal)), calendar);
    if (lastDay === undefined) return nowLocal - startLocal >= 7 * DAY_MS ? "COMPLETE" : "UNSUPPORTED_CALENDAR";
    const close = lastSessionClose(lastDay, calendar)!;
    return nowLocal >= close ? "COMPLETE" : "FORMING";
  }
  const lastDay = lastTradingDayOfMonth(startLocal, calendar);
  if (lastDay === undefined) return nowLocal - startLocal >= 32 * DAY_MS ? "COMPLETE" : "UNSUPPORTED_CALENDAR";
  const close = lastSessionClose(lastDay, calendar)!;
  return nowLocal >= close ? "COMPLETE" : "FORMING";
}

export function isNseCandleComplete(
  candleStart: number,
  timeframe: Timeframe,
  now: Date,
  calendar: NseTradingCalendar = NSE_TRADING_CALENDAR,
): boolean {
  return nseCandleEligibility(candleStart, timeframe, now, calendar) === "COMPLETE";
}

function latestIntradayClose(
  nowLocal: number,
  calendar: NseTradingCalendar,
  intervalMinutes: number,
): number | undefined {
  const today = dayStart(nowLocal);
  const session = calendar.sessionFor(dateAt(today));
  if (session.kind === "UNSUPPORTED") return undefined;
  if (!isOpenSession(session)) {
    const previous = latestTradingDayOnOrBefore(today - DAY_MS, calendar);
    return previous === undefined ? undefined : lastSessionClose(previous, calendar);
  }

  let latest: number | undefined;
  for (const window of session.windows) {
    const open = today + window.openMinutes * 60_000;
    const close = today + window.closeMinutes * 60_000;
    if (nowLocal < open + intervalMinutes * 60_000) break;
    const candidate =
      nowLocal >= close
        ? close
        : open + Math.floor((nowLocal - open) / (intervalMinutes * 60_000)) * intervalMinutes * 60_000;
    latest = candidate;
  }
  if (latest !== undefined) return latest;
  const previous = latestTradingDayOnOrBefore(today - DAY_MS, calendar);
  return previous === undefined ? undefined : lastSessionClose(previous, calendar);
}

export function latestExpectedNseCompletion(
  timeframe: Timeframe,
  now: Date,
  calendar: NseTradingCalendar = NSE_TRADING_CALENDAR,
): number | undefined {
  const nowLocal = kolkataLocalEpoch(now.getTime());
  const today = dayStart(nowLocal);
  const intervalMinutes = INTRADAY_INTERVAL_MINUTES[timeframe];
  if (intervalMinutes !== undefined) {
    return latestIntradayClose(nowLocal, calendar, intervalMinutes);
  }

  const todaySession = calendar.sessionFor(dateAt(today));
  if (todaySession.kind === "UNSUPPORTED") return undefined;
  if (timeframe === "1d") {
    if (isOpenSession(todaySession)) {
      const close = lastSessionClose(today, calendar)!;
      if (nowLocal >= close) return close;
    }
    const previous = latestTradingDayOnOrBefore(today - DAY_MS, calendar);
    return previous === undefined ? undefined : lastSessionClose(previous, calendar);
  }

  if (timeframe === "1wk") {
    const currentLastDay = lastTradingDayOfWeek(mondayOf(today), calendar);
    if (currentLastDay === undefined) return undefined;
    const currentClose = lastSessionClose(currentLastDay, calendar)!;
    if (nowLocal >= currentClose) return currentClose;
    const previousLastDay = lastTradingDayOfWeek(mondayOf(today) - 7 * DAY_MS, calendar);
    return previousLastDay === undefined ? undefined : lastSessionClose(previousLastDay, calendar);
  }

  const currentLastDay = lastTradingDayOfMonth(today, calendar);
  if (currentLastDay === undefined) return undefined;
  const currentClose = lastSessionClose(currentLastDay, calendar)!;
  if (nowLocal >= currentClose) return currentClose;
  const previousLastDay = lastTradingDayOfMonth(previousMonth(today), calendar);
  return previousLastDay === undefined ? undefined : lastSessionClose(previousLastDay, calendar);
}

export function nseCandleCompletion(
  candleStart: number,
  timeframe: Timeframe,
  calendar: NseTradingCalendar = NSE_TRADING_CALENDAR,
): number | undefined {
  const localStart = kolkataLocalEpoch(candleStart);
  const startDay = dayStart(localStart);
  if (INTRADAY_INTERVAL_MINUTES[timeframe] !== undefined) {
    return completionForIntradayStart(localStart, timeframe, calendar);
  }
  if (timeframe === "1d") return lastSessionClose(startDay, calendar);
  if (timeframe === "1wk") {
    const day = lastTradingDayOfWeek(mondayOf(startDay), calendar);
    return day === undefined ? undefined : lastSessionClose(day, calendar);
  }
  const day = lastTradingDayOfMonth(startDay, calendar);
  return day === undefined ? undefined : lastSessionClose(day, calendar);
}
