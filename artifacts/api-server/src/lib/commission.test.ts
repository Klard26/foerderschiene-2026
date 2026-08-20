import { describe, it, expect } from "vitest";
import {
  tierCommissionRate,
  effectiveCommissionRate,
  isConnectSplitEligible,
  computeApplicationFeeCents,
} from "./commission";

describe("tierCommissionRate", () => {
  it("uses the pro-world rates (Basic 14%, Premium 9%)", () => {
    expect(tierCommissionRate("pro", "premium")).toBe(0.09);
    expect(tierCommissionRate("pro", "basic")).toBe(0.14);
    expect(tierCommissionRate("pro", undefined)).toBe(0.14);
    expect(tierCommissionRate("pro", null)).toBe(0.14);
    expect(tierCommissionRate("pro", "garbage")).toBe(0.14);
  });

  it("uses the alltag-world rates (Basic 15%, Premium 10%)", () => {
    expect(tierCommissionRate("alltag", "premium")).toBe(0.1);
    expect(tierCommissionRate("alltag", "basic")).toBe(0.15);
    expect(tierCommissionRate("alltag", undefined)).toBe(0.15);
  });
});

describe("effectiveCommissionRate", () => {
  it("uses the world+tier default when no per-provider override is set", () => {
    expect(
      effectiveCommissionRate({ commissionRate: null, subscriptionTier: "premium" }, "pro"),
    ).toBe(0.09);
    expect(
      effectiveCommissionRate({ commissionRate: null, subscriptionTier: "basic" }, "pro"),
    ).toBe(0.14);
    expect(
      effectiveCommissionRate({ commissionRate: null, subscriptionTier: "premium" }, "alltag"),
    ).toBe(0.1);
    expect(
      effectiveCommissionRate({ commissionRate: null, subscriptionTier: "basic" }, "alltag"),
    ).toBe(0.15);
  });

  it("honors a valid per-provider override (numeric string from the DB)", () => {
    expect(
      effectiveCommissionRate({ commissionRate: "0.015", subscriptionTier: "basic" }, "pro"),
    ).toBe(0.015);
  });

  it("allows a zero override", () => {
    expect(
      effectiveCommissionRate({ commissionRate: "0", subscriptionTier: "basic" }, "alltag"),
    ).toBe(0);
  });

  it("ignores an out-of-range override (>= 1) and falls back to the world+tier", () => {
    expect(
      effectiveCommissionRate({ commissionRate: "1", subscriptionTier: "premium" }, "pro"),
    ).toBe(0.09);
    expect(
      effectiveCommissionRate({ commissionRate: "1.5", subscriptionTier: "basic" }, "alltag"),
    ).toBe(0.15);
  });

  it("ignores a negative override and falls back to the world+tier", () => {
    expect(
      effectiveCommissionRate({ commissionRate: "-0.1", subscriptionTier: "basic" }, "pro"),
    ).toBe(0.14);
  });

  it("ignores a non-numeric override and falls back to the world+tier", () => {
    expect(
      effectiveCommissionRate({ commissionRate: "abc", subscriptionTier: "premium" }, "alltag"),
    ).toBe(0.1);
  });
});

describe("isConnectSplitEligible", () => {
  const onboardedAt = new Date("2026-01-01T00:00:00Z");

  it("is eligible only when account id AND onboarding date are both present", () => {
    expect(
      isConnectSplitEligible({ stripeAccountId: "acct_1", stripeOnboardedAt: onboardedAt }),
    ).toBe(true);
  });

  it("is not eligible without an account id", () => {
    expect(
      isConnectSplitEligible({ stripeAccountId: null, stripeOnboardedAt: onboardedAt }),
    ).toBe(false);
  });

  it("is not eligible without an onboarding date", () => {
    expect(
      isConnectSplitEligible({ stripeAccountId: "acct_1", stripeOnboardedAt: null }),
    ).toBe(false);
  });

  it("is not eligible for null/undefined providers", () => {
    expect(isConnectSplitEligible(null)).toBe(false);
    expect(isConnectSplitEligible(undefined)).toBe(false);
  });
});

describe("computeApplicationFeeCents", () => {
  it("takes the world+tier commission of the total in cents", () => {
    // 100.00 EUR = 10000 cents, pro basic 14% => 1400 cents
    expect(
      computeApplicationFeeCents(
        { commissionRate: null, subscriptionTier: "basic" },
        "pro",
        10000,
      ),
    ).toBe(1400);
    // pro premium 9% => 900 cents
    expect(
      computeApplicationFeeCents(
        { commissionRate: null, subscriptionTier: "premium" },
        "pro",
        10000,
      ),
    ).toBe(900);
    // alltag basic 15% => 1500 cents
    expect(
      computeApplicationFeeCents(
        { commissionRate: null, subscriptionTier: "basic" },
        "alltag",
        10000,
      ),
    ).toBe(1500);
  });

  it("uses a per-provider override rate", () => {
    expect(
      computeApplicationFeeCents(
        { commissionRate: "0.05", subscriptionTier: "basic" },
        "pro",
        10000,
      ),
    ).toBe(500);
  });

  it("rounds to the nearest cent", () => {
    // 99.99 EUR = 9999 cents, pro premium 9% = 899.91 => 900
    expect(
      computeApplicationFeeCents(
        { commissionRate: null, subscriptionTier: "premium" },
        "pro",
        9999,
      ),
    ).toBe(900);
  });
});
