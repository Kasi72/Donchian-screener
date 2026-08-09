import { describe, expect, it } from "vitest";

import {
  NSE_TRADING_CALENDAR,
  createNseTradingCalendar,
} from "@/lib/market/nse-session";

describe("NSE trading calendar", () => {
  it("classifies maintained weekdays, holidays, weekends, special sessions, and unknown dates", () => {
    expect(NSE_TRADING_CALENDAR.sessionFor({ year: 2026, month: 8, day: 7 }).kind).toBe(
      "REGULAR",
    );
    expect(NSE_TRADING_CALENDAR.sessionFor({ year: 2026, month: 3, day: 3 }).kind).toBe(
      "CLOSED",
    );
    expect(NSE_TRADING_CALENDAR.sessionFor({ year: 2026, month: 8, day: 8 }).kind).toBe(
      "CLOSED",
    );
    expect(NSE_TRADING_CALENDAR.sessionFor({ year: 2025, month: 10, day: 21 })).toEqual({
      kind: "SPECIAL",
      windows: [{ openMinutes: 13 * 60 + 45, closeMinutes: 14 * 60 + 45 }],
    });
    expect(NSE_TRADING_CALENDAR.sessionFor({ year: 2027, month: 1, day: 4 }).kind).toBe(
      "UNSUPPORTED",
    );
  });

  it("is replaceable for a newly announced exchange closure or special session", () => {
    const calendar = createNseTradingCalendar({
      supportedFrom: "2026-08-01",
      supportedThrough: "2026-08-31",
      holidays: ["2026-08-07"],
      specialSessions: {
        "2026-08-08": [{ openMinutes: 10 * 60, closeMinutes: 11 * 60 }],
      },
    });

    expect(calendar.sessionFor({ year: 2026, month: 8, day: 7 }).kind).toBe("CLOSED");
    expect(calendar.sessionFor({ year: 2026, month: 8, day: 8 }).kind).toBe("SPECIAL");
    expect(calendar.sessionFor({ year: 2026, month: 9, day: 1 }).kind).toBe("UNSUPPORTED");
  });
});
