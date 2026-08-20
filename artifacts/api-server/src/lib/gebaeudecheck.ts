import { db } from "@workspace/db";
import { gebaeudecheckCreditsTable, gebaeudecheckOrdersTable } from "@workspace/db";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";

/**
 * Credit packages for the paid Gebäudecheck Vollanalyse. One credit unlocks
 * one full report. Prices in euro cents.
 */
export interface GebaeudecheckPackage {
  id: string;
  credits: number;
  amountCents: number;
  label: string;
}

export const GEBAEUDECHECK_PACKAGES: GebaeudecheckPackage[] = [
  { id: "single", credits: 1, amountCents: 1999, label: "Einzelreport" },
  { id: "pack5", credits: 5, amountCents: 7999, label: "5er-Paket" },
  { id: "pack10", credits: 10, amountCents: 9999, label: "10er-Paket" },
  { id: "pack25", credits: 25, amountCents: 19999, label: "25er-Paket" },
  { id: "pack50", credits: 50, amountCents: 34999, label: "50er-Paket" },
];

export function getPackage(id: string): GebaeudecheckPackage | undefined {
  return GEBAEUDECHECK_PACKAGES.find((p) => p.id === id);
}

/** Current credit balance for a user (0 if no row yet). */
export async function getCreditBalance(userId: string): Promise<number> {
  const [row] = await db
    .select({ balance: gebaeudecheckCreditsTable.balance })
    .from(gebaeudecheckCreditsTable)
    .where(eq(gebaeudecheckCreditsTable.userId, userId))
    .limit(1);
  return row?.balance ?? 0;
}

/**
 * Add credits to a user inside an optional transaction, creating the row if
 * needed. Exported for use in fulfillOrder and tests.
 */
export async function addCredits(userId: string, amount: number): Promise<void> {
  await db
    .insert(gebaeudecheckCreditsTable)
    .values({ userId, balance: amount })
    .onConflictDoUpdate({
      target: gebaeudecheckCreditsTable.userId,
      set: {
        balance: sql`${gebaeudecheckCreditsTable.balance} + ${amount}`,
        updatedAt: new Date(),
      },
    });
}

/**
 * Atomically consume one credit. Returns true if a credit was spent, false if
 * the user has no balance left.
 */
export async function consumeCredit(userId: string): Promise<boolean> {
  const rows = await db
    .update(gebaeudecheckCreditsTable)
    .set({
      balance: sql`${gebaeudecheckCreditsTable.balance} - 1`,
      updatedAt: new Date(),
    })
    .where(
      sql`${gebaeudecheckCreditsTable.userId} = ${userId} AND ${gebaeudecheckCreditsTable.balance} > 0`,
    )
    .returning({ balance: gebaeudecheckCreditsTable.balance });
  return rows.length > 0;
}

/**
 * Idempotently fulfill a paid order: flips a `pending` order to `paid` and
 * grants its credits exactly once. Safe to call from both the Stripe webhook
 * and the success-redirect reconcile. Returns true when credits were granted.
 *
 * The status change and credit grant happen in a single transaction so a
 * concurrent refund cannot deduct the balance before the credits arrive and
 * then see them added afterward.
 */
export async function fulfillOrder(
  sessionId: string,
  paymentIntentId?: string | null,
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    if (paymentIntentId) {
      await tx
        .update(gebaeudecheckOrdersTable)
        .set({ paymentIntentId, updatedAt: new Date() })
        .where(
          and(
            eq(gebaeudecheckOrdersTable.sessionId, sessionId),
            isNull(gebaeudecheckOrdersTable.paymentIntentId),
          ),
        );
    }
    const claimed = await tx
      .update(gebaeudecheckOrdersTable)
      .set({ status: "paid", updatedAt: new Date() })
      .where(
        sql`${gebaeudecheckOrdersTable.sessionId} = ${sessionId} AND ${gebaeudecheckOrdersTable.status} = 'pending'`,
      )
      .returning({
        userId: gebaeudecheckOrdersTable.userId,
        credits: gebaeudecheckOrdersTable.credits,
      });
    const order = claimed[0];
    if (!order) return false;

    // Grant credits inside the same transaction. This prevents the window where
    // a concurrent refundOrder could see status='paid' but balance still 0,
    // deduct nothing, and then this grant adds spendable credits post-refund.
    await tx
      .insert(gebaeudecheckCreditsTable)
      .values({ userId: order.userId, balance: order.credits })
      .onConflictDoUpdate({
        target: gebaeudecheckCreditsTable.userId,
        set: {
          balance: sql`${gebaeudecheckCreditsTable.balance} + ${order.credits}`,
          updatedAt: new Date(),
        },
      });
    return true;
  });
}

