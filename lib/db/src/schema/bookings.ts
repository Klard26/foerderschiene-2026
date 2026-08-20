import { pgTable, text, serial, integer, real, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { assessmentsTable } from "./assessments";

export const bookingsTable = pgTable("bookings", {
  id: serial("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  customerName: text("customer_name"),
  customerEmail: text("customer_email"),
  assessmentId: integer("assessment_id").references(() => assessmentsTable.id, { onDelete: "set null" }),
  providerId: integer("provider_id").notNull(),
  providerName: text("provider_name").notNull(),
  serviceId: integer("service_id").notNull(),
  serviceName: text("service_name").notNull(),
  slotId: integer("slot_id").notNull(),
  status: text("status").notNull().default("pending"),
  totalPrice: real("total_price").notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  notes: text("notes"),
  paymentRequired: boolean("payment_required").notNull().default(false),
  paymentStatus: text("payment_status").notNull().default("not_required"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  reminderSentAt: timestamp("reminder_sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({ id: true, createdAt: true });
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
