import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { providersTable } from "./providers";

/**
 * Conflicts surfaced when a provider's external iCal feed contains a busy
 * interval that overlaps an active (non-cancelled) Klard booking. The Klard
 * booking always wins: the overlapping interval is NOT imported into
 * `blocked_slots`, and instead recorded here so the provider can see that their
 * external calendar disagreed with a real Klard appointment and fix it on their
 * side.
 *
 * Full-refresh table: `reconcileProviderIcalBlocks` deletes all rows for the
 * provider and re-inserts the current conflicts on every sync, so a conflict
 * that the provider resolved (removed the external event or cancelled the
 * booking) automatically disappears.
 */
export const icalBookingConflictsTable = pgTable(
  "ical_booking_conflicts",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providersTable.id, { onDelete: "cascade" }),
    bookingId: integer("booking_id").notNull(),
    // Snapshot of the clashing Klard booking (denormalized for display so the
    // dashboard needs no join, and so it survives the booking being purged).
    bookingScheduledAt: timestamp("booking_scheduled_at").notNull(),
    bookingCustomerName: text("booking_customer_name"),
    bookingServiceName: text("booking_service_name"),
    // The overlapping external event from the imported feed.
    externalStart: timestamp("external_start").notNull(),
    externalEnd: timestamp("external_end").notNull(),
    externalUid: text("external_uid"),
    externalSummary: text("external_summary"),
    detectedAt: timestamp("detected_at").notNull().defaultNow(),
  },
  (t) => ({
    providerIdx: index("ical_booking_conflicts_provider_idx").on(t.providerId),
  }),
);

export const insertIcalBookingConflictSchema = createInsertSchema(
  icalBookingConflictsTable,
).omit({ id: true, detectedAt: true });
export type InsertIcalBookingConflict = z.infer<typeof insertIcalBookingConflictSchema>;
export type IcalBookingConflict = typeof icalBookingConflictsTable.$inferSelect;
