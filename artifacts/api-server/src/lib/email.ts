import { sendEmailViaResend } from "./resendClient";
import { logger } from "./logger";
import { db, pool } from "@workspace/db";
import { emailLogTable } from "@workspace/db";
import { and, eq, desc, lt, gte, inArray } from "drizzle-orm";

import tplWelcomeProvider from "../email-templates/welcome_provider.hbs";
import tplBookingConfirmCustomer from "../email-templates/booking_confirmation_customer.hbs";
import tplBookingConfirmProvider from "../email-templates/booking_confirmation_provider.hbs";
import tplCancelledByCustomer from "../email-templates/booking_cancelled_by_customer.hbs";
import tplCancelledByProvider from "../email-templates/booking_cancelled_by_provider.hbs";
import tplReminder24h from "../email-templates/booking_reminder_24h.hbs";
import tplInvoiceReady from "../email-templates/invoice_ready.hbs";
import tplWelcomeCustomer from "../email-templates/welcome_customer.hbs";
import tplStripeActivated from "../email-templates/stripe_activated.hbs";
import tplPaymentFailed from "../email-templates/payment_failed.hbs";
import tplPaymentRefunded from "../email-templates/payment_refunded.hbs";
import tplReminder1h from "../email-templates/booking_reminder_1h.hbs";
import tplFoerderschieneReportReady from "../email-templates/foerderschiene_report_ready.hbs";
import tplFoerderUpdateFailure from "../email-templates/foerder_update_failure.hbs";
import tplEnergieausweisOrderConfirmation from "../email-templates/energieausweis_order_confirmation.hbs";
import tplFinanceLeadPartner from "../email-templates/finance_lead_partner.hbs";
import tplNewRequestProvider from "../email-templates/new_request_provider.hbs";
import tplOfferReceived from "../email-templates/offer_received.hbs";
import tplIcalBookingConflict from "../email-templates/ical_booking_conflict.hbs";

const APP_URL =
  process.env["APP_URL"] ??
  (process.env["REPLIT_DOMAINS"]?.split(",")[0]
    ? `https://${process.env["REPLIT_DOMAINS"]?.split(",")[0]}`
    : "http://localhost");

const BERLIN_TZ = "Europe/Berlin";
const dt = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: BERLIN_TZ,
});
const dateFmt = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: BERLIN_TZ,
});
const timeFmt = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: BERLIN_TZ,
});

function toDate(d: Date | string): Date {
  return typeof d === "string" ? new Date(d) : d;
}
function fmtDateTime(d: Date | string): string {
  return dt.format(toDate(d));
}
function fmtDate(d: Date | string): string {
  return dateFmt.format(toDate(d));
}
function fmtTime(d: Date | string): string {
  return `${timeFmt.format(toDate(d))} Uhr`;
}
function fmtDuration(min?: number | null): string {
  if (!min || min <= 0) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h} Std. ${m} Min.`;
  if (h) return `${h} Std.`;
  return `${m} Min.`;
}
function eur(amount: number): string {
  return amount.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}
function bookingNumber(id: number): string {
  return `KLD-${String(id).padStart(6, "0")}`;
}
function commissionRate(tier?: string | null): number {
  return tier === "premium" ? 0.04 : 0.09;
}

// ── Branded HTML template rendering ──────────────────────────────────────────
// The attached templates mix correct `{{key}}` placeholders with a few
// single-brace `{key}` typos, so the renderer replaces both forms for every
// supplied key, then strips any leftover `{{...}}` placeholder.

type Vars = Record<string, string | number | null | undefined>;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderTemplate(tpl: string, vars: Vars): string {
  let out = tpl;
  for (const [key, raw] of Object.entries(vars)) {
    const value = escapeHtml(raw == null ? "" : String(raw));
    out = out.split(`{{${key}}}`).join(value).split(`{${key}}`).join(value);
  }
  // Remove any unreplaced double-brace placeholders so they never reach a user.
  out = out.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, "");
  return out;
}

function legacyWrap(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f7f7f8;margin:0;padding:24px;color:#111">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
  <h1 style="font-size:20px;margin:0 0 16px">Klard</h1>
  <h2 style="font-size:18px;margin:0 0 12px">${title}</h2>
  ${bodyHtml}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
  <p style="font-size:12px;color:#6b7280;margin:0">Klard — Berater einfach buchen. <a href="${APP_URL}" style="color:#6b7280">${APP_URL}</a></p>
</div></body></html>`;
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{ filename: string; content: string; isBase64?: boolean }>;
  /** Template identifier (filename stem) for the email_log audit trail. */
  templateId?: string;
  /** Domain object the email relates to (e.g. booking id) for dedupe lookups. */
  relatedId?: string | number | null;
  /** Existing email_log claim used for atomic transactional delivery. */
  claimId?: number | null;
}

type SendDeliveryResult = "sent" | "failed" | "skipped";

/**
 * Result for transactional sends protected by an atomic email-log claim.
 * An active claim remains distinguishable from a completed delivery so callers
 * can request a retry instead of acknowledging a webhook too early.
 */
export type TransactionalEmailDeliveryResult =
  | SendDeliveryResult
  | "already_delivered"
  | "in_flight"
  | "retryable";

async function logEmail(args: SendArgs, status: "sent" | "failed" | "skipped", error?: string): Promise<void> {
  if (!args.templateId) return;
  try {
    await db.insert(emailLogTable).values({
      templateId: args.templateId,
      recipient: args.to,
      relatedId: args.relatedId == null ? null : String(args.relatedId),
      subject: args.subject,
      status,
      error: error ?? null,
    });
  } catch (err) {
    logger.error({ err, templateId: args.templateId }, "Failed to persist email_log entry");
  }
}

async function finishEmailClaim(
  claimId: number,
  status: "sent" | "failed" | "skipped",
  error?: string,
): Promise<void> {
  try {
    await db
      .update(emailLogTable)
      .set({ status, error: error ?? null, sentAt: new Date() })
      .where(eq(emailLogTable.id, claimId));
  } catch (err) {
    logger.error({ err, claimId }, "Failed to finalize email delivery claim");
  }
}

/**
 * Atomically claims one transactional email. A recent sent/in-flight claim
 * blocks duplicates; stale in-flight claims are reclaimed for retry.
 */
type EmailDeliveryClaim =
  | { status: "claimed"; id: number }
  | { status: "already_delivered" | "in_flight" | "retryable" };

