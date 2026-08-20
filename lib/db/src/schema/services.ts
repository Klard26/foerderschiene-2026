import { pgTable, text, serial, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const servicesTable = pgTable("services", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  // `price` is the gross (Brutto) price in EUR — kept as the canonical billing
  // amount for backwards compatibility with existing bookings.
  price: real("price").notNull(),
  netPrice: real("net_price"),
  vatRate: real("vat_rate").notNull().default(19),
  durationMinutes: integer("duration_minutes").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertServiceSchema = createInsertSchema(servicesTable).omit({ id: true, createdAt: true });
export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof servicesTable.$inferSelect;
