import { pgTable, text, integer, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Immobilienportfolio for COMMERCIAL Förderschiene customers (Hausverwaltung,
 * Bestandshalter, Makler, Handwerker, ...). One row per owned/managed building.
 * Scoped per-user (Clerk userId); every building attribute is optional except a
 * human-readable label so a portfolio can be built up incrementally.
 */
export const immobilienPortfolioObjekteTable = pgTable("immobilien_portfolio_objekte", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  bezeichnung: text("bezeichnung").notNull(),
  strasse: text("strasse"),
  hausnummer: text("hausnummer"),
  plz: text("plz"),
  ort: text("ort"),
  gebaeudetyp: text("gebaeudetyp"),
  baujahr: integer("baujahr"),
  wohnflaeche: integer("wohnflaeche"),
  wohneinheiten: integer("wohneinheiten"),
  heizung: text("heizung"),
  notiz: text("notiz"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertImmobilienPortfolioObjektSchema = createInsertSchema(
  immobilienPortfolioObjekteTable,
  {
    bezeichnung: z.string().min(1),
    baujahr: z.number().int().min(1800).max(2100).nullable().optional(),
    wohnflaeche: z.number().int().min(0).nullable().optional(),
    wohneinheiten: z.number().int().min(0).nullable().optional(),
  },
).omit({ id: true, userId: true, createdAt: true, updatedAt: true });
export type InsertImmobilienPortfolioObjekt = z.infer<
  typeof insertImmobilienPortfolioObjektSchema
>;
export type ImmobilienPortfolioObjekt = typeof immobilienPortfolioObjekteTable.$inferSelect;

/**
 * Verwaltete/betreute Kunden — the commercial customer's OWN clients (WEG,
 * Eigentümer, Mieter, Käufer/Interessenten, ...). Scoped per-user. May
 * optionally reference one of the same user's portfolio objects; that link is
 * always validated server-side to belong to the same user (never trusted from
 * the request body).
 */
export const verwalteteKundenTable = pgTable("verwaltete_kunden", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  typ: text("typ"),
  ansprechpartner: text("ansprechpartner"),
  telefon: text("telefon"),
  email: text("email"),
  notiz: text("notiz"),
  portfolioObjektId: integer("portfolio_objekt_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertVerwalteterKundeSchema = createInsertSchema(verwalteteKundenTable, {
  name: z.string().min(1),
  portfolioObjektId: z.number().int().nullable().optional(),
}).omit({ id: true, userId: true, createdAt: true, updatedAt: true });
export type InsertVerwalteterKunde = z.infer<typeof insertVerwalteterKundeSchema>;
export type VerwalteterKunde = typeof verwalteteKundenTable.$inferSelect;