async function claimEmailDelivery(args: {
  templateId: string;
  relatedId: string | number;
  recipient: string;
  subject: string;
}): Promise<EmailDeliveryClaim> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO email_log (template_id, recipient, related_id, subject, status)
     VALUES ($1, $2, $3, $4, 'in_flight')
     ON CONFLICT (template_id, related_id) WHERE status IN ('in_flight', 'sent')
     DO UPDATE SET
       status = 'in_flight',
       recipient = EXCLUDED.recipient,
       subject = EXCLUDED.subject,
       error = NULL,
       sent_at = NOW()
     WHERE email_log.status = 'in_flight'
       AND email_log.sent_at < NOW() - INTERVAL '10 minutes'
     RETURNING id`,
    [args.templateId, args.recipient, String(args.relatedId), args.subject],
  );
  const claimId = rows[0]?.id;
  if (claimId) return { status: "claimed", id: claimId };

  // The active partial unique index rejected this claim. Inspect the active
  // row to distinguish an already-delivered email from a concurrent sender.
  // If the sender failed between the upsert and this read, no active row
  // remains and the caller must request a fresh retry upstream.
  const [activeClaim] = await db
    .select({ status: emailLogTable.status })
    .from(emailLogTable)
    .where(
      and(
        eq(emailLogTable.templateId, args.templateId),
        eq(emailLogTable.relatedId, String(args.relatedId)),
        inArray(emailLogTable.status, ["in_flight", "sent"]),
      ),
    )
    .orderBy(desc(emailLogTable.sentAt))
    .limit(1);
  if (activeClaim?.status === "sent") return { status: "already_delivered" };
  if (activeClaim?.status === "in_flight") return { status: "in_flight" };
  return { status: "retryable" };
}

/**
 * Returns true if an email with the given templateId (and optional relatedId)
 * has already been logged with status "sent". Used by schedulers to dedupe.
 */
export async function wasEmailSent(
  templateId: string,
  relatedId?: string | number | null,
  since?: Date,
): Promise<boolean> {
  const conds = [eq(emailLogTable.templateId, templateId), eq(emailLogTable.status, "sent")];
  if (relatedId != null) conds.push(eq(emailLogTable.relatedId, String(relatedId)));
  if (since) conds.push(gte(emailLogTable.sentAt, since));
  const [row] = await db
    .select({ id: emailLogTable.id })
    .from(emailLogTable)
    .where(and(...conds))
    .orderBy(desc(emailLogTable.sentAt))
    .limit(1);
  return !!row;
}

/**
 * Returns true when an attempt with the given template and related ID was
 * recorded, regardless of delivery outcome. Use this for rate-limiting
 * operator alerts: a broken provider must not turn into a repeated hourly
 * send attempt.
 */
export async function wasEmailLogged(
  templateId: string,
  relatedId: string | number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: emailLogTable.id })
    .from(emailLogTable)
    .where(
      and(
        eq(emailLogTable.templateId, templateId),
        eq(emailLogTable.relatedId, String(relatedId)),
      ),
    )
    .orderBy(desc(emailLogTable.sentAt))
    .limit(1);
  return !!row;
}

/**
 * Data-minimization retention window for the `email_log` audit table. Rows hold
 * a recipient email address, so we age them out on a schedule rather than keep
 * them forever. Twelve months is far longer than any reminder/idempotency
 * dedupe horizon (`wasEmailSent` only matters around a booking's appointment
 * date, weeks at most), so purging older rows never breaks dedupe.
 */
export const EMAIL_LOG_RETENTION_DAYS = 365;

/**
 * Deletes `email_log` rows older than the retention window. Returns the number
 * of rows removed. Safe to run repeatedly (idempotent — already-purged rows are
 * simply gone). Uses the existing `sent_at` index for the range scan.
 */
/**
 * Logged email templates whose delivery failures should page or be visible to
 * an operator. Keeping the inventory complete means a broken mail provider is
 * visible regardless of which customer or partner workflow sends first.
 */
export const CRITICAL_TRANSACTIONAL_EMAIL_TEMPLATE_IDS = [
  "foerderschiene_report_ready",
  "foerder_update_failure",
  "energieausweis_order_confirmation",
  "finance_lead_partner",
  "booking_confirmation_customer",
  "booking_confirmation_provider",
  "booking_cancelled_by_customer",
  "booking_cancelled_by_provider",
  "booking_reminder_24h",
  "booking_reminder_1h",
  "invoice_ready",
  "invoice_storno",
  "payment_failed",
  "payment_refunded",
  "foerder_finder_analyse",
  "new_request_provider",
  "offer_received",
  "welcome_provider",
  "welcome_customer",
  "stripe_activated",
  "ical_booking_conflict",
] as const;

export type EmailDeliveryFailure = {
  id: number;
  templateId: string;
  recipient: string;
  error: string | null;
  sentAt: Date;
};

/**
 * Looks back `windowHours` hours in `email_log` for failed rows belonging to
 * the supplied template IDs. When failures are found an ERROR is logged so
 * on-call tooling picks them up. Returns the failed rows so callers (admin
 * endpoint, tests) can inspect them.
 */
export async function checkEmailDeliveryHealth(
  windowHours = 24,
  now: Date = new Date(),
  templateIds: readonly string[] = CRITICAL_TRANSACTIONAL_EMAIL_TEMPLATE_IDS,
): Promise<EmailDeliveryFailure[]> {
  if (templateIds.length === 0) return [];

  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: emailLogTable.id,
      templateId: emailLogTable.templateId,
      recipient: emailLogTable.recipient,
      error: emailLogTable.error,
      sentAt: emailLogTable.sentAt,
    })
    .from(emailLogTable)
    .where(
      and(
        inArray(emailLogTable.templateId, [...templateIds]),
        eq(emailLogTable.status, "failed"),
        gte(emailLogTable.sentAt, since),
      ),
    )
    .orderBy(desc(emailLogTable.sentAt));

  if (rows.length > 0) {
    logger.error(
      {
        failedCount: rows.length,
        windowHours,
        samples: rows.slice(0, 5).map((r) => ({
          id: r.id,
          templateId: r.templateId,
          error: r.error,
          sentAt: r.sentAt.toISOString(),
        })),
        templateIds,
      },
      "EMAIL DELIVERY ALERT: critical transactional email failures detected",
    );
  }

  return rows;
}

export async function purgeOldEmailLogs(
  now: Date = new Date(),
  retentionDays: number = EMAIL_LOG_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(emailLogTable)
    .where(lt(emailLogTable.sentAt, cutoff))
    .returning({ id: emailLogTable.id });
  if (deleted.length > 0) {
    logger.info(
      { count: deleted.length, cutoff: cutoff.toISOString(), retentionDays },
      "Purged old email_log rows",
    );
  }
  return deleted.length;
}

async function send(args: SendArgs): Promise<SendDeliveryResult> {
  const result = await sendEmailViaResend({
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
    attachments: args.attachments?.map((a) => ({
      filename: a.filename,
      content: a.isBase64
        ? a.content
        : Buffer.from(a.content, "utf8").toString("base64"),
    })),
  });

  const status: "sent" | "failed" | "skipped" = result.skipped
    ? "skipped"
    : result.sent
      ? "sent"
      : "failed";

  if (result.skipped) {
    logger.warn({ to: args.to, subject: args.subject }, "Resend not configured — email skipped");
  } else if (!result.sent) {
    logger.error({ err: result.error, to: args.to }, "Resend send failed");
  } else {
    logger.info({ to: args.to, subject: args.subject }, "Email sent");
  }

  if (args.claimId) {
    await finishEmailClaim(args.claimId, status, result.error ?? undefined);
  } else {
    await logEmail(args, status, result.error ?? undefined);
  }

  return status;
}

// ── Templates ───────────────────────────────────────────────────────────────

/** Human-readable labels for the RfQ matching categories (slug → German name). */
const RFQ_CATEGORY_LABELS: Record<string, string> = {
  architektur: "Architektur",
  "bauberatung-baubegleitung": "Bauberatung / Baubegleitung",
  "bauphysik-spezialberatung": "Bauphysik & Spezialberatung",
  energieberatung: "Energieberatung",
  gebaeudesachverstaendige: "Gebäudesachverständige",
  "statiker-tragwerksplaner": "Statiker / Tragwerksplaner",
  "tga-fachplaner-haustechnik": "TGA-Fachplaner (Haustechnik)",
  "vermesser-geodaeten": "Vermesser / Geodäten",
};
function rfqCategoryLabel(slug: string): string {
  return RFQ_CATEGORY_LABELS[slug] ?? slug;
}

/**
 * Notify a matched provider that a new RfQ request landed in their inbox.
 * Contact details are intentionally NOT included (revealed only after offering).
 */
export async function sendNewRequestToProvider(p: {
  providerEmail: string;
  providerName: string;
  requestTitle: string;
  city?: string | null;
  categorySlug: string;
  requestUrl: string;
}): Promise<void> {
  if (!p.providerEmail) return;
  const category = rfqCategoryLabel(p.categorySlug);
  const html = renderTemplate(tplNewRequestProvider, {
    providerName: p.providerName,
    requestTitle: p.requestTitle,
    city: p.city || "ohne Ortsangabe",
    category,
    requestUrl: p.requestUrl,
  });
  await send({
    to: p.providerEmail,
    subject: `Neue Anfrage: ${p.requestTitle}`,
    html,
    text: `Neue Anfrage in Ihrer Kategorie ${category}${p.city ? ` (${p.city})` : ""}: ${p.requestTitle}. Jetzt ansehen und Angebot senden: ${p.requestUrl}`,
    templateId: "new_request_provider",
    relatedId: p.providerEmail,
  });
}

/** Notify a customer that a provider sent a binding offer on their request. */
export async function sendOfferReceivedToCustomer(p: {
  customerEmail: string;
  customerName: string;
  requestTitle: string;
  providerName: string;
  priceCents: number;
  message?: string | null;
  requestUrl: string;
}): Promise<void> {
  if (!p.customerEmail) return;
  const price = eur(p.priceCents / 100);
  const html = renderTemplate(tplOfferReceived, {
    customerName: p.customerName,
    requestTitle: p.requestTitle,
    providerName: p.providerName,
    price,
    message: p.message || "Keine zusätzliche Nachricht.",
    requestUrl: p.requestUrl,
  });
  await send({
    to: p.customerEmail,
    subject: `Neues Angebot für „${p.requestTitle}“`,
    html,
    text: `${p.providerName} hat Ihnen ein Angebot (${price}) für „${p.requestTitle}“ gesendet. Angebote vergleichen und annehmen: ${p.requestUrl}`,
    templateId: "offer_received",
    relatedId: p.customerEmail,
  });
}

export async function sendProviderWelcome(p: {
  email: string;
  displayName: string;
}): Promise<void> {
  if (!p.email) return;
  const html = renderTemplate(tplWelcomeProvider, {
    providerName: p.displayName,
    dashboardUrl: `${APP_URL}/dashboard`,
  });
  await send({
    to: p.email,
    subject: "Willkommen bei Klard",
    html,
    text: `Willkommen bei Klard, ${p.displayName}! Ihr Berater-Profil ist aktiv. Dashboard: ${APP_URL}/dashboard`,
    templateId: "welcome_provider",
    relatedId: p.email,
  });
}

export async function sendCustomerWelcome(p: {
  email: string;
  customerName: string;
}): Promise<void> {
  if (!p.email) return;
  const html = renderTemplate(tplWelcomeCustomer, {
    customerName: p.customerName,
    accountUrl: `${APP_URL}/search`,
  });
  await send({
    to: p.email,
    subject: "Willkommen bei Klard",
    html,
    text: `Willkommen bei Klard, ${p.customerName}! Jetzt geprüfte Berater finden und buchen: ${APP_URL}/search`,
    templateId: "welcome_customer",
    relatedId: p.email,
  });
}

export async function sendStripeActivated(p: {
  email: string;
  providerName: string;
}): Promise<void> {
  if (!p.email) return;
  const html = renderTemplate(tplStripeActivated, {
    providerName: p.providerName,
    dashboardUrl: `${APP_URL}/dashboard`,
  });
  await send({
    to: p.email,
    subject: "Ihr Klard Premium ist aktiv",
    html,
    text: `Ihr Klard Premium-Abo ist aktiv, ${p.providerName}. Zum Dashboard: ${APP_URL}/dashboard`,
    templateId: "stripe_activated",
    relatedId: p.email,
  });
}

/**
 * Notify a provider that their external iCal feed contains an event that
 * overlaps an active Klard booking. The overlapping external event was NOT
 * imported (the Klard booking always wins); this nudge lets the provider fix
 * the clash on their side. Deduped by the caller via `wasEmailSent`.
 */
export async function notifyProviderIcalConflict(p: {
  providerEmail: string;
  providerName: string;
  bookingCustomerName: string | null;
  bookingServiceName: string | null;
  bookingScheduledAt: Date | string;
  externalSummary: string | null;
  externalStart: Date | string;
  externalEnd: Date | string;
  relatedId: string;
}): Promise<void> {
  if (!p.providerEmail) return;
  const bookingLabel =
    [p.bookingServiceName, p.bookingCustomerName].filter(Boolean).join(" · ") ||
    "Klard-Buchung";
  const externalWhen = `${fmtDate(p.externalStart)}, ${fmtTime(p.externalStart)} – ${fmtTime(p.externalEnd)}`;
  const html = renderTemplate(tplIcalBookingConflict, {
    providerName: p.providerName,
    bookingLabel,
    bookingWhen: fmtDateTime(p.bookingScheduledAt),
    externalSummary: p.externalSummary || "Externer Termin",
    externalWhen,
    dashboardUrl: `${APP_URL}/dashboard`,
  });
  await send({
    to: p.providerEmail,
    subject: "Kalender-Konflikt: Ihr externer Termin überschneidet eine Klard-Buchung",
    html,
    text: `Hallo ${p.providerName}, Ihr externer Kalender enthält einen Termin (${externalWhen}), der mit Ihrer Klard-Buchung (${bookingLabel}, ${fmtDateTime(p.bookingScheduledAt)}) kollidiert. Die Klard-Buchung bleibt bestehen. Bitte prüfen Sie den Konflikt: ${APP_URL}/dashboard`,
    templateId: "ical_booking_conflict",
    relatedId: p.relatedId,
  });
}

export async function sendEnergieausweisOrderConfirmation(p: {
  email: string;
  kontaktName: string;
  ausweisLabel: string;
  orderId: string | number;
}): Promise<TransactionalEmailDeliveryResult> {
  if (!p.email) return "skipped";
  const subject = `Bestellbestätigung: ${p.ausweisLabel}`;
  const claim = await claimEmailDelivery({
    templateId: "energieausweis_order_confirmation",
    relatedId: p.orderId,
    recipient: p.email,
    subject,
  });
  if (claim.status !== "claimed") return claim.status;
  const html = renderTemplate(tplEnergieausweisOrderConfirmation, {
    kontaktName: p.kontaktName,
    ausweisLabel: p.ausweisLabel,
    orderId: String(p.orderId),
  });
  return send({
    to: p.email,
    subject,
    html,
    text: `Hallo ${p.kontaktName}, vielen Dank für Ihre Bestellung (${p.ausweisLabel}, Bestellnummer: ${p.orderId}). Ein zertifizierter Aussteller bearbeitet Ihren Antrag. Sie erhalten Ihren fertigen Energieausweis in der Regel innerhalb von 3–5 Werktagen per E-Mail. Bei Fragen: support@foerderschiene.de`,
    templateId: "energieausweis_order_confirmation",
    relatedId: p.orderId,
    claimId: claim.id,
  });
}

/** Confirms that Stripe has completed a refund for a paid purchase. */
export type RefundEmailDeliveryResult = SendDeliveryResult | "already_claimed";

export async function sendPaymentRefunded(p: {
  email: string;
  productName: string;
  amountCents: number;
  relatedId: string;
  kontaktName?: string | null;
}): Promise<RefundEmailDeliveryResult> {
  if (!p.email) return "skipped";
  const amount = eur(p.amountCents / 100);
  const subject = `Rückerstattung bestätigt: ${p.productName}`;
  const relatedId = p.relatedId;
  const claim = await claimEmailDelivery({
    templateId: "payment_refunded",
    relatedId,
    recipient: p.email,
    subject,
  });
  if (claim.status !== "claimed") return "already_claimed";
  const html = renderTemplate(tplPaymentRefunded, {
    kontaktName: p.kontaktName?.trim() || "Kundin, Kunde",
    productName: p.productName,
    amount,
  });
  return send({
    to: p.email,
    subject,
    html,
    text: `Guten Tag ${p.kontaktName?.trim() || ""}, Ihre Rückerstattung für ${p.productName} in Höhe von ${amount} wurde bestätigt. Je nach Zahlungsmethode kann es einige Werktage dauern, bis der Betrag auf Ihrem Konto erscheint. Bei Fragen erreichen Sie uns unter support@foerderschiene.de.`,
    templateId: "payment_refunded",
    relatedId,
    claimId: claim.id,
  });
}

export async function sendFoerderschieneReportReady(p: {
  email: string;
  reportUrl: string;
  adresse?: string | null;
  relatedId?: string | number | null;
}): Promise<void> {
  if (!p.email) return;
  const adresseSatz = p.adresse ? ` für ${p.adresse}` : "";
  const html = renderTemplate(tplFoerderschieneReportReady, {
    reportUrl: p.reportUrl,
    adresseSatz,
  });
  await send({
    to: p.email,
    subject: "Ihr Gebäudereport ist fertig",
    html,
    text: `Vielen Dank für Ihren Kauf. Ihr detaillierter Gebäudereport${adresseSatz} ist jetzt freigeschaltet. Ansehen und als PDF speichern: ${p.reportUrl}`,
    templateId: "foerderschiene_report_ready",
    relatedId: p.relatedId ?? p.email,
  });
}

/**
 * Alerts the catalogue operator when one source repeatedly fails to update.
 * The scheduler owns the retry threshold and weekly deduplication; this
 * function only sends and records the notification.
 */
export async function sendFoerderUpdateFailureAlert(p: {
  adminEmail: string;
  quelle: string;
  failureCount: number;
  lastError: string;
  relatedId: string;
}): Promise<void> {
  if (!p.adminEmail) return;
  const source = p.quelle.toUpperCase();
  const failureCountLabel =
    p.failureCount === 1
      ? "ein aufeinanderfolgender Fehlversuch"
      : `${p.failureCount} aufeinanderfolgende Fehlversuche`;
  const lastError = p.lastError.slice(0, 1_000);
  const adminUrl = `${APP_URL}/verwaltung`;
  const html = renderTemplate(tplFoerderUpdateFailure, {
    source,
    failureCount: failureCountLabel,
    lastError,
    adminUrl,
  });
  await send({
    to: p.adminEmail,
    subject: `Förderkatalog: ${source}-Aktualisierung wiederholt fehlgeschlagen`,
    html,
    text: `Die automatische Aktualisierung der Quelle ${source} ist nach ${failureCountLabel} weiterhin fehlgeschlagen. Letzter Fehler: ${lastError}. Bitte prüfen Sie das Katalog-Update: ${adminUrl}`,
    templateId: "foerder_update_failure",
    relatedId: p.relatedId,
  });
}

/**
 * Calls Resend for the report-ready email without writing an email_log row.
 *
 * Used by `deliverReportReadyEmail`, which pre-inserts the claim log row inside
 * a SELECT-FOR-UPDATE transaction and then calls this function outside the
 * transaction to avoid holding DB locks during the HTTP call. Returns a
 * discriminated result so the caller can flip the claim row's status to
 * 'failed'/'skipped' on error (allowing a future retry).
 */
export async function sendFoerderschieneReportReadyUnlogged(p: {
  email: string;
  reportUrl: string;
  adresse?: string | null;
}): Promise<{ sent: boolean; skipped: boolean; error: string | null }> {
  const adresseSatz = p.adresse ? ` für ${p.adresse}` : "";
  const html = renderTemplate(tplFoerderschieneReportReady, {
    reportUrl: p.reportUrl,
    adresseSatz,
  });
  return sendEmailViaResend({
    to: p.email,
    subject: "Ihr Gebäudereport ist fertig",
    html,
    text: `Vielen Dank für Ihren Kauf. Ihr detaillierter Gebäudereport${adresseSatz} ist jetzt freigeschaltet. Ansehen und als PDF speichern: ${p.reportUrl}`,
  });
}

/**
 * Förder-Affiliate — notify a finance partner of a new, consented lead. Sent
 * once per lead (deduped by the caller via `wasEmailSent("finance_lead_partner",
 * leadId)`). Contains only the data the partner needs to follow up; the buyer
 * already gave a separate, timestamped consent to be contacted.
 */
/**
 * Förderprogramm-Finder — send the AI-generated funding analysis to the lead.
 * Structured data is escaped field-by-field here (renderTemplate escaping is
 * bypassed on purpose because the layout is built programmatically per
 * programme). Logged with templateId "foerder_finder_analyse" + leadId so the
 * caller can verify delivery via `wasEmailSent`.
 */
export async function sendFoerderFinderAnalyse(p: {
  email: string;
  name: string;
  analyse: {
    einleitung: string;
    programme: Array<{
      titel: string;
      foerdergeber: string;
      foerderhoehe: string;
      antragspfad: string;
      naechsteSchritte: string;
    }>;
  };
  leadId: number;
}): Promise<void> {
  const e = escapeHtml;
  const programmeHtml = p.analyse.programme
    .map(
      (prog, i) => `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#FDF6EC;border-left:3px solid #D98324;border-radius:6px;margin:0 0 16px;">
  <tr><td style="padding:16px 20px;">
    <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#B96A12;letter-spacing:1.2px;text-transform:uppercase;">Programm ${i + 1} · ${e(prog.foerdergeber)}</p>
    <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:#13243D;">${e(prog.titel)}</p>
    <p style="margin:0 0 6px;font-size:13px;color:#1F2D44;line-height:1.55;"><strong>Förderhöhe:</strong> ${e(prog.foerderhoehe)}</p>
    <p style="margin:0 0 6px;font-size:13px;color:#1F2D44;line-height:1.55;"><strong>Antragsweg:</strong> ${e(prog.antragspfad)}</p>
    <p style="margin:0;font-size:13px;color:#1F2D44;line-height:1.55;"><strong>Nächste Schritte:</strong> ${e(prog.naechsteSchritte)}</p>
  </td></tr>
