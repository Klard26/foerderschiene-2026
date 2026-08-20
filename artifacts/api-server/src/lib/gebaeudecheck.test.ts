import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@workspace/db";
import {
  gebaeudecheckCreditsTable,
  gebaeudecheckOrdersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  fulfillOrder,
  refundOrder,
  consumeCredit,
  getCreditBalance,
} from "./gebaeudecheck";

// ---------------------------------------------------------------------------
// Integration tests for the Gebäudecheck credit lifecycle.
//
// These tests exercise the real route-library functions against the live
// development Postgres database so that transactional semantics (FOR UPDATE
// locks, atomic status flips, idempotency gates) are verified end-to-end.
//
// Each test uses a unique userId prefix so parallel test runs don't collide.
// ---------------------------------------------------------------------------

/** Insert a pending order and return its session ID. */
async function seedPendingOrder(
  userId: string,
  opts: { credits?: number; amountCents?: number; paymentIntentId?: string } = {},
): Promise<string> {
  const sessionId = `cs_test_${userId}_${Date.now()}`;
  await db.insert(gebaeudecheckOrdersTable).values({
    sessionId,
    userId,
    packageId: "single",
    credits: opts.credits ?? 1,
    amountCents: opts.amountCents ?? 1999,
    status: "pending",
    paymentIntentId: opts.paymentIntentId ?? null,
  });
  return sessionId;
}

/** Clean up all test rows for the given userId. */
async function cleanup(userId: string) {
  await db
    .delete(gebaeudecheckOrdersTable)
    .where(eq(gebaeudecheckOrdersTable.userId, userId));
  await db
    .delete(gebaeudecheckCreditsTable)
    .where(eq(gebaeudecheckCreditsTable.userId, userId));
}

describe("fulfillOrder", () => {
  const userId = `gc_fulfill_${Date.now()}`;

  beforeEach(() => cleanup(userId));

  it("grants credits and flips status to paid in one go", async () => {
    const sessionId = await seedPendingOrder(userId, { credits: 3 });

    const granted = await fulfillOrder(sessionId);

    expect(granted).toBe(true);
    const balance = await getCreditBalance(userId);
    expect(balance).toBe(3);

    const [order] = await db
      .select({ status: gebaeudecheckOrdersTable.status })
      .from(gebaeudecheckOrdersTable)
      .where(eq(gebaeudecheckOrdersTable.sessionId, sessionId));
    expect(order?.status).toBe("paid");
  });

  it("is idempotent — second call returns false and does not double-grant", async () => {
    const sessionId = await seedPendingOrder(userId, { credits: 2 });
    await fulfillOrder(sessionId);

    const second = await fulfillOrder(sessionId);

    expect(second).toBe(false);
    expect(await getCreditBalance(userId)).toBe(2);
  });

  it("does not grant credits to an already-refunded order", async () => {
    const piId = `pi_fulfill_refund_${Date.now()}`;
    const sessionId = await seedPendingOrder(userId, {
      credits: 5,
      paymentIntentId: piId,
    });
    // Fulfill first so status becomes 'paid' and credits land in DB.
    await fulfillOrder(sessionId, piId);
    expect(await getCreditBalance(userId)).toBe(5);

    // Now refund — this should reclaim all 5 credits.
    await refundOrder(piId, sessionId);
    expect(await getCreditBalance(userId)).toBe(0);

    // A spurious second fulfillOrder call (e.g. a webhook replay) must not
    // re-grant: the status is now 'refunded', not 'pending'.
    const spurious = await fulfillOrder(sessionId, piId);
    expect(spurious).toBe(false);
    expect(await getCreditBalance(userId)).toBe(0);
  });
});

