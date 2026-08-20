import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Per-user balance of "Gebäudecheck"-Guthaben. Each credit unlocks one full
 * Vollanalyse report (saved as an assessment). The free Schnellcheck never
 * consumes credits.
 */
export const gebaeudecheckCreditsTable = pgTable("gebaeudecheck_credits", {
  userId: text("user_id").primaryKey(),
  balance: integer("balance").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * One row per Stripe Checkout Session for a credit-package purchase. Used for
 * idempotent fulfillment across the webhook and the success-redirect reconcile.
 */
export const gebaeudecheckOrdersTable = pgTable("gebaeudecheck_orders", {
  sessionId: text("session_id").primaryKey(),
  paymentIntentId: text("payment_intent_id"),
  userId: text("user_id").notNull(),
  packageId: text("package_id").notNull(),
  credits: integer("credits").notNull(),
  amountCents: integer("amount_cents").notNull(),
  status: text("status").notNull().default("pending"),
  /** How many credits were reclaimed from the user's balance when this order was refunded.
   *  Set once at refund time; 0 means all credits were already used before the refund. */
  creditsDeducted: integer("credits_deducted").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  refundedAt: timestamp("refunded_at"),
});

export const insertGebaeudecheckOrderSchema = createInsertSchema(
  gebaeudecheckOrdersTable,
).omit({ createdAt: true, updatedAt: true });
export type InsertGebaeudecheckOrder = z.infer<typeof insertGebaeudecheckOrderSchema>;
export type GebaeudecheckOrder = typeof gebaeudecheckOrdersTable.$inferSelect;
export type GebaeudecheckCredits = typeof gebaeudecheckCreditsTable.$inferSelect;
