import { describe, it, expect } from "vitest";
import {
  LEAD_PRICE_PRO_CENTS,
  LEAD_TIER_CENTS,
  DEFAULT_ALLTAG_LEAD_CENTS,
  calcLeadPriceCents,
} from "./leadPricing";

describe("calcLeadPriceCents", () => {
  it("charges the flat pro lead price regardless of category price", () => {
    expect(calcLeadPriceCents({ worldId: "pro" })).toBe(LEAD_PRICE_PRO_CENTS);
    expect(calcLeadPriceCents({ worldId: "pro", categoryLeadPriceCents: 600 })).toBe(
      LEAD_PRICE_PRO_CENTS,
    );
  });

  it("uses the category tier price for the alltag world", () => {
    expect(
      calcLeadPriceCents({ worldId: "alltag", categoryLeadPriceCents: LEAD_TIER_CENTS.A }),
    ).toBe(600);
    expect(
      calcLeadPriceCents({ worldId: "alltag", categoryLeadPriceCents: LEAD_TIER_CENTS.B }),
    ).toBe(1000);
    expect(
      calcLeadPriceCents({ worldId: "alltag", categoryLeadPriceCents: LEAD_TIER_CENTS.C }),
    ).toBe(1500);
  });

  it("falls back to tier B for alltag categories without a recorded price", () => {
    expect(calcLeadPriceCents({ worldId: "alltag" })).toBe(DEFAULT_ALLTAG_LEAD_CENTS);
    expect(calcLeadPriceCents({ worldId: "alltag", categoryLeadPriceCents: null })).toBe(
      DEFAULT_ALLTAG_LEAD_CENTS,
    );
    expect(calcLeadPriceCents({ worldId: "alltag", categoryLeadPriceCents: 0 })).toBe(
      DEFAULT_ALLTAG_LEAD_CENTS,
    );
  });

  it("never trusts a client price — only world + category drive it", () => {
    const a = calcLeadPriceCents({ worldId: "alltag", categoryLeadPriceCents: 600 });
    const b = calcLeadPriceCents({ worldId: "alltag", categoryLeadPriceCents: 600 });
    expect(a).toBe(b);
    expect(a).toBe(600);
  });
});
