import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { providersTable, invoicesTable, bookingsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { UpdateMyInvoiceSettingsBody } from "@workspace/api-zod";
import {
  issueInvoiceForBooking,
  getInvoicePdfBuffer,
  sendInvoiceEmail,
} from "../lib/invoiceService";

const router: IRouter = Router();

type InvoiceRow = typeof invoicesTable.$inferSelect;

function serializeInvoice(inv: InvoiceRow) {
  return {
    id: inv.id,
    providerId: inv.providerId,
    bookingId: inv.bookingId,
    invoiceNumber: inv.invoiceNumber,
    kind: inv.kind,
    originalInvoiceId: inv.originalInvoiceId ?? null,
    issuedAt: inv.issuedAt.toISOString(),
    netCents: inv.netCents,
    taxRate: inv.taxRate,
    taxCents: inv.taxCents,
    totalCents: inv.totalCents,
    currency: inv.currency,
    customerName: inv.customerName,
    customerEmail: inv.customerEmail,
    customerAddress: inv.customerAddress,
    serviceName: inv.serviceName,
    serviceDescription: inv.serviceDescription,
    status: inv.status,
    hasPdf: !!inv.pdfObjectKey,
  };
}

function serializeSettings(p: typeof providersTable.$inferSelect) {
  return {
    kleinunternehmer: p.kleinunternehmer,
    vatRate: p.vatRate,
    invoicePrefix: p.invoicePrefix,
    nextInvoiceNumber: p.nextInvoiceNumber,
    iban: p.iban,
    invoiceFooter: p.invoiceFooter,
    autoIssueInvoices: p.autoIssueInvoices,
    companyLegalName: p.companyLegalName,
    taxId: p.taxId,
    address: p.address,
    zip: p.zip,
    city: p.city,
  };
}

router.get("/providers/me/invoice-settings", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [provider] = await db
    .select()
    .from(providersTable)
    .where(eq(providersTable.clerkUserId, userId))
    .limit(1);
  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }
  res.json(serializeSettings(provider));
});

router.patch("/providers/me/invoice-settings", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = UpdateMyInvoiceSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [provider] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.clerkUserId, userId))
      .limit(1);
    if (!provider) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    const d = parsed.data;
    const update: Partial<typeof providersTable.$inferInsert> = {};
    if (d.kleinunternehmer !== undefined) update.kleinunternehmer = d.kleinunternehmer;
    if (d.vatRate !== undefined) {
      if (!/^\d{1,2}(\.\d{1,2})?$/.test(d.vatRate)) {
        res.status(400).json({ error: "Ungültiger MwSt-Satz (z. B. '19' oder '7.00')" });
        return;
      }
      const n = Number(d.vatRate);
      if (!Number.isFinite(n) || n < 0 || n > 25) {
        res.status(400).json({ error: "MwSt-Satz muss zwischen 0 und 25 liegen." });
        return;
      }
      update.vatRate = d.vatRate;
    }
    if (d.invoicePrefix !== undefined) update.invoicePrefix = d.invoicePrefix;
    if (d.iban !== undefined) update.iban = d.iban;
    if (d.invoiceFooter !== undefined) update.invoiceFooter = d.invoiceFooter;
    if (d.autoIssueInvoices !== undefined) update.autoIssueInvoices = d.autoIssueInvoices;
    if (d.companyLegalName !== undefined) update.companyLegalName = d.companyLegalName;
    if (d.taxId !== undefined) update.taxId = d.taxId;
    if (d.address !== undefined) update.address = d.address;

    const [updated] = await db
      .update(providersTable)
      .set(update)
      .where(eq(providersTable.id, provider.id))
      .returning();
    if (!updated) {
      res.status(500).json({ error: "Update failed" });
      return;
    }
    res.json(serializeSettings(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to update invoice settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/invoices/me", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [provider] = await db
    .select()
    .from(providersTable)
    .where(eq(providersTable.clerkUserId, userId))
    .limit(1);
  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }
  const rows = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.providerId, provider.id))
    .orderBy(desc(invoicesTable.issuedAt));
  res.json(rows.map(serializeInvoice));
});

router.get("/invoices/customer", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Customer invoices = invoices for bookings where bookings.customerId == userId.
  const rows = await db
    .select({ inv: invoicesTable })
    .from(invoicesTable)
    .innerJoin(bookingsTable, eq(invoicesTable.bookingId, bookingsTable.id))
    .where(eq(bookingsTable.customerId, userId))
    .orderBy(desc(invoicesTable.issuedAt));
  res.json(rows.map((r) => serializeInvoice(r.inv)));
});

router.get("/invoices/:id/pdf", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [invoice] = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.id, id))
      .limit(1);
    if (!invoice) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Authorize: provider owner OR booking customer.
    const [provider] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.id, invoice.providerId))
      .limit(1);
    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, invoice.bookingId))
      .limit(1);
    const isProvider = provider?.clerkUserId === userId;
    const isCustomer = booking?.customerId === userId;
    if (!isProvider && !isCustomer) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const pdf = await getInvoicePdfBuffer(invoice);
    if (!pdf) {
      res.status(404).json({ error: "PDF nicht verfügbar" });
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${invoice.invoiceNumber}.pdf"`,
    );
    res.setHeader("Cache-Control", "private, no-cache");
    res.send(pdf);
  } catch (err) {
    req.log.error({ err }, "Failed to download invoice PDF");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/bookings/:id/invoice", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const bookingId = Number(req.params.id);
    if (!Number.isFinite(bookingId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId))
      .limit(1);
    if (!booking) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }
    // Authorize: provider owner OR booking customer.
    const [provider] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.id, booking.providerId))
      .limit(1);
    const isProvider = provider?.clerkUserId === userId;
    const isCustomer = booking.customerId === userId;
    if (!isProvider && !isCustomer) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (booking.paymentStatus !== "paid") {
      res.status(400).json({ error: "Buchung ist nicht bezahlt." });
      return;
    }
    const result = await issueInvoiceForBooking({ bookingId, forceManual: true });
    if (!result) {
      res.status(400).json({
        error:
          "Rechnung kann nicht ausgestellt werden (Direktabrechnung oder unbekannter Fehler).",
      });
      return;
    }
    // Only email on fresh issuance. sendInvoiceEmail is also internally idempotent.
    if (isProvider && provider && result.created) {
      void sendInvoiceEmail({ invoice: result.invoice, provider, booking }).catch((err) =>
        req.log.error({ err }, "Failed to send invoice email"),
      );
    }
    res.json(serializeInvoice(result.invoice));
  } catch (err) {
    req.log.error({ err }, "Failed to issue invoice for booking");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
