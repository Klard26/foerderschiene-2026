import { db } from "@workspace/db";
import {
  invoicesTable,
  providersTable,
  bookingsTable,
  categoriesTable,
  type Invoice,
  type Provider,
  type Booking,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { renderInvoicePdf } from "./invoicePdf";
import { ObjectStorageService } from "./objectStorage";
import { ObjectAclPolicy, ObjectPermission, setObjectAclPolicy } from "./objectAcl";
import { randomUUID } from "crypto";
import { logger } from "./logger";

function formatInvoiceNumber(prefix: string | null, year: number, num: number): string {
  const safePrefix = (prefix ?? "RE").replace(/[^A-Za-z0-9-]/g, "").slice(0, 8) || "RE";
  return `${safePrefix}-${year}-${String(num).padStart(4, "0")}`;
}

function splitNetTax(grossCents: number, ratePct: number): { net: number; tax: number } {
  if (ratePct <= 0) return { net: grossCents, tax: 0 };
  const net = Math.round(grossCents / (1 + ratePct / 100));
  return { net, tax: grossCents - net };
}

async function uploadPdf(invoiceId: number, pdf: Buffer): Promise<string> {
  const svc = new ObjectStorageService();
  let dir = svc.getPrivateObjectDir();
  if (!dir.endsWith("/")) dir = `${dir}/`;
  const key = `invoices/${invoiceId}/${randomUUID()}.pdf`;
  const fullPath = `${dir}${key}`;
  // Parse bucket and object
  if (!fullPath.startsWith("/")) throw new Error("PRIVATE_OBJECT_DIR must start with /");
  const parts = fullPath.slice(1).split("/");
  const bucketName = parts[0];
  const objectName = parts.slice(1).join("/");
  const { objectStorageClient } = await import("./objectStorage");
  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectName);
  await file.save(pdf, { contentType: "application/pdf", resumable: false });
  await setObjectAclPolicy(file, {
    owner: "system",
    visibility: "private",
    aclRules: [],
  } as ObjectAclPolicy);
  return key;
}

export async function getInvoicePdfBuffer(invoice: Invoice): Promise<Buffer | null> {
  if (!invoice.pdfObjectKey) return null;
  const svc = new ObjectStorageService();
  let dir = svc.getPrivateObjectDir();
  if (!dir.endsWith("/")) dir = `${dir}/`;
  const fullPath = `${dir}${invoice.pdfObjectKey}`;
  if (!fullPath.startsWith("/")) return null;
  const parts = fullPath.slice(1).split("/");
  const bucketName = parts[0];
  const objectName = parts.slice(1).join("/");
  const { objectStorageClient } = await import("./objectStorage");
  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectName);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buf] = await file.download();
  return buf;
}

/**
 * Atomically reserves the next invoice number for a provider and returns
 * { number, year, prefix }. Uses a single UPDATE … RETURNING so two concurrent
 * webhook handlers can't grab the same number.
 */
async function reserveInvoiceNumber(providerId: number): Promise<{ invoiceNumber: string }> {
  const year = new Date().getFullYear();
  const [row] = await db
    .update(providersTable)
    .set({ nextInvoiceNumber: sql`${providersTable.nextInvoiceNumber} + 1` })
    .where(eq(providersTable.id, providerId))
    .returning({
      prefix: providersTable.invoicePrefix,
      next: providersTable.nextInvoiceNumber,
    });
  if (!row) throw new Error("Provider not found while reserving invoice number");
  // After increment, `next` holds the NEW value; the reserved one is `next - 1`.
  const reserved = row.next - 1;
  return { invoiceNumber: formatInvoiceNumber(row.prefix, year, reserved) };
}

/**
 * Issues an invoice for a paid booking. Idempotent: if an invoice already
 * exists for (bookingId, kind="invoice"), returns it without re-issuing.
 *
 * Returns `{ invoice, created }` where `created=false` means an idempotent
 * lookup hit — caller must NOT re-send notifications in that case.
 *
 * Skips and returns null when:
 *  - autoIssueInvoices=false on the provider
 *  - booking is in a direct-billing category (RVG/StBVV)
 *  - booking is not actually paid
 */
