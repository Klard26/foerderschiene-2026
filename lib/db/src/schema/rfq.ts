import {
  pgTable,
  text,
  integer,
  boolean,
  real,
  timestamp,
  jsonb,
  serial,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Pay-per-Lead "Anfrage/Angebot" (RfQ) marketplace — ADDITIVE to the existing
 * Doctolib-style instant-booking + commission model. A customer (logged in OR
 * guest) posts an open request; matching providers are notified, and each pays
 * a server-computed lead fee from their wallet to unlock the contact and send a
 * binding offer. The customer then accepts one offer.
 *
 * Identity: `customerId` is the Clerk user id when logged in, else null (guest).
 * Guest access to a request's offers/accept is bearer-authorized by an opaque
 * access token whose SHA-256 hash is stored in `accessTokenHash` (raw token is
 * only ever returned once at creation and carried in the emailed link).
 *
 * Money: ALL amounts are integer cents. Lead pricing is server-authoritative
 * (see `leadPricing.ts`); client-supplied prices are never trusted.
 */
export const requestsTable = pgTable("requests", {
  id: serial("id").primaryKey(),
  // Clerk user id when the customer is logged in; null for guest requests.
  customerId: text("customer_id"),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone"),
  // Matching dimensions: provider.categorySlug (+ optional PLZ prefix on zip).
  categorySlug: text("category_slug").notNull(),
  // Optional reference to a shared service template (metadata only in P1).
  serviceTemplateId: integer("service_template_id"),
  title: text("title").notNull(),
  description: text("description"),
  // Free-form structured answers from the request wizard.
  answers: jsonb("answers"),
  postalCode: text("postal_code"),
  city: text("city"),
  budgetMinCents: integer("budget_min_cents"),
  budgetMaxCents: integer("budget_max_cents"),
  // sofort | zwei_wochen | flexibel
  urgency: text("urgency").notNull().default("flexibel"),
  fundingRelevant: boolean("funding_relevant").notNull().default(false),
  // Cap on how many providers may send an offer before the request auto-closes.
  maxOffers: integer("max_offers").notNull().default(3),
  // DSGVO: explicit, timestamped consent to share the request with providers.
  consentDataShare: boolean("consent_data_share").notNull().default(false),
  consentTimestamp: timestamp("consent_timestamp"),
  // open | matched | fulfilled | closed | expired
  status: text("status").notNull().default("open"),
  // SHA-256 hex of the bearer access token (raw token never stored).
  accessTokenHash: text("access_token_hash").notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRequestSchema = createInsertSchema(requestsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRequest = z.infer<typeof insertRequestSchema>;
export type Request = typeof requestsTable.$inferSelect;

/**
 * One row per provider matched to a request. `matchScore` is the ranking used
 * to prioritise notifications (tier ranking boost + provider rating).
 * `notifiedAt`/`viewedAt` power response-rate statistics. Unique per
 * (request, provider) so re-matching never duplicates.
 */
export const requestMatchesTable = pgTable(
  "request_matches",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id").notNull(),
    providerId: integer("provider_id").notNull(),
    matchScore: real("match_score").notNull().default(0),
    notifiedAt: timestamp("notified_at"),
    viewedAt: timestamp("viewed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    requestProviderUnique: uniqueIndex("request_matches_request_provider_unique").on(
      t.requestId,
      t.providerId,
    ),
  }),
);

export type RequestMatch = typeof requestMatchesTable.$inferSelect;

/**
 * A provider's binding offer on a request. Created in the same transaction that
 * debits the wallet and writes the `lead_fees` row. One offer per
 * (request, provider). Status: sent | viewed | accepted | declined.
 */
export const requestOffersTable = pgTable(
  "request_offers",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id").notNull(),
    providerId: integer("provider_id").notNull(),
    leadFeeId: integer("lead_fee_id"),
    priceCents: integer("price_cents").notNull(),
    // fixed | hourly | estimate
    priceType: text("price_type").notNull().default("fixed"),
    message: text("message"),
    // ISO date (YYYY-MM-DD) the provider can start.
    availableFrom: text("available_from"),
    estimatedDuration: text("estimated_duration"),
    status: text("status").notNull().default("sent"),
    viewedAt: timestamp("viewed_at"),
    respondedAt: timestamp("responded_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    requestProviderUnique: uniqueIndex("request_offers_request_provider_unique").on(
      t.requestId,
      t.providerId,
    ),
  }),
);

export const insertRequestOfferSchema = createInsertSchema(requestOffersTable).omit(
  { id: true, createdAt: true, updatedAt: true },
);
export type InsertRequestOffer = z.infer<typeof insertRequestOfferSchema>;
export type RequestOffer = typeof requestOffersTable.$inferSelect;

