import { pgTable, text, serial, integer, boolean, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const categoriesTable = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  icon: text("icon").notNull().default("briefcase"),
  description: text("description"),
  color: text("color"),
  colorLight: text("color_light"),
  displayOrder: integer("display_order").notNull().default(0),
  providerCount: integer("provider_count").notNull().default(0),
  requiresDirectBilling: boolean("requires_direct_billing").notNull().default(false),
  qualifications: jsonb("qualifications"),
  // Klard-Klassifikation v3 hierarchy + metadata (nullable for back-compat).
  // `worldId` is denormalized convenience; `areaId` is the canonical link.
  worldId: text("world_id"),
  areaId: text("area_id"),
  // Profession code from the model (e.g. "ENB", "STB").
  professionCode: text("profession_code"),
  // Abrechnungsmodell: now (Sofortbuchung) | lead (Pay-per-Lead) | hybrid.
  pricingModel: text("pricing_model"),
  // Server-authoritative lead fee in integer cents for Pay-per-Lead categories.
  // Seeded per category (Alltag worlds use the area tier A/B/C = 600/1000/1500);
  // null for "pro" categories, which use the flat pro lead price in code.
  leadPriceCents: integer("lead_price_cents"),
  // Indicative price in EUR (nullable when "auf Anfrage"); numeric to allow
  // fractional unit prices such as 2.50 €/Stück (Bügelservice).
  indicativePrice: numeric("indicative_price", { mode: "number" }),
  // Unit the indicative price refers to (e.g. "objekt", "stunde", "lph").
  priceUnit: text("price_unit"),
  // Short comma-separated example services from the model.
  exampleServices: text("example_services"),
  // Required qualifications/listings (e.g. ["dena"], ["Kammer"]).
  requirements: text("requirements").array(),
});

export const insertCategorySchema = createInsertSchema(categoriesTable).omit({ id: true });
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categoriesTable.$inferSelect;
