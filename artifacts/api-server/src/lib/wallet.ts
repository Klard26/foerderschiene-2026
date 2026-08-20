/**
 * Provider lead-wallet primitives. All amounts are integer cents. Movements are
 * applied inside a transaction with a row lock (FOR UPDATE) so concurrent lead
 * charges/top-ups/refunds can't race the balance. Every movement appends an
 * append-only ledger row; the unique `stripePaymentId` index makes top-up
 * webhooks idempotent (lead charges/refunds leave it null, which PG treats as
 * distinct, so they never collide).
 */
import { db } from "@workspace/db";
import { providerWalletTable, walletTransactionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import type { DbTransaction } from "./leadEntitlements";

export type WalletMovementType = "topup" | "lead_charge" | "refund" | "adjustment";

export interface WalletMovement {
  type: WalletMovementType;
  /** Signed: positive credits the wallet, negative debits it. */
  amountCents: number;
  referenceId?: number | null;
  stripePaymentId?: string | null;
  note?: string | null;
}

/** Ensure a wallet row exists and return its current balance (cents). */
export async function ensureWallet(providerId: number): Promise<number> {
  await db
    .insert(providerWalletTable)
    .values({ providerId })
    .onConflictDoNothing({ target: providerWalletTable.providerId });
  const [row] = await db
    .select({ balanceCents: providerWalletTable.balanceCents })
    .from(providerWalletTable)
    .where(eq(providerWalletTable.providerId, providerId))
    .limit(1);
  return row?.balanceCents ?? 0;
}

/** The provider's most recent ledger rows (newest first). */
export async function listWalletTransactions(
  providerId: number,
  limit = 25,
): Promise<(typeof walletTransactionsTable.$inferSelect)[]> {
  return db
    .select()
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.providerId, providerId))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(limit);
}

/**
 * Apply a signed movement to a provider's wallet inside a transaction. Locks the
 * wallet row, updates the balance, and appends a ledger row. Throws
 * `INSUFFICIENT_FUNDS` if a debit would overdraw. Returns the new balance.
 *
 * For top-ups, pass `stripePaymentId`; a duplicate webhook then violates the
 * unique index and rolls the whole movement back (no double credit).
 */
export async function applyWalletMovement(
  tx: DbTransaction,
  providerId: number,
  movement: WalletMovement,
): Promise<number> {
  await tx
    .insert(providerWalletTable)
    .values({ providerId })
    .onConflictDoNothing({ target: providerWalletTable.providerId });

  const [wallet] = await tx
    .select({ balanceCents: providerWalletTable.balanceCents })
    .from(providerWalletTable)
    .where(eq(providerWalletTable.providerId, providerId))
    .for("update")
    .limit(1);

  const current = wallet?.balanceCents ?? 0;
  const next = current + movement.amountCents;
  if (next < 0) throw new Error("INSUFFICIENT_FUNDS");

  await tx
    .update(providerWalletTable)
    .set({ balanceCents: next, updatedAt: new Date() })
    .where(eq(providerWalletTable.providerId, providerId));

  await tx.insert(walletTransactionsTable).values({
    providerId,
    type: movement.type,
    amountCents: movement.amountCents,
    balanceAfterCents: next,
    referenceId: movement.referenceId ?? null,
    stripePaymentId: movement.stripePaymentId ?? null,
    note: movement.note ?? null,
  });

  return next;
}
