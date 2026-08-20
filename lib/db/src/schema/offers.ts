import { pgTable, serial, text, integer, real, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { providersTable } from "./providers";

export const offerAcceptancesTable = pgTable("offer_acceptances", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  providerId: integer("provider_id").references(() => providersTable.id, {
    onDelete: "set null",
  }),
  inquiry: text("inquiry"),
  offerText: text("offer_text"),
  itemsJson: jsonb("items_json").notNull(),
  totalNet: real("total_net").notNull(),
  totalGross: real("total_gross").notNull(),
  agbVersion: text("agb_version").notNull(),
  status: text("status").notNull().default("accepted"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertOfferAcceptanceSchema = createInsertSchema(offerAcceptancesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertOfferAcceptance = z.infer<typeof insertOfferAcceptanceSchema>;
export type OfferAcceptance = typeof offerAcceptancesTable.$inferSelect;