</table>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ihre Förderanalyse</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background-color:#F5F2E8;color:#13243D;">
<div style="display:none;max-height:0;overflow:hidden;color:transparent;">Ihre persönliche Analyse der passenden Förderprogramme</div>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#F5F2E8;padding:24px 16px;"><tr><td align="center">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:12px;overflow:hidden;">
  <tr><td style="background-color:#0E1B2E;padding:28px 32px;">
    <p style="margin:0;font-family:Georgia,serif;font-size:22px;color:#FFFFFF;font-weight:700;">Ihre persönliche Förderanalyse</p>
    <p style="margin:8px 0 0;font-size:13px;color:#E9B872;">Förderschiene — Gebäudecheck &amp; Förderung</p>
  </td></tr>
  <tr><td style="padding:28px 32px;">
    <p style="font-size:15px;line-height:1.65;color:#1F2D44;margin:0 0 16px;">Guten Tag ${e(p.name)},</p>
    <p style="font-size:15px;line-height:1.65;color:#1F2D44;margin:0 0 24px;">${e(p.analyse.einleitung)}</p>
    ${programmeHtml}
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0 8px;"><tr><td style="background-color:#D98324;border-radius:8px;">
      <a href="${APP_URL}/check" style="display:inline-block;padding:14px 32px;color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;">Jetzt Gebäudecheck starten →</a>
    </td></tr></table>
    <p style="font-size:12px;line-height:1.6;color:#8B8676;margin:16px 0 0;">Hinweis: Diese Analyse wurde automatisiert erstellt und ersetzt keine Energieberatung. Förderkonditionen können sich kurzfristig ändern — stellen Sie Anträge grundsätzlich vor Vorhabenbeginn.</p>
    <p style="font-size:15px;line-height:1.65;color:#1F2D44;margin:24px 0 0;">Viele Grüße,<br><strong>Ihr Förderschiene-Team</strong></p>
  </td></tr>
  <tr><td style="background-color:#0E1B2E;color:#94A3B8;padding:24px 32px;font-size:11px;line-height:1.6;">
    <p style="margin:0 0 8px;color:#E9B872;font-weight:600;">Förderschiene — Gebäudecheck &amp; Förderung</p>
    <p style="margin:0 0 12px;">Klard GmbH · Kurfürstendamm 193E · 10707 Berlin</p>
    <p style="margin:12px 0 0;color:#475569;font-size:10px;">Sie erhalten diese E-Mail, weil Sie über den Förderprogramm-Finder eine Analyse angefordert haben.</p>
  </td></tr>
