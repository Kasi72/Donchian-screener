import type { Timeframe } from "./provider";

export interface KolkataDate {
  year: number;
  month: number;
  day: number;
}

export interface NseTradingCalendar {
  isTradingDay(date: KolkataDate): boolean;
}

export const WEEKDAY_NSE_CALENDAR: NseTradingCalendar = {
  isTradingDay(date) {
    const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
    return weekday !== 0 && weekday !== 6;
  },
};

const SESSION_OPEN_MINUTES = 9 * 60 + 15;
const SESSION_CLOSE_MINUTES = 15 * 60 + 30;
const DAY_MS = 24 * 60 * 60_000;

const INTRADAY_INTERVAL_MS: Partial<Record<Timeframe, number>> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
};

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

function kolkataLocalEpoch(time: number): number {
  const values = Object.fromEntries(
    kolkataFormatter
      .formatToParts(new Date(time))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
    time % 1_000,
  );
}

function dayStart(localTime: number): number {
  return localTime - (localTime % DAY_MS);
}

function dateAt(day: number): KolkataDate {
  const value = new Date(day);
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

function sessionClose(day: number): number {
  return day + SESSION_CLOSE_MINUTES * 60_000;
}

function latestTradingDayOnOrBefore(
  day: number,
  calendar: NseTradingCalendar,
): number {
  let candidate = day;
  while (!calendar.isTradingDay(dateAt(candidate))) {
    candidate -= DAY_MS;
  }
  return candidate;
}

function lastTradingDayOfWeek(monday: number, calendar: NseTradingCalendar): number {
  return latestTradingDayOnOrBefore(monday + 4 * DAY_MS, calendar);
}

function lastTradingDayOfMonth(localTime: number, calendar: NseTradingCalendar): number {
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

function completedAtLocal(
  candleStart: number,
  timeframe: Timeframe,
  calendar: NseTradingCalendar,
): number {
  const localStart = kolkataLocalEpoch(candleStart);
  const startDay = dayStart(localStart);
  const intradayInterval = INTRADAY_INTERVAL_MS[timeframe];

  if (intradayInterval) {
    return Math.min(localStart + intradayInterval, sessionClose(startDay));
  }

  if (timeframe === "1d") {
    return sessionClose(startDay);
  }

  if (timeframe === "1wk") {
    return sessionClose(lastTradingDayOfWeek(mondayOf(startDay), calendar));
  }

  return sessionClose(lastTradingDayOfMonth(startDay, calendar));
}

export function isNseCandleComplete(
  candleStart: number,
  timeframe: Timeframe,
  now: Date,
  calendar: NseTradingCalendar = WEEKDAY_NSE_CALENDAR,
): boolean {
  return kolkataLocalEpoch(now.getTime()) >= completedAtLocal(candleStart, timeframe, calendar);
}

function latestIntradayClose(
  nowLocal: number,
  calendar: NseTradingCalendar,
  interval: number,
): number {
  const today = dayStart(nowLocal);
  const open = today + SESSION_OPEN_MINUTES * 60_000;
  const close = sessionClose(today);

  if (!calendar.isTradingDay(dateAt(today)) || nowLocal < open) {
    return sessionClose(latestTradingDayOnOrBefore(today - DAY_MS, calendar));
  }

  if (nowLocal >= close) {
    return close;
  }

  const elapsed = nowLocal - open;
  if (elapsed < interval) {
    return sessionClose(latestTradingDayOnOrBefore(today - DAY_MS, calendar));
  }

  return open + Math.floor(elapsed / interval) * interval;
}

export function latestExpectedNseCompletion(
  timeframe: Timeframe,
  now: Date,
  calendar: NseTradingCalendar = WEEKDAY_NSE_CALENDAR,
): number {
  const nowLocal = kolkataLocalEpoch(now.getTime());
  const today = dayStart(nowLocal);
  const intradayInterval = INTRADAY_INTERVAL_MS[timeframe];

  if (intradayInterval) {
    return latestIntradayClose(nowLocal, calendar, intradayInterval);
  }

  if (timeframe === "1d") {
    const close = sessionClose(today);
    if (calendar.isTradingDay(dateAt(today)) && nowLocal >= close) {
      return close;
    }
    return sessionClose(latestTradingDayOnOrBefore(today - DAY_MS, calendar));
  }

  if (timeframe === "1wk") {
    const currentWeekClose = sessionClose(lastTradingDayOfWeek(mondayOf(today), calendar));
    if (nowLocal >= currentWeekClose) {
      return currentWeekClose;
    }
    return sessionClose(lastTradingDayOfWeek(mondayOf(today) - 7 * DAY_MS, calendar));
  }

  const currentMonthClose = sessionClose(lastTradingDayOfMonth(today, calendar));
  if (nowLocal >= currentMonthClose) {
    return currentMonthClose;
  }
  return sessionClose(lastTradingDayOfMonth(previousMonth(today), calendar));
}

export function nseCandleCompletion(
  candleStart: number,
  timeframe: Timeframe,
  calendar: NseTradingCalendar = WEEKDAY_NSE_CALENDAR,
): number {
  return completedAtLocal(candleStart, timeframe, calendar);
}
