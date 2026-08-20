import { describe, it, expect } from "vitest";
import { recomputeOfferPricing } from "./offerPricing";

type CatalogService = Parameters<typeof recomputeOfferPricing>[1][number];

function svc(overrides: Partial<CatalogService> & { id: number }): CatalogService {
  return {
    name: `Service ${overrides.id}`,
    durationMinutes: 60,
    price: 119,
    netPrice: null,
    vatRate: 19,
    ...overrides,
  };
}

describe("recomputeOfferPricing", () => {
  it("rejects an empty item list", () => {
    const result = recomputeOfferPricing([], [svc({ id: 1 })]);
    expect(result).toEqual({ ok: false, error: "INVALID_ITEMS" });
  });

  it("rejects items missing a serviceId (client cannot supply free-form lines)", () => {
    const result = recomputeOfferPricing(
      [{ serviceId: 1 }, { serviceId: null }],
      [svc({ id: 1 })],
    );
    expect(result).toEqual({ ok: false, error: "INVALID_ITEMS" });
  });

  it("rejects a serviceId not in the provider's catalog (foreign id)", () => {
    const result = recomputeOfferPricing(
      [{ serviceId: 99 }],
      [svc({ id: 1 }), svc({ id: 2 })],
    );
    expect(result).toEqual({ ok: false, error: "FOREIGN_SERVICE" });
  });

  it("derives net price from gross + vat when netPrice is absent", () => {
    const result = recomputeOfferPricing(
      [{ serviceId: 1 }],
      [svc({ id: 1, price: 119, netPrice: null, vatRate: 19 })],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items[0].grossPrice).toBe(119);
    expect(result.value.items[0].netPrice).toBe(100);
    expect(result.value.totalGross).toBe(119);
    expect(result.value.totalNet).toBe(100);
  });

  it("prefers the stored net price over deriving it", () => {
    const result = recomputeOfferPricing(
      [{ serviceId: 1 }],
      [svc({ id: 1, price: 119, netPrice: 95, vatRate: 19 })],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items[0].netPrice).toBe(95);
    expect(result.value.items[0].grossPrice).toBe(119);
  });

  it("ignores client-supplied prices entirely — only the catalog drives totals", () => {
    // The requested item shape only carries serviceId; a malicious client could
    // attach a price, but recompute never reads it.
    const result = recomputeOfferPricing(
      [{ serviceId: 1, grossPrice: 1 } as unknown as { serviceId: number }],
      [svc({ id: 1, price: 200, netPrice: null, vatRate: 19 })],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items[0].grossPrice).toBe(200);
  });

  it("sums multiple line items into rounded totals", () => {
    const result = recomputeOfferPricing(
      [{ serviceId: 1 }, { serviceId: 2 }],
      [
        svc({ id: 1, price: 119, netPrice: null, vatRate: 19 }),
        svc({ id: 2, price: 59.5, netPrice: null, vatRate: 19 }),
      ],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(2);
    expect(result.value.totalGross).toBe(178.5);
    // 100 + 50 = 150
    expect(result.value.totalNet).toBe(150);
  });
});