</table></td></tr></table>
</body></html>`;

  const text = [
    `Guten Tag ${p.name},`,
    "",
    p.analyse.einleitung,
    "",
    ...p.analyse.programme.map(
      (prog, i) =>
        `${i + 1}. ${prog.titel} (${prog.foerdergeber})\nFörderhöhe: ${prog.foerderhoehe}\nAntragsweg: ${prog.antragspfad}\nNächste Schritte: ${prog.naechsteSchritte}\n`,
    ),
    `Jetzt Gebäudecheck starten: ${APP_URL}/check`,
  ].join("\n");

  await send({
    to: p.email,
    subject: "Ihre persönliche Förderanalyse — die passenden Programme für Ihr Vorhaben",
    html,
    text,
    templateId: "foerder_finder_analyse",
    relatedId: p.leadId,
  });
}

export async function sendFinanceLeadToPartner(p: {
  partnerEmail: string;
  partnerName: string;
  buyerEmail: string | null;
  adresse: string | null;
  postalCode: string | null;
  estimatedInvestmentCents: number | null;
  massnahmen: Array<{ label: string }>;
  leadId: number | string;
}): Promise<void> {
  if (!p.partnerEmail) return;
  const investitionEur =
    p.estimatedInvestmentCents != null
      ? eur(p.estimatedInvestmentCents / 100)
      : "keine Angabe";
  const massnahmenListe = p.massnahmen.length
    ? p.massnahmen.map((m) => m.label).join(" · ")
    : "Siehe Gebäudereport";
  const html = renderTemplate(tplFinanceLeadPartner, {
    partnerName: p.partnerName,
    buyerEmail: p.buyerEmail ?? "—",
    adresse: p.adresse ?? "—",
    postalCode: p.postalCode ?? "—",
    investitionEur,
    massnahmenListe,
  });
  await send({
    to: p.partnerEmail,
    subject: "Neue Finanzierungsanfrage – Förderschiene",
    html,
    text: `Neue Finanzierungsanfrage (Einwilligung liegt vor). Kontakt: ${p.buyerEmail ?? "—"}. Objekt: ${p.adresse ?? "—"}. Geschätztes Investitionsvolumen: ${investitionEur}. Maßnahmen: ${massnahmenListe}.`,
    templateId: "finance_lead_partner",
    relatedId: p.leadId,
  });
}

export interface BookingEmailContext {
  bookingId: number;
  scheduledAt: Date | string;
  serviceName: string;
  providerName: string;
  customerName: string | null;
  customerEmail: string | null;
  providerEmail: string | null;
  totalPrice: number;
  paymentRequired: boolean;
  notes?: string | null;
  durationMinutes?: number | null;
  location?: string | null;
  customerPhone?: string | null;
  providerTier?: string | null;
}

function customerConfirmationHtml(ctx: BookingEmailContext, paid: boolean): string {
  let confirmIntro: string;
  let amountLabel: string;
  let amountNote: string;
  if (paid) {
    confirmIntro = "Ihre Buchung wurde erfolgreich bezahlt und bestätigt. Hier sind alle Details:";
    amountLabel = "Bezahlter Betrag";
    amountNote = "Inkl. 19% USt — Ihre Rechnung erhalten Sie nach Leistungserbringung als PDF.";
  } else if (ctx.paymentRequired) {
    confirmIntro = "Ihre Buchung ist eingegangen und bestätigt. Hier sind alle Details:";
    amountLabel = "Betrag";
    amountNote = "Inkl. 19% USt — bitte begleichen Sie den Betrag bequem online in Ihrem Konto.";
  } else {
    confirmIntro = "Ihre Buchung ist bestätigt. Hier sind alle Details:";
    amountLabel = "Betrag";
    amountNote = "Die Abrechnung erfolgt direkt mit Ihrem Berater.";
  }
  return renderTemplate(tplBookingConfirmCustomer, {
    customerName: ctx.customerName ?? "Kunde",
    confirmIntro,
    serviceName: ctx.serviceName,
    providerName: ctx.providerName,
    providerEmail: ctx.providerEmail ?? "hello@klard.de",
    bookingDate: fmtDate(ctx.scheduledAt),
    bookingTime: fmtTime(ctx.scheduledAt),
    bookingDuration: fmtDuration(ctx.durationMinutes),
    bookingLocation: ctx.location || "Wird vom Berater mitgeteilt",
    bookingNumber: bookingNumber(ctx.bookingId),
    amountLabel,
    totalAmount: ctx.paymentRequired ? eur(ctx.totalPrice) : "Direktabrechnung",
    amountNote,
    bookingUrl: `${APP_URL}/bookings`,
    icsUrl: `${APP_URL}/bookings`,
  });
}

export async function sendBookingConfirmationToCustomer(
  ctx: BookingEmailContext,
  icsContent?: string,
): Promise<void> {
  if (!ctx.customerEmail) return;
  const html = customerConfirmationHtml(ctx, false);
  await send({
    to: ctx.customerEmail,
    subject: `Buchung bestätigt – ${ctx.providerName} am ${fmtDate(ctx.scheduledAt)}`,
    html,
    text: `Buchung bestätigt bei ${ctx.providerName} am ${fmtDateTime(ctx.scheduledAt)} (${ctx.serviceName}).`,
    attachments: icsContent
      ? [{ filename: "termin.ics", content: icsContent }]
      : undefined,
    templateId: "booking_confirmation_customer",
    relatedId: ctx.bookingId,
  });
}

export async function sendNewBookingToProvider(ctx: BookingEmailContext): Promise<void> {
  if (!ctx.providerEmail) return;
  const rate = commissionRate(ctx.providerTier);
  const commission = ctx.totalPrice * rate;
  const payout = ctx.totalPrice - commission;
  const providerIntro = ctx.paymentRequired
    ? "Sie haben eine neue Buchung erhalten. Der Termin ist verbindlich eingetragen."
    : "Sie haben eine neue Buchung erhalten. Die Abrechnung erfolgt direkt mit dem Kunden — der Termin ist verbindlich eingetragen.";
  const html = renderTemplate(tplBookingConfirmProvider, {
    providerName: ctx.providerName,
    providerIntro,
    customerName: ctx.customerName ?? "Kunde",
    customerEmail: ctx.customerEmail ?? "—",
    customerPhone: ctx.customerPhone || "—",
    serviceName: ctx.serviceName,
    bookingDate: fmtDate(ctx.scheduledAt),
    bookingTime: fmtTime(ctx.scheduledAt),
    bookingDuration: fmtDuration(ctx.durationMinutes),
    bookingNumber: bookingNumber(ctx.bookingId),
    totalAmount: eur(ctx.totalPrice),
    providerPayout: eur(payout),
    commissionRate: `${Math.round(rate * 100)} %`,
    commissionAmount: eur(commission),
    bookingUrl: `${APP_URL}/dashboard`,
  });
  await send({
    to: ctx.providerEmail,
    subject: `Neue Buchung – ${ctx.customerName ?? "Kunde"} am ${fmtDate(ctx.scheduledAt)}`,
    html,
    text: `Neue Buchung von ${ctx.customerName ?? "Kunde"} am ${fmtDateTime(ctx.scheduledAt)}.`,
    templateId: "booking_confirmation_provider",
    relatedId: ctx.bookingId,
  });
}

export async function sendBookingCancellation(
  ctx: BookingEmailContext,
  cancelledBy: "customer" | "provider",
): Promise<void> {
  const dateStr = fmtDate(ctx.scheduledAt);
  const refundInfo = ctx.paymentRequired
    ? "Falls bereits bezahlt wurde, wird der Betrag automatisch innerhalb von 5–10 Werktagen auf Ihre ursprüngliche Zahlungsmethode erstattet."
    : "Es wurde keine Online-Zahlung über Klard eingezogen — eine Erstattung ist nicht erforderlich.";

  if (cancelledBy === "customer") {
    const baseVars: Vars = {
      serviceName: ctx.serviceName,
      bookingDate: dateStr,
      bookingTime: fmtTime(ctx.scheduledAt),
      cancellationReason: "Auf Kundenwunsch storniert",
      cancelledAt: fmtDateTime(new Date()),
      bookingNumber: bookingNumber(ctx.bookingId),
      refundInfo,
    };
    const subject = `Buchung storniert – ${ctx.providerName} am ${dateStr}`;
    if (ctx.providerEmail) {
      await send({
        to: ctx.providerEmail,
        subject,
        html: renderTemplate(tplCancelledByCustomer, { ...baseVars, recipientName: ctx.providerName }),
        text: `Die Buchung (${ctx.serviceName}) am ${fmtDateTime(ctx.scheduledAt)} wurde vom Kunden storniert.`,
        templateId: "booking_cancelled_by_customer",
        relatedId: ctx.bookingId,
      });
    }
    if (ctx.customerEmail) {
      await send({
        to: ctx.customerEmail,
        subject,
        html: renderTemplate(tplCancelledByCustomer, {
          ...baseVars,
          recipientName: ctx.customerName ?? "Kunde",
        }),
        text: `Ihre Buchung (${ctx.serviceName}) am ${fmtDateTime(ctx.scheduledAt)} wurde storniert.`,
        templateId: "booking_cancelled_by_customer",
        relatedId: ctx.bookingId,
      });
    }
    return;
  }

  // Cancelled by provider — notify the customer with refund + alternatives.
  if (ctx.customerEmail) {
    await send({
      to: ctx.customerEmail,
      subject: `Termin abgesagt – ${ctx.providerName} am ${dateStr}`,
      html: renderTemplate(tplCancelledByProvider, {
        customerName: ctx.customerName ?? "Kunde",
        providerName: ctx.providerName,
        serviceName: ctx.serviceName,
        bookingDate: dateStr,
        bookingTime: fmtTime(ctx.scheduledAt),
        cancellationReason: "Vom Berater abgesagt",
        totalAmount: ctx.paymentRequired ? eur(ctx.totalPrice) : "Direktabrechnung",
        alternativeCount: "zahlreiche",
        branchName: "geprüfte",
        searchUrl: `${APP_URL}/search`,
      }),
      text: `Ihr Termin bei ${ctx.providerName} am ${fmtDateTime(ctx.scheduledAt)} wurde leider abgesagt.`,
      templateId: "booking_cancelled_by_provider",
      relatedId: ctx.bookingId,
    });
  }
}

export async function sendPaymentConfirmation(ctx: BookingEmailContext): Promise<void> {
  if (!ctx.customerEmail) return;
  const html = customerConfirmationHtml(ctx, true);
  await send({
    to: ctx.customerEmail,
    subject: `Zahlung bestätigt – ${ctx.providerName} am ${fmtDate(ctx.scheduledAt)}`,
    html,
    text: `Zahlung über ${eur(ctx.totalPrice)} erhalten — Buchung bei ${ctx.providerName} bestätigt.`,
    templateId: "booking_confirmation_customer",
    relatedId: ctx.bookingId,
  });
}

export async function sendProviderAssessmentSaved(p: {
  providerEmail: string;
  providerName: string;
  label: string;
  energyClass?: string | null;
  marketValue?: number | null;
  city?: string | null;
}): Promise<void> {
  if (!p.providerEmail) return;
  const safeLabel = p.label.replace(/[\r\n]+/g, " ").slice(0, 200);
  const html = legacyWrap(
    `Mandant gespeichert: ${safeLabel}`,
    `<p>Hallo ${p.providerName},</p>
     <p>Sie haben für den Mandanten <strong>${safeLabel}</strong> eine neue Gebäudeanalyse in Ihrem Klard-Dashboard gespeichert.</p>
     <table style="font-size:14px;line-height:1.6">
       ${p.city ? `<tr><td><strong>Standort:</strong></td><td>&nbsp;${p.city}</td></tr>` : ""}
       ${p.energyClass ? `<tr><td><strong>Energieklasse:</strong></td><td>&nbsp;${p.energyClass}</td></tr>` : ""}
       ${p.marketValue ? `<tr><td><strong>Marktwert (Schätzung):</strong></td><td>&nbsp;${Math.round(p.marketValue).toLocaleString("de-DE")} €</td></tr>` : ""}
     </table>
     <p>Sie können den Mandanten jederzeit im Dashboard erneut aufrufen oder mit einem Termin verknüpfen.</p>
     <p><a href="${APP_URL}/dashboard" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Zum Dashboard</a></p>`,
  );
  await send({
    to: p.providerEmail,
    subject: `Mandant gespeichert: ${safeLabel}`,
    html,
    text: `Gebäudeanalyse für ${safeLabel} gespeichert.`,
  });
}

export async function sendInvoiceWithAttachment(p: {
  to: string;
  customerName: string | null;
  providerName: string;
  invoiceNumber: string;
  kind: "invoice" | "storno";
  totalCents: number;
  pdfBase64: string;
  filename: string;
  serviceName?: string | null;
  providerEmail?: string | null;
  performanceDate?: Date | string | null;
}): Promise<void> {
  const totalEur = eur(p.totalCents / 100);
  const isStorno = p.kind === "storno";

  if (isStorno) {
    // No dedicated storno template was provided — keep the simple branded fallback.
    const html = legacyWrap(
      "Stornorechnung",
      `<p>Hallo${p.customerName ? ` ${p.customerName}` : ""},</p>
       <p>anbei erhalten Sie die <strong>Stornorechnung ${p.invoiceNumber}</strong> für Ihren stornierten Termin bei ${p.providerName}.</p>
       <p>Die Rechnung ist als PDF im Anhang dieser E-Mail.</p>
       <p><a href="${APP_URL}/bookings" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Meine Buchungen</a></p>`,
    );
    await send({
      to: p.to,
      subject: `Stornorechnung ${p.invoiceNumber} – ${p.providerName}`,
      html,
      text: `Stornorechnung ${p.invoiceNumber} – ${p.providerName}. Betrag: ${totalEur}.`,
      attachments: [{ filename: p.filename, content: p.pdfBase64, isBase64: true }],
      templateId: "invoice_storno",
      relatedId: p.invoiceNumber,
    });
    return;
  }

  const performance = p.performanceDate ? fmtDate(p.performanceDate) : "—";
  const html = renderTemplate(tplInvoiceReady, {
    customerName: p.customerName ?? "Kunde",
    providerName: p.providerName,
    providerEmail: p.providerEmail ?? "hello@klard.de",
    serviceName: p.serviceName ?? "Beratungsleistung",
    invoiceNumber: p.invoiceNumber,
    invoiceDate: fmtDate(new Date()),
    performanceStart: performance,
    performanceEnd: performance,
    totalAmount: totalEur,
    invoicePdfUrl: `${APP_URL}/bookings`,
  });
  await send({
    to: p.to,
    subject: `Ihre Rechnung ${p.invoiceNumber} – ${p.providerName}`,
    html,
    text: `Ihre Rechnung ${p.invoiceNumber} – ${p.providerName}. Betrag: ${totalEur}.`,
    attachments: [{ filename: p.filename, content: p.pdfBase64, isBase64: true }],
    templateId: "invoice_ready",
    relatedId: p.invoiceNumber,
  });
}

export async function sendBookingReminder(ctx: BookingEmailContext): Promise<void> {
  if (!ctx.customerEmail) return;
  const html = renderTemplate(tplReminder24h, {
    customerName: ctx.customerName ?? "Kunde",
    providerName: ctx.providerName,
    serviceName: ctx.serviceName,
    bookingDate: fmtDate(ctx.scheduledAt),
    bookingTime: fmtTime(ctx.scheduledAt),
    bookingDuration: fmtDuration(ctx.durationMinutes),
    bookingLocation: ctx.location || "Wird vom Berater mitgeteilt",
    prepNote1: "Halten Sie relevante Unterlagen für Ihr Gespräch bereit.",
    prepNote2: "Bei Verhinderung sagen Sie den Termin bitte rechtzeitig ab.",
    bookingUrl: `${APP_URL}/bookings`,
    cancelUrl: `${APP_URL}/bookings`,
  });
  await send({
    to: ctx.customerEmail,
    subject: `Erinnerung: Termin morgen bei ${ctx.providerName}`,
    html,
    text: `Erinnerung: Termin morgen um ${fmtDateTime(ctx.scheduledAt)} bei ${ctx.providerName}.`,
    templateId: "booking_reminder_24h",
    relatedId: ctx.bookingId,
  });
}

/**
 * 1-hour pre-appointment reminder. Sent to BOTH the customer and the provider
 * with role-aware "counterpart" fields. Deduped by the scheduler via email_log.
 */
export async function sendBookingReminder1h(ctx: BookingEmailContext): Promise<void> {
  const dateStr = fmtDate(ctx.scheduledAt);
  const timeStr = fmtTime(ctx.scheduledAt);
  const duration = fmtDuration(ctx.durationMinutes);
  const num = bookingNumber(ctx.bookingId);
  const location = ctx.location || "Wird vom Berater mitgeteilt";

  if (ctx.customerEmail) {
    await send({
      to: ctx.customerEmail,
      subject: `In 1 Stunde: Termin bei ${ctx.providerName}`,
      html: renderTemplate(tplReminder1h, {
        recipientName: ctx.customerName ?? "Kunde",
        serviceName: ctx.serviceName,
        bookingTime: timeStr,
        bookingDuration: duration,
        bookingLocation: location,
        bookingNumber: num,
        counterpartLabel: "Ihr Berater",
        counterpartName: ctx.providerName,
        counterpartEmail: ctx.providerEmail ?? "—",
        counterpartPhone: "—",
        bookingUrl: `${APP_URL}/bookings`,
      }),
      text: `In 1 Stunde: Termin bei ${ctx.providerName} um ${timeStr} (${dateStr}).`,
      templateId: "booking_reminder_1h",
      relatedId: ctx.bookingId,
    });
  }

  if (ctx.providerEmail) {
    await send({
      to: ctx.providerEmail,
      subject: `In 1 Stunde: Termin mit ${ctx.customerName ?? "Kunde"}`,
      html: renderTemplate(tplReminder1h, {
        recipientName: ctx.providerName,
        serviceName: ctx.serviceName,
        bookingTime: timeStr,
        bookingDuration: duration,
        bookingLocation: location,
        bookingNumber: num,
        counterpartLabel: "Ihr Kunde",
        counterpartName: ctx.customerName ?? "Kunde",
        counterpartEmail: ctx.customerEmail ?? "—",
        counterpartPhone: ctx.customerPhone || "—",
        bookingUrl: `${APP_URL}/dashboard`,
      }),
      text: `In 1 Stunde: Termin mit ${ctx.customerName ?? "Kunde"} um ${timeStr} (${dateStr}).`,
      templateId: "booking_reminder_1h",
      relatedId: ctx.bookingId,
    });
  }
}

/**
 * Notifies the customer that an online payment attempt for a booking failed,
 * with a link to retry.
 */
export async function sendPaymentFailed(p: {
  customerEmail: string | null;
  customerName: string | null;
  providerName: string;
  serviceName: string;
  scheduledAt: Date | string;
  totalPrice: number;
  bookingId: number;
  failureReason?: string | null;
}): Promise<void> {
  if (!p.customerEmail) return;
  const html = renderTemplate(tplPaymentFailed, {
    customerName: p.customerName ?? "Kunde",
    providerName: p.providerName,
    serviceName: p.serviceName,
    bookingDate: fmtDate(p.scheduledAt),
    bookingTime: fmtTime(p.scheduledAt),
    totalAmount: eur(p.totalPrice),
    failureReason: p.failureReason || "Die Zahlung konnte nicht abgeschlossen werden.",
    retryUrl: `${APP_URL}/bookings`,
  });
  await send({
    to: p.customerEmail,
    subject: `Zahlung fehlgeschlagen – ${p.providerName}`,
    html,
    text: `Ihre Zahlung für den Termin bei ${p.providerName} ist fehlgeschlagen. Bitte erneut versuchen: ${APP_URL}/bookings`,
    templateId: "payment_failed",
    relatedId: p.bookingId,
  });
}