/**
 * Marks a fulfilled credit purchase as refunded exactly once.
 *
 * Unused credits — those not yet spent on a report — are deducted from the
 * buyer's balance immediately and the count is recorded on the order so support
 * can see exactly how many were reclaimed vs already used. Credits that were
 * already spent to unlock a report are left intact so access is not broken.
 *
 * Everything runs in a single transaction:
 *  1. The order status is flipped to 'refunded' — this is the idempotency gate.
 *  2. The credits row is locked with SELECT … FOR UPDATE so a concurrent
 *     consumeCredit cannot modify the balance between our read and our write.
 *  3. The balance is reduced by min(balance, orderCredits).
 *  4. creditsDeducted is written to the order in the same commit.
 *
 * If the transaction fails and is retried, step 1 will find the order still
 * 'pending' (or whatever pre-refund status it had) and proceed correctly.
 * If the transaction was already committed, step 1 finds 'refunded' and the
 * function returns the previously recorded creditsDeducted without re-deducting.
 *
 * Returns the order with `creditsDeducted` set, or null if no matching order
 * was found.
 */
export async function refundOrder(
  paymentIntentId: string,
  sessionId?: string | null,
): Promise<{ id: string; amountCents: number; creditsDeducted: number } | null> {
  const lookup = sessionId
    ? or(
        eq(gebaeudecheckOrdersTable.paymentIntentId, paymentIntentId),
        eq(gebaeudecheckOrdersTable.sessionId, sessionId),
      )
    : eq(gebaeudecheckOrdersTable.paymentIntentId, paymentIntentId);

  return await db.transaction(async (tx) => {
    // Step 1: atomically claim the refund. If the order is already 'refunded'
    // this returns 0 rows and we fall through to the idempotent branch below.
    const [order] = await tx
      .update(gebaeudecheckOrdersTable)
      .set({ status: "refunded", refundedAt: new Date(), updatedAt: new Date() })
      .where(and(lookup, ne(gebaeudecheckOrdersTable.status, "refunded")))
      .returning({
        id: gebaeudecheckOrdersTable.sessionId,
        userId: gebaeudecheckOrdersTable.userId,
        credits: gebaeudecheckOrdersTable.credits,
        amountCents: gebaeudecheckOrdersTable.amountCents,
      });

    if (!order) {
      // Order was already refunded on a prior webhook delivery — return the
      // previously recorded values so the caller can still send a refund email.
      const [already] = await tx
        .select({
          id: gebaeudecheckOrdersTable.sessionId,
          amountCents: gebaeudecheckOrdersTable.amountCents,
          creditsDeducted: gebaeudecheckOrdersTable.creditsDeducted,
        })
        .from(gebaeudecheckOrdersTable)
        .where(and(lookup, eq(gebaeudecheckOrdersTable.status, "refunded")))
        .limit(1);
      return already ?? null;
    }

    // Step 2: lock the credits row so a concurrent consumeCredit or
    // fulfillOrder cannot change the balance between our SELECT and UPDATE.
    // If no credits row exists the user has balance 0 — nothing to deduct.
    const locked = await tx.execute(
      sql`SELECT balance FROM gebaeudecheck_credits WHERE user_id = ${order.userId} FOR UPDATE`,
    );
    const currentBalance =
      (locked.rows[0] as { balance: number } | undefined)?.balance ?? 0;
    const toDeduct = Math.min(currentBalance, order.credits);

    // Step 3: reduce the balance (never goes below 0).
    if (toDeduct > 0) {
      await tx
        .update(gebaeudecheckCreditsTable)
        .set({
          balance: sql`${gebaeudecheckCreditsTable.balance} - ${toDeduct}`,
          updatedAt: new Date(),
        })
        .where(eq(gebaeudecheckCreditsTable.userId, order.userId));
    }

    // Step 4: persist the deducted count so retries and admin queries always
    // see the correct breakdown of used vs unused credits.
    await tx
      .update(gebaeudecheckOrdersTable)
      .set({ creditsDeducted: toDeduct, updatedAt: new Date() })
      .where(eq(gebaeudecheckOrdersTable.sessionId, order.id));

    return { id: order.id, amountCents: order.amountCents, creditsDeducted: toDeduct };
  });
}
