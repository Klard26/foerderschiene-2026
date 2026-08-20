/**
 * Tier entitlements for the Pay-per-Lead (RfQ) marketplace. REUSES the existing
 * `basic` / `premium` subscription tiers on the providers row (there is no
 * free/plus/pro). Premium relaxes the monthly lead cap and boosts match ranking.
 * Lead fees are NOT discounted by tier — both tiers pay the same lead fee;
 * Premium's lead value is the monthly free-lead grants instead.
 */
import { db } from "@workspace/db";
import { leadUsageTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

/** Transaction handle type (the value drizzle passes to `db.transaction`). */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type Tier = "basic" | "premium";

export interface LeadEntitlements {
  tier: Tier;
  /** Monthly lead cap; null = unlimited (premium). */
  maxLeadsMonth: number | null;
  leadDiscountPct: number;
  rankingBoost: number;
}

const ENTITLEMENTS: Record<Tier, Omit<LeadEntitlements, "tier">> = {
  basic: { maxLeadsMonth: 3, leadDiscountPct: 0, rankingBoost: 0 },
  premium: { maxLeadsMonth: null, leadDiscountPct: 0, rankingBoost: 10 },
};

export function normalizeTier(tier: string | null | undefined): Tier {
  return tier === "premium" ? "premium" : "basic";
}

export function entitlementsForTier(tier: string | null | undefined): LeadEntitlements {
  const t = normalizeTier(tier);
  return { tier: t, ...ENTITLEMENTS[t] };
}

/** "YYYY-MM" for the given moment in UTC (matches `lead_usage.periodMonth`). */
export function currentPeriodMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** Leads already used by a provider this period (0 when no row exists yet). */
export async function getLeadUsage(
  providerId: number,
  periodMonth: string = currentPeriodMonth(),
): Promise<number> {
  const [row] = await db
    .select({ leadsUsed: leadUsageTable.leadsUsed })
    .from(leadUsageTable)
    .where(
      and(
        eq(leadUsageTable.providerId, providerId),
        eq(leadUsageTable.periodMonth, periodMonth),
      ),
    )
    .limit(1);
  return row?.leadsUsed ?? 0;
}

/**
 * Increment a provider's monthly lead usage by one. MUST run inside the offer
 * transaction (pass the `tx`) so the count moves atomically with the charge.
 */
export async function incrementLeadUsage(
  tx: DbTransaction,
  providerId: number,
  periodMonth: string = currentPeriodMonth(),
): Promise<void> {
  await tx
    .insert(leadUsageTable)
    .values({ providerId, periodMonth, leadsUsed: 1 })
    .onConflictDoUpdate({
      target: [leadUsageTable.providerId, leadUsageTable.periodMonth],
      set: { leadsUsed: sql`${leadUsageTable.leadsUsed} + 1`, updatedAt: new Date() },
    });
}

export interface CanRespondResult {
  allowed: boolean;
  reason?: string;
  entitlements: LeadEntitlements;
  leadsUsed: number;
}

/**
 * Whether a provider may still send an offer this period given their tier's
 * monthly lead cap. Premium (unlimited) always passes.
 */
export async function canRespondToLead(
  providerId: number,
  tier: string | null | undefined,
): Promise<CanRespondResult> {
  const entitlements = entitlementsForTier(tier);
  const leadsUsed = await getLeadUsage(providerId);
  if (entitlements.maxLeadsMonth !== null && leadsUsed >= entitlements.maxLeadsMonth) {
    return {
      allowed: false,
      reason: `Basic-Limit von ${entitlements.maxLeadsMonth} Leads pro Monat erreicht. Mit Premium senden Sie unbegrenzt Angebote.`,
      entitlements,
      leadsUsed,
    };
  }
  return { allowed: true, entitlements, leadsUsed };
}
