import { pgTable, text, serial, integer, boolean, real, timestamp, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const providersTable = pgTable("providers", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  displayName: text("display_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  bio: text("bio"),
  category: text("category").notNull(),
  categorySlug: text("category_slug").notNull(),
  city: text("city").notNull(),
  zip: text("zip").notNull(),
  address: text("address"),
  website: text("website"),
  avatarUrl: text("avatar_url"),
  logoUrl: text("logo_url"),
  yearsExperience: integer("years_experience"),
  companyLegalName: text("company_legal_name"),
  taxId: text("tax_id"),
  responseTime: text("response_time"),
  consultationMode: text("consultation_mode").notNull().default("both"),
  certificates: text("certificates").array().notNull().default(sql`'{}'::text[]`),
  rating: real("rating").notNull().default(0),
  reviewCount: integer("review_count").notNull().default(0),
  verified: boolean("verified").notNull().default(false),
  approvalStatus: text("approval_status").notNull().default("pending"),
  rejectionReason: text("rejection_reason"),
  reviewedAt: timestamp("reviewed_at"),
  subscriptionTier: text("subscription_tier").notNull().default("basic"),
  premiumSince: timestamp("premium_since"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeAccountId: text("stripe_account_id"),
  stripeOnboardedAt: timestamp("stripe_onboarded_at"),
  commissionRate: numeric("commission_rate", { precision: 4, scale: 3 }),
  icalToken: text("ical_token"),
  calendarSyncUrl: text("calendar_sync_url"),
  externalIcalUrl: text("external_ical_url"),
  qualifications: jsonb("qualifications"),
  bafaNummer: text("bafa_nummer"),
  kapazitaetStundenProWoche: integer("kapazitaet_stunden_pro_woche"),
  kleinunternehmer: boolean("kleinunternehmer").notNull().default(false),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("19.00"),
  invoicePrefix: text("invoice_prefix"),
  nextInvoiceNumber: integer("next_invoice_number").notNull().default(1),
  iban: text("iban"),
  invoiceFooter: text("invoice_footer"),
  autoIssueInvoices: boolean("auto_issue_invoices").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProviderSchema = createInsertSchema(providersTable).omit({ id: true, createdAt: true });
export type InsertProvider = z.infer<typeof insertProviderSchema>;
export type Provider = typeof providersTable.$inferSelect;
