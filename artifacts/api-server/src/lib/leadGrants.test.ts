import { describe, it, expect } from "vitest";
import {
  currentPeriodMonth,
  startOfNextMonthUtc,
  ONE_TIME_PERIOD,
  LEAD_GRANT_SOURCES,
  BASIC_SIGNUP_LEADS,
  PREMIUM_ACTIVATION_LEADS,
  PREMIUM_MONTHLY_LEADS,
} from "./leadGrants";

describe("currentPeriodMonth", () => {
  it("formats the given moment as YYYY-MM in UTC", () => {
    expect(currentPeriodMonth(new Date("2026-06-23T12:00:00Z"))).toBe("2026-06");
    expect(currentPeriodMonth(new Date("2025-12-31T23:59:59Z"))).toBe("2025-12");
  });
});

describe("startOfNextMonthUtc", () => {
  it("returns midnight UTC on the first of next month", () => {
    expect(startOfNextMonthUtc(new Date("2026-06-23T12:34:56Z")).toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    );
  });

  it("rolls the year over from December to January", () => {
    expect(startOfNextMonthUtc(new Date("2026-12-15T08:00:00Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("is always strictly after the input moment (use-it-or-lose-it expiry)", () => {
    const now = new Date("2026-02-28T23:59:59Z");
    expect(startOfNextMonthUtc(now).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("grant constants", () => {
  it("matches the agreed free-lead allotments", () => {
    expect(BASIC_SIGNUP_LEADS).toBe(2);
    expect(PREMIUM_ACTIVATION_LEADS).toBe(5);
    expect(PREMIUM_MONTHLY_LEADS).toBe(3);
  });

  it("uses the 'once' sentinel for one-time grant periods", () => {
    expect(ONE_TIME_PERIOD).toBe("once");
  });

  it("exposes the three grant sources", () => {
    expect(LEAD_GRANT_SOURCES).toEqual({
      basicSignup: "basic_signup",
      premiumActivation: "premium_activation",
      premiumMonthly: "premium_monthly",
    });
  });
});
