import type { Service } from "@workspace/db";

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export type OfferPricingError = "INVALID_ITEMS" | "FOREIGN_SERVICE";

export interface OfferLineItem {
  serviceId: number;
  name: string;
  durationMinutes: number;
  netPrice: number;
  vatRate: number;
  grossPrice: number;
}

export interface OfferPricing {
  items: OfferLineItem[];
  totalNet: number;
  totalGross: number;
}

export type OfferPricingResult =
  | { ok: true; value: OfferPricing }
  | { ok: false; error: OfferPricingError };

type CatalogService = Pick<
  Service,
  "id" | "name" | "durationMinutes" | "price" | "netPrice" | "vatRate"
>;

/**
 * Server-authoritative pricing for a binding offer. Client-supplied prices are
 * ignored entirely: every requested item must reference a `serviceId` that
 * belongs to the provider, and net/USt/brutto totals are recomputed from the
 * current catalog so the offer cannot be tampered with.
 *
 * `providerServices` MUST already be scoped to the provider's own catalog —
 * any requested id that is missing from it is treated as foreign and rejected.
 */
export function recomputeOfferPricing(
  requestedItems: Array<{ serviceId?: number | null }>,
  providerServices: CatalogService[],
): OfferPricingResult {
  const serviceIds = requestedItems
    .map((it) => it.serviceId)
    .filter((id): id is number => id != null);

  if (serviceIds.length === 0 || serviceIds.length !== requestedItems.length) {
    return { ok: false, error: "INVALID_ITEMS" };
  }

  const byId = new Map(providerServices.map((s) => [s.id, s]));
  const missing = serviceIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return { ok: false, error: "FOREIGN_SERVICE" };
  }

  const items: OfferLineItem[] = serviceIds.map((id) => {
    const s = byId.get(id)!;
    const vatRate = s.vatRate ?? 19;
    const grossPrice = round2(s.price);
    const netPrice =
      s.netPrice != null
        ? round2(s.netPrice)
        : round2(grossPrice / (1 + vatRate / 100));
    return {
      serviceId: s.id,
      name: s.name,
      durationMinutes: s.durationMinutes,
      netPrice,
      vatRate,
      grossPrice,
    };
  });

  const totalNet = round2(items.reduce((sum, it) => sum + it.netPrice, 0));
  const totalGross = round2(items.reduce((sum, it) => sum + it.grossPrice, 0));

  return { ok: true, value: { items, totalNet, totalGross } };
}
