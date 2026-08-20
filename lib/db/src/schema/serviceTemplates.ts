import { pgTable, text, serial, integer, real } from "drizzle-orm/pg-core";

export const serviceTemplatesTable = pgTable("service_templates", {
  id: serial("id").primaryKey(),
  categorySlug: text("category_slug").notNull(),
  groupName: text("group_name"),
  name: text("name").notNull(),
  description: text("description"),
  priceType: text("price_type"),
  referencePrice: text("reference_price"),
  durationLabel: text("duration_label"),
  defaultDurationMinutes: integer("default_duration_minutes").notNull().default(60),
  defaultPrice: real("default_price"),
  // v2 Leistungskatalog price recommendations (net EUR): market low/avg/high.
  priceMin: real("price_min"),
  priceAvg: real("price_avg"),
  priceMax: real("price_max"),
  // Billing unit (objekt, stunde, antrag, …) for the price recommendation.
  unit: text("unit"),
  // Inputs the provider needs to quote the service (e.g. wohnflaeche_qm).
  inputs: text("inputs").array(),
  // Förderfähigkeit note (BAFA/KfW), nullable.
  fundable: text("fundable"),
  // Extra guidance for the provider, nullable.
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export type ServiceTemplate = typeof serviceTemplatesTable.$inferSelect;
