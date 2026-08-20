import type { Provider } from "@workspace/db";
import type { WorldId } from "./providerClassification";

/**
 * Platform commission expressed as a fraction (0.09 = 9%). World-aware:
 *
 *   - world `pro`    (Beratung & Bau)    → Basic 14%, Premium 9%
 *   - world `alltag` (Alltag & Handwerk) → Basic 15%, Premium 10%
 *
 * A per-provider `commissionRate` column may override this when set (e.g. a
 * negotiated rate); otherwise the world+tier default applies.
 */
const COMMISSION_BY_WORLD: Record<WorldId, { basic: number; premium: number }> = {
  pro: { basic: 0.14, premium: 0.09 },
  alltag: { basic: 0.15, premium: 0.1 },
};

export function tierCommissionRate(worldId: WorldId, tier?: string | null): number {
  const rates = COMMISSION_BY_WORLD[worldId];
  return tier === "premium" ? rates.premium : rates.basic;
}

export function effectiveCommissionRate(
  provider: Pick<Provider, "commissionRate" | "subscriptionTier">,
  worldId: WorldId,
): number {
  if (provider.commissionRate != null) {
    const r = Number(provider.commissionRate);
    if (Number.isFinite(r) && r >= 0 && r < 1) return r;
  }
  return tierCommissionRate(worldId, provider.subscriptionTier);
}

/**
 * A booking charge is split as a Stripe destination charge (marketplace payout)
 * only when the provider has both connected an Express account AND completed
 * onboarding. Without both, the platform collects the full amount.
 */
export function isConnectSplitEligible(
  provider:
    | Pick<Provider, "stripeAccountId" | "stripeOnboardedAt">
    | null
    | undefined,
): boolean {
  return !!(provider?.stripeAccountId && provider?.stripeOnboardedAt);
}

/**
 * The platform's application fee (in cents) taken from a destination charge.
 * Computed from the booking total and the provider's effective commission rate.
 */
export function computeApplicationFeeCents(
  provider: Pick<Provider, "commissionRate" | "subscriptionTier">,
  worldId: WorldId,
  totalCents: number,
): number {
  return Math.round(totalCents * effectiveCommissionRate(provider, worldId));
}
