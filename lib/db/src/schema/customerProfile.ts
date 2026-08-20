import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Basic customer profile captured at registration. The postal address is
 * required (Pflichtfeld); the service interests and discovery source are
 * optional and used for later marketing analysis.
 */
export const customerProfileTable = pgTable("customer_profile", {
  userId: text("user_id").primaryKey(),
  strasse: text("strasse").notNull(),
  hausnummer: text("hausnummer").notNull(),
  plz: text("plz").notNull(),
  ort: text("ort").notNull(),
  // Up to 3 category slugs the customer is initially interested in (optional).
  interessen: jsonb("interessen").$type<string[]>().notNull().default([]),
  // How the customer discovered Klard (marketing attribution, optional).
  quelle: text("quelle"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCustomerProfileSchema = createInsertSchema(customerProfileTable, {
  strasse: z.string().min(1),
  hausnummer: z.string().min(1),
  plz: z.string().min(1),
  ort: z.string().min(1),
  interessen: z.array(z.string()).max(3).optional(),
  quelle: z.string().nullable().optional(),
}).omit({ userId: true, createdAt: true, updatedAt: true });
export type InsertCustomerProfile = z.infer<typeof insertCustomerProfileSchema>;
export type CustomerProfile = typeof customerProfileTable.$inferSelect;
