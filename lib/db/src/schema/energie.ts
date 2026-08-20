import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  real,
  date,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * enerwatt24 – Energiewechsel für die Wohnungswirtschaft.
 * Portfolio-Logik: Verwalter → Objekt → Zählpunkt → Vertrag.
 * Compliance-by-Design: Vollmacht granular, widerrufbar, auditierbar.
 */

// Verwalter (Energie-Portfolio-Konto, an einen Clerk-Nutzer gebunden)
export const verwalterTable = pgTable("verwalter", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  firma: text("firma").notNull(),
  typ: text("typ").notNull().default("hausverwaltung"),
  handelsregisterNr: text("handelsregister_nr"),
  ustId: text("ust_id"),
  erlaubnis34c: boolean("erlaubnis_34c").notNull().default(false),
  strasse: text("strasse"),
  plz: text("plz"),
  ort: text("ort"),
  email: text("email"),
  telefon: text("telefon"),
  provisionsmodell: text("provisionsmodell").notNull().default("saas_flat"),
  aktiv: boolean("aktiv").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Objekt (Gebäude / Liegenschaft)
export const objektTable = pgTable("objekt", {
  id: serial("id").primaryKey(),
  verwalterId: integer("verwalter_id")
    .notNull()
    .references(() => verwalterTable.id, { onDelete: "cascade" }),
  bezeichnung: text("bezeichnung").notNull(),
  strasse: text("strasse").notNull(),
  plz: text("plz").notNull(),
  ort: text("ort").notNull(),
  wegBeschluss: boolean("weg_beschluss").notNull().default(false),
  wegBeschlussDatum: date("weg_beschluss_datum"),
  notiz: text("notiz"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Zählpunkt (Marktlokation – MaLo-ID)
export const zaehlpunktTable = pgTable("zaehlpunkt", {
  id: serial("id").primaryKey(),
  objektId: integer("objekt_id")
    .notNull()
    .references(() => objektTable.id, { onDelete: "cascade" }),
  sparte: text("sparte").notNull(),
  art: text("art").notNull().default("allgemeinstrom"),
  maloId: text("malo_id"),
  zaehlernummer: text("zaehlernummer"),
  jahresverbrauchKwh: real("jahresverbrauch_kwh"),
  jahresverbrauchLiter: real("jahresverbrauch_liter"),
  netzbetreiber: text("netzbetreiber"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Vertrag (aktueller Liefervertrag je Zählpunkt)
export const vertragTable = pgTable("vertrag", {
  id: serial("id").primaryKey(),
  zaehlpunktId: integer("zaehlpunkt_id")
    .notNull()
    .references(() => zaehlpunktTable.id, { onDelete: "cascade" }),
  versorger: text("versorger").notNull(),
  tarifname: text("tarifname"),
  arbeitspreisCtKwh: real("arbeitspreis_ct_kwh"),
  grundpreisEurJahr: real("grundpreis_eur_jahr"),
  vertragsbeginn: date("vertragsbeginn"),
  erstlaufzeitEnde: date("erstlaufzeit_ende"),
  kuendigungsfristTage: integer("kuendigungsfrist_tage").notNull().default(30),
  naechsterKuendigungstermin: date("naechster_kuendigungstermin"),
  preisgarantieBis: date("preisgarantie_bis"),
  istAktiv: boolean("ist_aktiv").notNull().default(true),
  quelle: text("quelle").notNull().default("manuell"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Vollmacht (Compliance-Kern)
export const vollmachtTable = pgTable("vollmacht", {
  id: serial("id").primaryKey(),
  verwalterId: integer("verwalter_id")
    .notNull()
    .references(() => verwalterTable.id, { onDelete: "cascade" }),
  objektId: integer("objekt_id").references(() => objektTable.id, {
    onDelete: "cascade",
  }),
  sparte: text("sparte"),
  status: text("status").notNull().default("entwurf"),
  modus: text("modus").notNull().default("freigabe_erforderlich"),
  darfKuendigen: boolean("darf_kuendigen").notNull().default(true),
  darfAbschliessen: boolean("darf_abschliessen").notNull().default(true),
  darfSonderkuendigung: boolean("darf_sonderkuendigung")
    .notNull()
    .default(true),
  darfDatenAbfragen: boolean("darf_daten_abfragen").notNull().default(true),
  darfBankdatenWeitergeben: boolean("darf_bankdaten_weitergeben")
    .notNull()
    .default(true),
  widerspruchsfristTage: integer("widerspruchsfrist_tage").notNull().default(7),
  gueltigAb: date("gueltig_ab"),
  gueltigBis: date("gueltig_bis"),
  erteiltAm: timestamp("erteilt_am"),
  widerrufenAm: timestamp("widerrufen_am"),
  widerrufGrund: text("widerruf_grund"),
  dokumentPfad: text("dokument_pfad"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Wechselvorgang (Status-Maschine)
export const wechselvorgangTable = pgTable("wechselvorgang", {
  id: serial("id").primaryKey(),
  zaehlpunktId: integer("zaehlpunkt_id")
    .notNull()
    .references(() => zaehlpunktTable.id, { onDelete: "cascade" }),
  vollmachtId: integer("vollmacht_id")
    .notNull()
    .references(() => vollmachtTable.id, { onDelete: "cascade" }),
  altVertragId: integer("alt_vertrag_id").references(() => vertragTable.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("analyse"),
  empfVersorger: text("empf_versorger"),
  empfTarif: text("empf_tarif"),
  empfArbeitspreisCtKwh: real("empf_arbeitspreis_ct_kwh"),
  empfGrundpreisEurJahr: real("empf_grundpreis_eur_jahr"),
  ersparnisEurJahr: real("ersparnis_eur_jahr"),
  ersparnisProzent: real("ersparnis_prozent"),
  anzahlVerglicheneAnbieter: integer("anzahl_verglichene_anbieter"),
  kiBegruendung: text("ki_begruendung"),
  freigegebenAm: timestamp("freigegeben_am"),
  widerspruchBis: timestamp("widerspruch_bis"),
  neuVertragId: integer("neu_vertrag_id").references(() => vertragTable.id, {
    onDelete: "set null",
  }),
  abgeschlossenAm: timestamp("abgeschlossen_am"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Audit-Log (jede Aktion unter Vollmacht – revisionssicher)
export const auditLogTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  verwalterId: integer("verwalter_id").references(() => verwalterTable.id, {
    onDelete: "cascade",
  }),
  vollmachtId: integer("vollmacht_id"),
  wechselId: integer("wechsel_id"),
  akteur: text("akteur").notNull(),
  aktion: text("aktion").notNull(),
  details: jsonb("details"),
  zeitpunkt: timestamp("zeitpunkt").notNull().defaultNow(),
});

// Tarif-Feed (Cache der Marktangebote)
export const tarifAngebotTable = pgTable("tarif_angebot", {
  id: serial("id").primaryKey(),
  sparte: text("sparte").notNull(),
  versorger: text("versorger").notNull(),
  tarifname: text("tarifname").notNull(),
  arbeitspreisCtKwh: real("arbeitspreis_ct_kwh").notNull(),
  grundpreisEurJahr: real("grundpreis_eur_jahr").notNull(),
  laufzeitMonate: integer("laufzeit_monate"),
  preisgarantieMonate: integer("preisgarantie_monate"),
  oekostrom: boolean("oekostrom").notNull().default(false),
  minVerbrauchKwh: real("min_verbrauch_kwh"),
  maxVerbrauchKwh: real("max_verbrauch_kwh"),
  plzGebiet: text("plz_gebiet"),
  gueltigAb: date("gueltig_ab"),
  gueltigBis: date("gueltig_bis"),
  quelle: text("quelle"),
  abgerufenAm: timestamp("abgerufen_am").notNull().defaultNow(),
});

export const insertVerwalterSchema = createInsertSchema(verwalterTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertObjektSchema = createInsertSchema(objektTable).omit({
  id: true,
  createdAt: true,
});
export const insertZaehlpunktSchema = createInsertSchema(zaehlpunktTable).omit({
  id: true,
  createdAt: true,
});
export const insertVertragSchema = createInsertSchema(vertragTable).omit({
  id: true,
  createdAt: true,
});
export const insertVollmachtSchema = createInsertSchema(vollmachtTable).omit({
  id: true,
  createdAt: true,
});

export type Verwalter = typeof verwalterTable.$inferSelect;
export type InsertVerwalter = z.infer<typeof insertVerwalterSchema>;
export type Objekt = typeof objektTable.$inferSelect;
export type Zaehlpunkt = typeof zaehlpunktTable.$inferSelect;
export type Vertrag = typeof vertragTable.$inferSelect;
export type Vollmacht = typeof vollmachtTable.$inferSelect;
export type Wechselvorgang = typeof wechselvorgangTable.$inferSelect;
export type AuditLog = typeof auditLogTable.$inferSelect;
export type TarifAngebotRow = typeof tarifAngebotTable.$inferSelect;