/**
 * The lead fee charged to a provider for unlocking + offering on a request.
 * Snapshots the server-computed amount. `status` flows pending -> paid ->
 * refunded (Lead-Garantie). Unique per (provider, request) so a provider is
 * never double-charged for the same lead.
 */
export const leadFeesTable = pgTable(
  "lead_fees",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id").notNull(),
    requestId: integer("request_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("eur"),
    paidFromCredit: boolean("paid_from_credit").notNull().default(true),
    // When this lead was paid from a free-lead grant instead of the wallet, the
    // consumed grant id is recorded here (amountCents is then 0). Null = a normal
    // wallet-charged lead. Audit-only; refunds for free leads are no-ops.
    leadGrantId: integer("lead_grant_id"),
    // pending | paid | refunded
    status: text("status").notNull().default("pending"),
    refundReason: text("refund_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    providerRequestUnique: uniqueIndex("lead_fees_provider_request_unique").on(
      t.providerId,
      t.requestId,
    ),
  }),
);

export type LeadFee = typeof leadFeesTable.$inferSelect;

/**
 * One wallet per provider (provider_id is the PK). Balance in integer cents.
 * Funded via Stripe Checkout top-ups; debited on lead charges; credited on
 * Lead-Garantie refunds.
 */
export const providerWalletTable = pgTable("provider_wallet", {
  providerId: integer("provider_id").primaryKey(),
  balanceCents: integer("balance_cents").notNull().default(0),
  currency: text("currency").notNull().default("eur"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ProviderWallet = typeof providerWalletTable.$inferSelect;

/**
 * Append-only wallet ledger. `amountCents` is signed (positive credit, negative
 * debit) and `balanceAfterCents` snapshots the resulting balance. `stripePaymentId`
 * is unique (when present) so Stripe top-up webhooks credit a wallet at most once.
 */
export const walletTransactionsTable = pgTable(
  "wallet_transactions",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id").notNull(),
    // topup | lead_charge | refund | adjustment
    type: text("type").notNull(),
    amountCents: integer("amount_cents").notNull(),
    balanceAfterCents: integer("balance_after_cents").notNull(),
    // requestId / leadFeeId depending on type (informational).
    referenceId: integer("reference_id"),
    stripePaymentId: text("stripe_payment_id"),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    stripePaymentUnique: uniqueIndex("wallet_transactions_stripe_payment_unique").on(
      t.stripePaymentId,
    ),
  }),
);

export type WalletTransaction = typeof walletTransactionsTable.$inferSelect;

/**
 * Monthly lead-usage counter per provider, used to enforce the basic-tier
 * monthly lead cap (premium is uncapped). `periodMonth` is "YYYY-MM".
 * Composite PK (provider, month).
 */
export const leadUsageTable = pgTable(
  "lead_usage",
  {
    providerId: integer("provider_id").notNull(),
    periodMonth: text("period_month").notNull(),
    leadsUsed: integer("leads_used").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.providerId, t.periodMonth] }),
  }),
);

export type LeadUsage = typeof leadUsageTable.$inferSelect;

/**
 * Free-lead grants ("Frei-Leads"). Premium's lead value (and a Basic welcome
 * bonus) is delivered as a pool of free leads that are consumed BEFORE any
 * wallet debit on the offer flow. Sources:
 *   - `basic_signup`        : 2 leads, once at provider creation (periodMonth "once").
 *   - `premium_activation`  : 5 leads, once at premium activation (periodMonth "once").
 *   - `premium_monthly`     : 3 leads/month while premium (periodMonth "YYYY-MM",
 *                             use-it-or-lose-it via `expiresAt` = start of next month).
 *
 * Idempotency: UNIQUE(provider, source, periodMonth) means re-running a grant
 * (webhook retry, scheduler re-tick, reconcile) is a no-op. `remainingCount` is
 * decremented atomically on consumption; `expiresAt` null = never expires.
 */
export const providerLeadGrantsTable = pgTable(
  "provider_lead_grants",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id").notNull(),
    // basic_signup | premium_activation | premium_monthly
    source: text("source").notNull(),
    // "once" for one-time grants; "YYYY-MM" for the monthly premium grant.
    periodMonth: text("period_month").notNull(),
    grantedCount: integer("granted_count").notNull(),
    remainingCount: integer("remaining_count").notNull(),
    // null = never expires (one-time grants); set to start-of-next-month for the
    // monthly premium grant so unused free leads do not accumulate.
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    providerSourcePeriodUnique: uniqueIndex(
      "provider_lead_grants_provider_source_period_unique",
    ).on(t.providerId, t.source, t.periodMonth),
  }),
);

export type ProviderLeadGrant = typeof providerLeadGrantsTable.$inferSelect;
