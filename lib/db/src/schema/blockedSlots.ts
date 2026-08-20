import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { providersTable } from "./providers";

export const blockedSlotsTable = pgTable(
  "blocked_slots",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providersTable.id, { onDelete: "cascade" }),
    startTime: timestamp("start_time").notNull(),
    endTime: timestamp("end_time").notNull(),
    source: text("source").notNull().default("ical"),
    externalUid: text("external_uid"),
    summary: text("summary"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    providerIdx: index("blocked_slots_provider_idx").on(t.providerId),
    providerTimeIdx: index("blocked_slots_provider_time_idx").on(
      t.providerId,
      t.startTime,
      t.endTime,
    ),
  }),
);

export const insertBlockedSlotSchema = createInsertSchema(blockedSlotsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertBlockedSlot = z.infer<typeof insertBlockedSlotSchema>;
export type BlockedSlot = typeof blockedSlotsTable.$inferSelect;
