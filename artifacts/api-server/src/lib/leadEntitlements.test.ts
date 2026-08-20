import { describe, it, expect } from "vitest";
import {
  normalizeTier,
  entitlementsForTier,
  currentPeriodMonth,
} from "./leadEntitlements";

describe("normalizeTier", () => {
  it("returns premium only for the exact 'premium' string", () => {
    expect(normalizeTier("premium")).toBe("premium");
  });

  it("falls back to basic for everything else", () => {
    expect(normalizeTier("basic")).toBe("basic");
    expect(normalizeTier(null)).toBe("basic");
    expect(normalizeTier(undefined)).toBe("basic");
    expect(normalizeTier("plus")).toBe("basic");
    expect(normalizeTier("PREMIUM")).toBe("basic");
  });
});

describe("entitlementsForTier", () => {
  it("caps basic at 3 leads/month with no discount or boost", () => {
    expect(entitlementsForTier("basic")).toEqual({
      tier: "basic",
      maxLeadsMonth: 3,
      leadDiscountPct: 0,
      rankingBoost: 0,
    });
  });

  it("gives premium unlimited leads, no lead-fee discount and a ranking boost", () => {
    expect(entitlementsForTier("premium")).toEqual({
      tier: "premium",
      maxLeadsMonth: null,
      leadDiscountPct: 0,
      rankingBoost: 10,
    });
  });

  it("treats unknown tiers as basic (no free/plus/pro)", () => {
    expect(entitlementsForTier("pro")).toEqual({
      tier: "basic",
      maxLeadsMonth: 3,
      leadDiscountPct: 0,
      rankingBoost: 0,
    });
  });
});

describe("currentPeriodMonth", () => {
  it("formats the given moment as YYYY-MM in UTC", () => {
    expect(currentPeriodMonth(new Date("2026-06-23T12:00:00Z"))).toBe("2026-06");
    expect(currentPeriodMonth(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
    expect(currentPeriodMonth(new Date("2025-12-31T23:59:59Z"))).toBe("2025-12");
  });
});
