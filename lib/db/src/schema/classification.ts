import { pgTable, text, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Klard Anbieter-Klassifikation v3 — a two-level hierarchy ABOVE the existing
 * flat `categories` (Berufsgruppen). Each category belongs to exactly one
 * `area` (Bereich), and each area to one `world` (Welt). The model is the
 * source of truth in scripts/data/klard-classification-v3.json; these tables
 * persist it so the API can serve the hierarchy and the frontends can group
 * the Branchen into Bereiche.
 *
 * `id` columns are the stable string ids from the model (e.g. world "pro",
 * area "pro_bau") — NOT serials — so categories can reference them directly and
 * the seed stays idempotent.
 */
export const worldsTable = pgTable("worlds", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  // Default Abrechnungsmodell for professions in this world: now | lead | hybrid.
  defaultPricingModel: text("default_pricing_model").notNull().default("now"),
  displayOrder: integer("display_order").notNull().default(0),
});

export const insertWorldSchema = createInsertSchema(worldsTable);
export type InsertWorld = z.infer<typeof insertWorldSchema>;
export type World = typeof worldsTable.$inferSelect;

export const areasTable = pgTable("areas", {
  id: text("id").primaryKey(),
  worldId: text("world_id").notNull(),
  // Short slug-ish code within the world (e.g. "bau", "fin").
  code: text("code").notNull(),
  // Two-digit ordering label within the world (e.g. "01").
  num: text("num"),
  name: text("name").notNull(),
  description: text("description"),
  displayOrder: integer("display_order").notNull().default(0),
});

export const insertAreaSchema = createInsertSchema(areasTable);
export type InsertArea = z.infer<typeof insertAreaSchema>;
export type Area = typeof areasTable.$inferSelect;
