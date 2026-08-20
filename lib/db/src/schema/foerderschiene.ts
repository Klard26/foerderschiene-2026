import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  serial,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Förderschiene — funding-program catalogue (flattened from the Förderpilot
 * classification schema). Amtliche Stammdaten + a few redaktionelle fields.
 * `tags` drives the building-profile matching engine (e.g. "heizung",
 * "daemmung", "fenster", "pv", "komplett", "steuer", "beratung").
 */
export const foerderProgrammeTable = pgTable("foerder_programme", {
  id: text("id").primaryKey(),
  titel: text("titel").notNull(),
  foerdergeber: text("foerdergeber").notNull(),
  ebene: text("ebene").notNull(), // bund | land | eu | kommune
  art: text("art").notNull(), // zuschuss | kredit | steuer | beratung
  timing: text("timing").notNull().default("vor_vorhabenbeginn"),
  foerderquoteText: text("foerderquote_text").notNull(),
  quoteMax: integer("quote_max"),
  maxBetragText: text("max_betrag_text").notNull(),
  maxBetragEur: integer("max_betrag_eur"),
  kurzbeschreibung: text("kurzbeschreibung").notNull(),
  besonderheit: text("besonderheit"),
  quelleUrl: text("quelle_url"),
  erfolgsquote: integer("erfolgsquote"),
  tags: text("tags").array().notNull().default([]),
  region: text("region").notNull().default("bundesweit"),
  aktiv: boolean("aktiv").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type FoerderProgramm = typeof foerderProgrammeTable.$inferSelect;

/**
 * One row per detailed Gebäudereport. The free preview never creates a row; a
 * paid report is created at checkout (status "pending") and unlocked
 * ("paid") via the Stripe webhook or success-redirect reconcile. The building
 * profile is stored as JSON so the saved report can be re-rendered later.
 */
export const foerderschieneReportsTable = pgTable("foerderschiene_reports", {
  id: serial("id").primaryKey(),
  // Nullable: a report can be bought as a guest (Express Checkout, no account).
  userId: text("user_id"),
  sessionId: text("session_id"),
  // Stripe PaymentIntent captured once Checkout completes. Refund webhooks
  // identify a charge by this value, rather than by the Checkout session ID.
  paymentIntentId: text("payment_intent_id"),
  // Buyer email captured from the Stripe Checkout session (for the PDF link mail).
  email: text("email"),
  status: text("status").notNull().default("pending"), // pending | paid | refunded
  amountCents: integer("amount_cents").notNull(),
  adresse: text("adresse"),
  profil: jsonb("profil").notNull(),
  // ── Förder-Affiliate consent (SEPARATE, timestamped GDPR opt-in) ──
  // Captured at report checkout, independent of the report purchase itself. A
  // finance lead is ONLY ever created/shared while financeConsent is true AND
  // financeConsentRevokedAt is null. Revoking stops future sharing but preserves
  // the consent proof already snapshotted onto existing leads.
  financeConsent: boolean("finance_consent").notNull().default(false),
  financeConsentAt: timestamp("finance_consent_at"),
  financeConsentVersion: text("finance_consent_version"),
  financeConsentText: text("finance_consent_text"),
  financeConsentRevokedAt: timestamp("finance_consent_revoked_at"),
  // Set once the lead-matching pass has run for this report (idempotency guard).
  financeLeadProcessedAt: timestamp("finance_lead_processed_at"),
  // A failed asynchronous lead-creation pass is retained durably instead of
  // being lost in a webhook log. The API scheduler retries it after this time.
  financeLeadRetryAt: timestamp("finance_lead_retry_at"),
  financeLeadRetryCount: integer("finance_lead_retry_count").notNull().default(0),
  financeLeadLastError: text("finance_lead_last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  paidAt: timestamp("paid_at"),
  refundedAt: timestamp("refunded_at"),
});

export type FoerderschieneReport = typeof foerderschieneReportsTable.$inferSelect;

/**
 * Guided PAID order for a legally-valid Energieausweis. Klard/Förderschiene
 * never generates the document — it collects the intake (energieausweis.de
 * fields), takes payment, and queues the order for a certified Aussteller.
 * Status flow: pending_payment → bezahlt → in_bearbeitung → ausgestellt
 * (or storniert | refunded).
 */
export const energieausweisOrdersTable = pgTable("energieausweis_orders", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id"),
  paymentIntentId: text("payment_intent_id"),
  ausweisTyp: text("ausweis_typ").notNull(), // bedarf | verbrauch
  status: text("status").notNull().default("pending_payment"),
  amountCents: integer("amount_cents").notNull(),
  kontaktName: text("kontakt_name").notNull(),
  kontaktEmail: text("kontakt_email").notNull(),
  intake: jsonb("intake").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  paidAt: timestamp("paid_at"),
  refundedAt: timestamp("refunded_at"),
});

/**
 * Förderprogramm-Finder leads. Created when a visitor completes the public
 * quick-check wizard and requests an AI funding analysis by email. `eingaben`
 * stores the raw wizard answers as JSON; `programmAnalyse` the generated
 * analysis text; `emailStatus` tracks delivery (pending | sent | failed).
 */
export const foerderLeadsTable = pgTable("foerder_leads", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  telefon: text("telefon"),
  eingaben: jsonb("eingaben").notNull(),
  programmAnalyse: text("programm_analyse"),
  emailStatus: text("email_status").notNull().default("pending"),
  // DSGVO consent proof — version + exact wording snapshotted server-side at
  // submission time (client-supplied text is never trusted).
  consentAt: timestamp("consent_at").notNull().defaultNow(),
  consentVersion: text("consent_version"),
  consentText: text("consent_text"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type FoerderLeadRow = typeof foerderLeadsTable.$inferSelect;

/**
 * Änderungsprotokoll der automatischen Förderprogramm-Aktualisierung. Eine
 * Zeile pro Lauf und Quelle: Zeitstempel, Anzahl eingefügter/geänderter/
 * deaktivierter Programme, Fehlertext bei Fehlschlag.
 */
export const foerderUpdateLogTable = pgTable("foerder_update_log", {
  id: serial("id").primaryKey(),
  gestartetAm: timestamp("gestartet_am").notNull().defaultNow(),
  abgeschlossenAm: timestamp("abgeschlossen_am"),
  quelle: text("quelle").notNull(),
  eingefuegt: integer("eingefuegt").notNull().default(0),
  geaendert: integer("geaendert").notNull().default(0),
  deaktiviert: integer("deaktiviert").notNull().default(0),
  fehler: text("fehler"),
});

export type FoerderUpdateLogRow = typeof foerderUpdateLogTable.$inferSelect;

export const insertEnergieausweisOrderSchema = createInsertSchema(
  energieausweisOrdersTable,
).omit({ id: true, createdAt: true, paidAt: true });
export type InsertEnergieausweisOrder = z.infer<
  typeof insertEnergieausweisOrderSchema
>;
export type EnergieausweisOrder = typeof energieausweisOrdersTable.$inferSelect;
