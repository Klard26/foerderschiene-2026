/**
 * Server-authoritative lead pricing for the Pay-per-Lead (RfQ) marketplace.
 *
 * ALL amounts are integer cents — client-supplied prices are never trusted; the
 * lead fee a provider pays is recomputed here from the request's category world.
 *
 * World-aware (Model B):
 *   - world `pro`    (Beratung & Bau)    → flat lead price of 15,00 €.
 *   - world `alltag` (Alltag & Handwerk) → tiered per category (A/B/C):
 *       A = 6,00 €, B = 10,00 €, C = 15,00 €. The exact cents come from the
 *       category row (`categories.lead_price_cents`); B is the fallback when a
 *       category has no tier recorded.
 *
 * There is no tier discount: Basic and Premium pay the same lead fee (Premium's
 * value is the monthly free-lead grants + unlimited cap + ranking boost).
 */
import type { WorldId } from "./providerClassification";

/** Flat lead price for the "pro" world, in integer cents (15,00 €). */
export const LEAD_PRICE_PRO_CENTS = 1500;

/** Alltag lead-price tiers (A/B/C), in integer cents. */
export const LEAD_TIER_CENTS = { A: 600, B: 1000, C: 1500 } as const;

/** Fallback alltag lead price (tier B) when a category has no tier recorded. */
export const DEFAULT_ALLTAG_LEAD_CENTS = LEAD_TIER_CENTS.B;

export interface LeadPriceInput {
  worldId: WorldId;
  /** Category-level lead price in cents (alltag tiers); null/0 → fallback. */
  categoryLeadPriceCents?: number | null;
}

/** The set of valid alltag lead-price tiers, in integer cents. */
const ALLTAG_TIER_VALUES: readonly number[] = Object.values(LEAD_TIER_CENTS);

/** Final, server-authoritative lead price for a request, in integer cents. */
export function calcLeadPriceCents(input: LeadPriceInput): number {
  if (input.worldId === "alltag") {
    const c = input.categoryLeadPriceCents;
    // Defensive: only honor a category lead price that matches a known tier
    // (A/B/C). Anything else (bad seed/admin data, 0, null) falls back to B.
    return c != null && ALLTAG_TIER_VALUES.includes(c) ? c : DEFAULT_ALLTAG_LEAD_CENTS;
  }
  return LEAD_PRICE_PRO_CENTS;
}
