import { pgTable, text, serial, integer, timestamp, jsonb, numeric, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { providersTable } from "./providers";
import { bookingsTable } from "./bookings";

export const invoicesTable = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providersTable.id, { onDelete: "cascade" }),
    bookingId: integer("booking_id")
      .notNull()
      .references(() => bookingsTable.id, { onDelete: "cascade" }),
    invoiceNumber: text("invoice_number").notNull(),
    kind: text("kind").notNull().default("invoice"),
    originalInvoiceId: integer("original_invoice_id"),
    issuedAt: timestamp("issued_at").notNull().defaultNow(),
    netCents: integer("net_cents").notNull(),
    taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull(),
    taxCents: integer("tax_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull().default("EUR"),
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    customerAddress: text("customer_address"),
    providerSnapshot: jsonb("provider_snapshot").notNull(),
    serviceName: text("service_name").notNull(),
    serviceDescription: text("service_description"),
    serviceDate: timestamp("service_date"),
    pdfObjectKey: text("pdf_object_key"),
    status: text("status").notNull().default("issued"),
    emailSentAt: timestamp("email_sent_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    providerNumberIdx: uniqueIndex("invoices_provider_number_idx").on(t.providerId, t.invoiceNumber),
    bookingKindIdx: uniqueIndex("invoices_booking_kind_idx").on(t.bookingId, t.kind),
  }),
);

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