describe("refundOrder", () => {
  const userId = `gc_refund_${Date.now()}`;

  beforeEach(() => cleanup(userId));

  it("deducts all credits when none have been used", async () => {
    const piId = `pi_all_unused_${Date.now()}`;
    const sessionId = await seedPendingOrder(userId, {
      credits: 5,
      paymentIntentId: piId,
    });
    await fulfillOrder(sessionId, piId);
    expect(await getCreditBalance(userId)).toBe(5);

    const result = await refundOrder(piId, sessionId);

    expect(result).not.toBeNull();
    expect(result?.creditsDeducted).toBe(5);
    expect(await getCreditBalance(userId)).toBe(0);

    const [order] = await db
      .select({
        status: gebaeudecheckOrdersTable.status,
        creditsDeducted: gebaeudecheckOrdersTable.creditsDeducted,
      })
      .from(gebaeudecheckOrdersTable)
      .where(eq(gebaeudecheckOrdersTable.sessionId, sessionId));
    expect(order?.status).toBe("refunded");
    expect(order?.creditsDeducted).toBe(5);
  });

  it("deducts only the remaining credits when some were already spent", async () => {
    const piId = `pi_partial_used_${Date.now()}`;
    const sessionId = await seedPendingOrder(userId, {
      credits: 5,
      paymentIntentId: piId,
    });
    await fulfillOrder(sessionId, piId);
    // Simulate 2 of 5 credits being spent on reports.
    await consumeCredit(userId);
    await consumeCredit(userId);
    expect(await getCreditBalance(userId)).toBe(3);

    const result = await refundOrder(piId, sessionId);

    expect(result?.creditsDeducted).toBe(3);
    expect(await getCreditBalance(userId)).toBe(0);

    const [order] = await db
      .select({ creditsDeducted: gebaeudecheckOrdersTable.creditsDeducted })
      .from(gebaeudecheckOrdersTable)
      .where(eq(gebaeudecheckOrdersTable.sessionId, sessionId));
    expect(order?.creditsDeducted).toBe(3);
  });

  it("records creditsDeducted=0 when all credits were already spent", async () => {
    const piId = `pi_all_used_${Date.now()}`;
    const orderCredits = 2;
    const sessionId = await seedPendingOrder(userId, {
      credits: orderCredits,
      paymentIntentId: piId,
    });
    await fulfillOrder(sessionId, piId);
    await consumeCredit(userId);
    await consumeCredit(userId);
    expect(await getCreditBalance(userId)).toBe(0);

    const result = await refundOrder(piId, sessionId);

    expect(result?.creditsDeducted).toBe(0);
    expect(await getCreditBalance(userId)).toBe(0);

    const [order] = await db
      .select({
        credits: gebaeudecheckOrdersTable.credits,
        creditsDeducted: gebaeudecheckOrdersTable.creditsDeducted,
      })
      .from(gebaeudecheckOrdersTable)
      .where(eq(gebaeudecheckOrdersTable.sessionId, sessionId));
    expect(order?.credits).toBe(orderCredits);
    expect(order?.creditsDeducted).toBe(0);
    expect((order?.credits ?? 0) - (order?.creditsDeducted ?? 0)).toBe(orderCredits);
  });

  it("records creditsDeducted=0 when the user has no credits balance row", async () => {
    const piId = `pi_zero_balance_${Date.now()}`;
    const orderCredits = 5;
    const sessionId = await seedPendingOrder(userId, {
      credits: orderCredits,
      paymentIntentId: piId,
    });
    await fulfillOrder(sessionId, piId);
    await db
      .delete(gebaeudecheckCreditsTable)
      .where(eq(gebaeudecheckCreditsTable.userId, userId));

    const result = await refundOrder(piId, sessionId);

    expect(result?.creditsDeducted).toBe(0);
    expect(await getCreditBalance(userId)).toBe(0);
  });

  it("is idempotent — retry returns the original creditsDeducted without re-deducting", async () => {
    const piId = `pi_idempotent_${Date.now()}`;
    const sessionId = await seedPendingOrder(userId, {
      credits: 4,
      paymentIntentId: piId,
    });
    await fulfillOrder(sessionId, piId);
    // Spend 1 of 4 credits.
    await consumeCredit(userId);

    // First refund: 3 unused credits reclaimed.
    const first = await refundOrder(piId, sessionId);
    expect(first?.creditsDeducted).toBe(3);
    expect(await getCreditBalance(userId)).toBe(0);

    // Second call (Stripe webhook retry): must not re-deduct.
    const second = await refundOrder(piId, sessionId);
    expect(second?.creditsDeducted).toBe(3);
    expect(await getCreditBalance(userId)).toBe(0);
  });

  it("consumeCredit after refund returns false (balance was reclaimed)", async () => {
    const piId = `pi_no_spend_after_refund_${Date.now()}`;
    const sessionId = await seedPendingOrder(userId, {
      credits: 1,
      paymentIntentId: piId,
    });
    await fulfillOrder(sessionId, piId);
    await refundOrder(piId, sessionId);

    const spent = await consumeCredit(userId);

    expect(spent).toBe(false);
    expect(await getCreditBalance(userId)).toBe(0);
  });

  it("handles sequential consume-then-refund correctly (balance race equivalent)", async () => {
    // Simulate the sequence: credit consumed → refund arrives for the same order.
    // The refund must deduct only the balance that remains (none in this case).
    const piId = `pi_race_seq_${Date.now()}`;
    const sessionId = await seedPendingOrder(userId, {
      credits: 3,
      paymentIntentId: piId,
    });
    await fulfillOrder(sessionId, piId);

    // All 3 consumed before the refund lands.
    await consumeCredit(userId);
    await consumeCredit(userId);
    await consumeCredit(userId);
    expect(await getCreditBalance(userId)).toBe(0);

    const result = await refundOrder(piId, sessionId);

    expect(result?.creditsDeducted).toBe(0);
    // Balance must not go negative.
    expect(await getCreditBalance(userId)).toBe(0);
  });

  it("caps a refund at the current balance across two paid orders", async () => {
    // User has two paid orders. Credits are stored as one balance, so the
    // refund must reclaim only min(current balance, refunded order credits).
    const piA = `pi_multi_a_${Date.now()}`;
    const piB = `pi_multi_b_${Date.now()}`;
    const sidA = await seedPendingOrder(userId, { credits: 5, paymentIntentId: piA });
    const sidB = await seedPendingOrder(userId, { credits: 10, paymentIntentId: piB });
    await fulfillOrder(sidA, piA);
    await fulfillOrder(sidB, piB);
    expect(await getCreditBalance(userId)).toBe(15);

    // Spend 12 credits across the shared balance. Only 3 remain, which is
    // less than order B's 10 credits.
    for (let i = 0; i < 12; i++) await consumeCredit(userId);
    expect(await getCreditBalance(userId)).toBe(3);

    // Refund order B: min(3 remaining, 10 purchased) = 3. The other order
    // remains paid, and the balance cannot become negative.
    const result = await refundOrder(piB, sidB);
    expect(result?.creditsDeducted).toBe(3);
    expect(await getCreditBalance(userId)).toBe(0);

    const [refundedOrder, otherOrder] = await Promise.all([
      db
        .select({
          status: gebaeudecheckOrdersTable.status,
          credits: gebaeudecheckOrdersTable.credits,
          creditsDeducted: gebaeudecheckOrdersTable.creditsDeducted,
        })
        .from(gebaeudecheckOrdersTable)
        .where(eq(gebaeudecheckOrdersTable.sessionId, sidB)),
      db
        .select({ status: gebaeudecheckOrdersTable.status })
        .from(gebaeudecheckOrdersTable)
        .where(eq(gebaeudecheckOrdersTable.sessionId, sidA)),
    ]);
    expect(refundedOrder[0]?.status).toBe("refunded");
    expect(refundedOrder[0]?.creditsDeducted).toBe(3);
    expect(
      (refundedOrder[0]?.credits ?? 0) - (refundedOrder[0]?.creditsDeducted ?? 0),
    ).toBe(7);
    expect(otherOrder[0]?.status).toBe("paid");
  });

  it("returns null for an unknown payment intent", async () => {
    const result = await refundOrder("pi_unknown_xyz");
    expect(result).toBeNull();
  });
});
