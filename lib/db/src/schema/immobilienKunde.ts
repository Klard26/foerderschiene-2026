import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Optional Immobilien-Kundenprofil for Klard users who are Hausverwalter or
 * Bestandshalter. Used to tailor the Gebäudecheck experience for portfolio
 * owners. All portfolio metrics are optional.
 */
export const immobilienKundeTable = pgTable("immobilien_kunde", {
  userId: text("user_id").primaryKey(),
  typ: text("typ").notNull(), // "privat" | "hausverwaltung" | "makler" | "bestandshalter" | "bautraeger" | "genossenschaft" | "handwerker" | "gewerbe"
  firma: text("firma").notNull(),
  ansprechpartner: text("ansprechpartner"),
  telefon: text("telefon"),
  email: text("email"),
  anzahlGebaeude: integer("anzahl_gebaeude"),
  wohneinheitenGesamt: integer("wohneinheiten_gesamt"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertImmobilienKundeSchema = createInsertSchema(immobilienKundeTable, {
  typ: z.enum(["privat", "hausverwaltung", "makler", "bestandshalter", "bautraeger", "genossenschaft", "handwerker", "gewerbe"]),
  firma: z.string().min(1),
  anzahlGebaeude: z.number().int().min(0).nullable().optional(),
  wohneinheitenGesamt: z.number().int().min(0).nullable().optional(),
}).omit({ userId: true, createdAt: true, updatedAt: true });
export type InsertImmobilienKunde = z.infer<typeof insertImmobilienKundeSchema>;
export type ImmobilienKunde = typeof immobilienKundeTable.$inferSelect;
