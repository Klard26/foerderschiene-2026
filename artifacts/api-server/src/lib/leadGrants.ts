/**
 * Free-lead grants ("Frei-Leads"). Providers receive a pool of free leads that
 * are consumed BEFORE any wallet debit on the offer flow:
 *   - Basic: 2 leads once at provider creation.
 *   - Premium: 5 leads once at activation + 3 leads each month while premium.
 *
 * All grants are idempotent (UNIQUE provider+source+periodMonth); consumption is
 * atomic (blocking row locks + guarded decrement, see `consumeFreeLead`) so
 * concurrent offers can neither double-spend the last free lead nor wrongly debit
 * the wallet while free leads remain. The monthly lead-usage cap
 * (`leadEntitlements`) still applies as anti-spam — free leads change WHO pays,
 * not WHETHER a provider may respond.
 */
import { db } from "@workspace/db";
import { providerLeadGrantsTable } from "@workspace/db";
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { DbTransaction } from "./leadEntitlements";

/** Accepts either the root db handle or an open transaction. */
type Executor = typeof db | DbTransaction;

export const LEAD_GRANT_SOURCES = {
  basicSignup: "basic_signup",
  premiumActivation: "premium_activation",
  premiumMonthly: "premium_monthly",
} as const;

export type LeadGrantSource =
  (typeof LEAD_GRANT_SOURCES)[keyof typeof LEAD_GRANT_SOURCES];

/** Sentinel periodMonth for one-time (non-monthly) grants. */
export const ONE_TIME_PERIOD = "once";

export const BASIC_SIGNUP_LEADS = 2;
export const PREMIUM_ACTIVATION_LEADS = 5;
export const PREMIUM_MONTHLY_LEADS = 3;

/** "YYYY-MM" for the given moment in UTC (matches the monthly grant period). */
export function currentPeriodMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Start of next month (UTC) — the expiry for a monthly grant issued during
 * `now`'s month, so unused free leads do not accumulate. `Date.UTC` rolls the
 * year over correctly when `now` is in December.
 */
export function startOfNextMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/**
 * Idempotently grant free leads. Returns true if a new grant row was inserted,
 * false if one already existed for (provider, source, periodMonth).
 */
export async function grantLeadCredits(
  executor: Executor,
  args: {
    providerId: number;
    source: LeadGrantSource;
    periodMonth: string;
    count: number;
    expiresAt?: Date | null;
  },
): Promise<boolean> {
  const inserted = await executor
    .insert(providerLeadGrantsTable)
    .values({
      providerId: args.providerId,
      source: args.source,
      periodMonth: args.periodMonth,
      grantedCount: args.count,
      remainingCount: args.count,
      expiresAt: args.expiresAt ?? null,
    })
    .onConflictDoNothing({
      target: [
        providerLeadGrantsTable.providerId,
        providerLeadGrantsTable.source,
        providerLeadGrantsTable.periodMonth,
      ],
    })
    .returning({ id: providerLeadGrantsTable.id });
  return inserted.length > 0;
}

/** Predicate: grants with remaining leads that have not expired. */
function eligible(providerId: number, now: Date) {
  return and(
    eq(providerLeadGrantsTable.providerId, providerId),
    gt(providerLeadGrantsTable.remainingCount, 0),
    or(
      isNull(providerLeadGrantsTable.expiresAt),
      gt(providerLeadGrantsTable.expiresAt, now),
    ),
  );
}

/** Total free leads a provider can still use right now. */
export async function countRemainingFreeLeads(
  providerId: number,
  now: Date = new Date(),
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${providerLeadGrantsTable.remainingCount}), 0)`,
    })
    .from(providerLeadGrantsTable)
    .where(eligible(providerId, now));
  return Number(row?.total ?? 0);
}

/**
 * Consume exactly one free lead inside the offer transaction. Returns the
 * consumed grant id, or null when no free lead is available.
 *
 * Concurrency: we lock ALL of the provider's eligible grant rows with a plain
 * blocking `FOR UPDATE` (NO `SKIP LOCKED`, NO `LIMIT`). This is deliberate —
 * grant rows are aggregate counters (remainingCount 2/3/5), and the provider has
 * only a handful of them, so:
 *   - `SKIP LOCKED` would let a concurrent offer skip a momentarily-locked grant,
 *     find no candidate, and wrongly debit the wallet while free leads remain.
 *   - `LIMIT 1 FOR UPDATE` has an EvalPlanQual recheck pitfall: if the single
 *     chosen row is decremented to 0 by a concurrent tx, the query can return
 *     zero rows even though another eligible grant still exists (false negative).
 * Locking the whole small set (blocking) and re-selecting in app code sidesteps
 * both: a concurrent offer blocks until ours commits, then sees the decremented
 * state and picks the next still-eligible grant. The decrement is additionally
 * guarded with `remainingCount > 0`.
 */
export async function consumeFreeLead(
  tx: DbTransaction,
  providerId: number,
  now: Date = new Date(),
): Promise<number | null> {
  const rows = await tx
    .select({ id: providerLeadGrantsTable.id })
    .from(providerLeadGrantsTable)
    .where(eligible(providerId, now))
    // ASC puts NULL expiry last in Postgres, so monthly (expiring) grants are
    // spent before the never-expiring one-time grants.
    .orderBy(asc(providerLeadGrantsTable.expiresAt), asc(providerLeadGrantsTable.id))
    .for("update");
  const candidate = rows[0];
  if (!candidate) return null;
  const updated = await tx
    .update(providerLeadGrantsTable)
    .set({
      remainingCount: sql`${providerLeadGrantsTable.remainingCount} - 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(providerLeadGrantsTable.id, candidate.id),
        gt(providerLeadGrantsTable.remainingCount, 0),
      ),
    )
    .returning({ id: providerLeadGrantsTable.id });
  return updated[0]?.id ?? null;
}

/**
 * Revoke unused monthly premium grants on downgrade so a provider cannot keep
 * spending premium-only free leads after cancelling. One-time grants
 * (basic_signup / premium_activation) are intentionally preserved.
 */
export async function revokeMonthlyPremiumGrants(
  executor: Executor,
  providerId: number,
): Promise<void> {
  await executor
    .update(providerLeadGrantsTable)
    .set({ remainingCount: 0, updatedAt: new Date() })
    .where(
      and(
        eq(providerLeadGrantsTable.providerId, providerId),
        eq(providerLeadGrantsTable.source, LEAD_GRANT_SOURCES.premiumMonthly),
        gt(providerLeadGrantsTable.remainingCount, 0),
      ),
    );
}
