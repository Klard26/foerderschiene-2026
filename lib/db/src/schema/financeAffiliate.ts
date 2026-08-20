import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  serial,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Förder-Affiliate — finance partners (banks / Modernisierungskredit providers)
 * that pay Klard a fixed per-lead fee for funding-relevant Gebäudereport buyers
 * who gave a SEPARATE, timestamped consent to receive financing offers.
 *
 * Matching (P1): a partner is eligible for a report when it is `active`, its
 * `productTypes`/region cover the buyer (region "bundesweit" or a matching
 * `postalPrefix`), and the estimated investment falls inside the partner's
 * [minInvestmentCents, maxInvestmentCents] window (null = unbounded).
 *
 * `feePerLeadCents` is the revenue tracked per shared lead. There is NO Stripe
 * charge to partners in P1 — the fee is snapshotted onto each lead and billed
 * offline.
 */
export const financePartnersTable = pgTable("finance_partners", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Where finance leads are emailed.
  contactEmail: text("contact_email").notNull(),
  contactName: text("contact_name"),
  // e.g. "modernisierungskredit", "sanierungskredit", "pv_finanzierung".
  productTypes: text("product_types").array().notNull().default([]),
  // "bundesweit" or German Bundesland slugs; "bundesweit" matches every region.
  regions: text("regions").array().notNull().default([]),
  // Optional PLZ-prefix allowlist (e.g. ["80", "81"]); empty = no PLZ limit.
  postalPrefixes: text("postal_prefixes").array().notNull().default([]),
  // Investment window in cents; null = unbounded on that side.
  minInvestmentCents: integer("min_investment_cents"),
  maxInvestmentCents: integer("max_investment_cents"),
  // Fixed per-lead fee tracked as revenue (cents). Snapshotted onto each lead.
  feePerLeadCents: integer("fee_per_lead_cents").notNull().default(0),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertFinancePartnerSchema = createInsertSchema(
  financePartnersTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFinancePartner = z.infer<typeof insertFinancePartnerSchema>;
export type FinancePartner = typeof financePartnersTable.$inferSelect;

/**
 * One finance lead per (report, partner). Created ONLY for PAID reports whose
 * buyer gave an active (non-revoked) financing-offer consent. Idempotent via the
 * unique (report_id, partner_id) index — re-running fulfillment never duplicates
 * a lead or its partner email.
 *
 * Everything the partner needs is snapshotted at creation (buyer contact,
 * building profile, recommended measures, estimated investment) together with
 * the consent proof (version + text + timestamp), so the lead remains a complete
 * audit record even if the report or partner later changes.
 *
 * Status flow: created -> sent (partner emailed) -> converted | rejected.
 */
export const financeLeadsTable = pgTable(
  "finance_leads",
  {
    id: serial("id").primaryKey(),
    reportId: integer("report_id").notNull(),
    partnerId: integer("partner_id").notNull(),
    status: text("status").notNull().default("created"), // created | sent | converted | rejected
    // Snapshot of the partner fee at creation (server-authoritative revenue).
    feeCents: integer("fee_cents").notNull(),
    billed: boolean("billed").notNull().default(false),
    // Snapshot of the estimated total investment used for matching (cents).
    estimatedInvestmentCents: integer("estimated_investment_cents"),
    // Buyer snapshot (what the partner is handed).
    buyerEmail: text("buyer_email"),
    buyerName: text("buyer_name"),
    adresse: text("adresse"),
    postalCode: text("postal_code"),
    region: text("region"),
    // Building profile + recommended measures snapshots.
    profil: jsonb("profil"),
    massnahmen: jsonb("massnahmen"),
    // Consent proof snapshot (immutable evidence the lead was lawfully shared).
    consentVersion: text("consent_version"),
    consentText: text("consent_text"),
    consentAt: timestamp("consent_at"),
    sentAt: timestamp("sent_at"),
    convertedAt: timestamp("converted_at"),
    rejectedAt: timestamp("rejected_at"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    reportPartnerUnique: uniqueIndex("finance_leads_report_partner_unique").on(
      t.reportId,
      t.partnerId,
    ),
  }),
);

export type FinanceLead = typeof financeLeadsTable.$inferSelect;