export async function issueInvoiceForBooking(opts: {
  bookingId: number;
  forceManual?: boolean;
}): Promise<{ invoice: Invoice; created: boolean } | null> {
  const { bookingId, forceManual } = opts;

  const [existing] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.bookingId, bookingId), eq(invoicesTable.kind, "invoice")))
    .limit(1);
  if (existing) return { invoice: existing, created: false };

  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, bookingId))
    .limit(1);
  if (!booking) return null;
  if (booking.paymentStatus !== "paid") return null;

  const [provider] = await db
    .select()
    .from(providersTable)
    .where(eq(providersTable.id, booking.providerId))
    .limit(1);
  if (!provider) return null;

  // Direct-billing categories (Anwalt/Steuerberater/Notar) — Klard never invoices these.
  const [category] = await db
    .select()
    .from(categoriesTable)
    .where(eq(categoriesTable.slug, provider.categorySlug))
    .limit(1);
  if (category?.requiresDirectBilling) return null;

  if (!forceManual && !provider.autoIssueInvoices) return null;

  const grossCents = Math.round(booking.totalPrice * 100);
  const parsedRate = provider.kleinunternehmer ? 0 : Number(provider.vatRate);
  const ratePct = Number.isFinite(parsedRate) && parsedRate >= 0 && parsedRate <= 100 ? parsedRate : 19;
  const { net, tax } = splitNetTax(grossCents, ratePct);

  const { invoiceNumber } = await reserveInvoiceNumber(provider.id);

  const providerSnapshot = {
    displayName: provider.displayName,
    companyLegalName: provider.companyLegalName,
    address: provider.address,
    zip: provider.zip,
    city: provider.city,
    email: provider.email,
    taxId: provider.taxId,
    iban: provider.iban,
    kleinunternehmer: provider.kleinunternehmer,
    vatRate: provider.vatRate,
  };

  const [created] = await db
    .insert(invoicesTable)
    .values({
      providerId: provider.id,
      bookingId: booking.id,
      invoiceNumber,
      kind: "invoice",
      netCents: net,
      taxRate: String(ratePct),
      taxCents: tax,
      totalCents: grossCents,
      currency: "EUR",
      customerName: booking.customerName,
      customerEmail: booking.customerEmail,
      customerAddress: null,
      providerSnapshot,
      serviceName: booking.serviceName,
      serviceDescription: null,
      serviceDate: booking.scheduledAt,
      pdfObjectKey: null,
      status: "issued",
    })
    .returning();

  if (!created) return null;

  // Render + upload PDF.
  try {
    const pdf = await renderInvoicePdf({ invoice: created, provider });
    const key = await uploadPdf(created.id, pdf);
    const [withPdf] = await db
      .update(invoicesTable)
      .set({ pdfObjectKey: key })
      .where(eq(invoicesTable.id, created.id))
      .returning();
    return { invoice: withPdf ?? created, created: true };
  } catch (err) {
    logger.error({ err, invoiceId: created.id }, "Failed to render/upload invoice PDF");
    return { invoice: created, created: true };
  }
}

/**
 * Issues a Stornorechnung for a booking's existing invoice. Idempotent —
 * returns the existing storno if one is already linked.
 */
export async function issueStornoForBooking(bookingId: number): Promise<Invoice | null> {
  const [original] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.bookingId, bookingId), eq(invoicesTable.kind, "invoice")))
    .limit(1);
  if (!original) return null;

  const [existingStorno] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.bookingId, bookingId), eq(invoicesTable.kind, "storno")))
    .limit(1);
  if (existingStorno) return existingStorno;

  const [provider] = await db
    .select()
    .from(providersTable)
    .where(eq(providersTable.id, original.providerId))
    .limit(1);
  if (!provider) return null;

  const { invoiceNumber } = await reserveInvoiceNumber(provider.id);

  const [created] = await db
    .insert(invoicesTable)
    .values({
      providerId: provider.id,
      bookingId,
      invoiceNumber,
      kind: "storno",
      originalInvoiceId: original.id,
      netCents: original.netCents,
      taxRate: original.taxRate,
      taxCents: original.taxCents,
      totalCents: original.totalCents,
      currency: original.currency,
      customerName: original.customerName,
      customerEmail: original.customerEmail,
      customerAddress: original.customerAddress,
      providerSnapshot: original.providerSnapshot,
      serviceName: original.serviceName,
      serviceDescription: original.serviceDescription,
      serviceDate: original.serviceDate,
      pdfObjectKey: null,
      status: "issued",
    })
    .returning();

  if (!created) return null;

  try {
    const pdf = await renderInvoicePdf({ invoice: created, provider });
    const key = await uploadPdf(created.id, pdf);
    const [withPdf] = await db
      .update(invoicesTable)
      .set({ pdfObjectKey: key })
      .where(eq(invoicesTable.id, created.id))
      .returning();
    return withPdf ?? created;
  } catch (err) {
    logger.error({ err, invoiceId: created.id }, "Failed to render/upload storno PDF");
    return created;
  }
}

/**
 * Sends the invoice PDF by email. Idempotent: only sends if `emailSentAt` is null
 * AND atomic CAS update succeeds, so concurrent webhook retries can never
 * double-send.
 */
export async function sendInvoiceEmail(opts: {
  invoice: Invoice;
  provider: Provider;
  booking: Booking;
}): Promise<void> {
  const { invoice, provider, booking } = opts;
  if (!booking.customerEmail) return;
  if (invoice.emailSentAt) return;

  // Atomic CAS: only proceed if emailSentAt was still null at this exact moment.
  const [claimed] = await db
    .update(invoicesTable)
    .set({ emailSentAt: new Date() })
    .where(and(eq(invoicesTable.id, invoice.id), sql`${invoicesTable.emailSentAt} IS NULL`))
    .returning();
  if (!claimed) return;

  const pdf = await getInvoicePdfBuffer(invoice);
  if (!pdf) {
    logger.warn({ invoiceId: invoice.id }, "Cannot send invoice email — PDF missing");
    // Roll back the claim so a later attempt (after PDF is rendered) can send.
    await db
      .update(invoicesTable)
      .set({ emailSentAt: null })
      .where(eq(invoicesTable.id, invoice.id));
    return;
  }
  try {
    const { sendInvoiceWithAttachment } = await import("./email");
    await sendInvoiceWithAttachment({
      to: booking.customerEmail,
      customerName: booking.customerName,
      providerName: provider.displayName,
      invoiceNumber: invoice.invoiceNumber,
      kind: invoice.kind === "storno" ? "storno" : "invoice",
      totalCents: invoice.totalCents,
      pdfBase64: pdf.toString("base64"),
      filename: `${invoice.invoiceNumber}.pdf`,
      serviceName: booking.serviceName,
      providerEmail: provider.email,
      performanceDate: booking.scheduledAt,
    });
  } catch (err) {
    logger.error({ err, invoiceId: invoice.id }, "Invoice email send failed");
    // Roll back so a retry path can succeed.
    await db
      .update(invoicesTable)
      .set({ emailSentAt: null })
      .where(eq(invoicesTable.id, invoice.id));
  }
}
