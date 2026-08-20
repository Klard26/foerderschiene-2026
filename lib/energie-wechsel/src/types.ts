/**
 * enerwatt24 – gemeinsame Typen für Energiewechsel-Logik.
 * Compliance-kritische Status & Modi an einer Stelle definiert.
 */

export type Sparte = "strom" | "gas" | "heizoel" | "fernwaerme";

export type VerwalterTyp =
  | "hausverwaltung"
  | "weg_verwalter"
  | "bestandshalter"
  | "gewerbe";

export type ZaehlerArt =
  | "allgemeinstrom"
  | "mieterstrom"
  | "gewerbe"
  | "heizung"
  | "waermepumpe"
  | "sonstige";

export type Provisionsmodell = "saas_flat" | "erfolgsprovision" | "hybrid";

export type VollmachtStatus =
  | "entwurf"
  | "aktiv"
  | "pausiert"
  | "widerrufen"
  | "abgelaufen";

export type VollmachtModus =
  | "nur_vorschlag" // nur Empfehlung, kein Wechsel
  | "freigabe_erforderlich" // Wechsel nach aktiver Zustimmung
  | "vollautomatisch"; // Wechsel nach Ablauf Widerspruchsfrist

export type WechselStatus =
  | "analyse"
  | "empfehlung"
  | "wartet_freigabe"
  | "freigegeben"
  | "kuendigung_alt"
  | "anmeldung_neu"
  | "aktiv"
  | "abgelehnt"
  | "fehlgeschlagen"
  | "widersprochen";

export const SPARTEN: readonly Sparte[] = [
  "strom",
  "gas",
  "heizoel",
  "fernwaerme",
] as const;

export const VERWALTER_TYPEN: readonly VerwalterTyp[] = [
  "hausverwaltung",
  "weg_verwalter",
  "bestandshalter",
  "gewerbe",
] as const;

export const ZAEHLER_ARTEN: readonly ZaehlerArt[] = [
  "allgemeinstrom",
  "mieterstrom",
  "gewerbe",
  "heizung",
  "waermepumpe",
  "sonstige",
] as const;

export const SPARTE_LABELS: Record<Sparte, string> = {
  strom: "Strom",
  gas: "Gas",
  heizoel: "Heizöl",
  fernwaerme: "Fernwärme",
};

export const VERWALTER_TYP_LABELS: Record<VerwalterTyp, string> = {
  hausverwaltung: "Hausverwaltung",
  weg_verwalter: "WEG-Verwaltung",
  bestandshalter: "Bestandshalter",
  gewerbe: "Gewerbe",
};

export const ZAEHLER_ART_LABELS: Record<ZaehlerArt, string> = {
  allgemeinstrom: "Allgemeinstrom",
  mieterstrom: "Mieterstrom",
  gewerbe: "Gewerbe",
  heizung: "Heizung",
  waermepumpe: "Wärmepumpe",
  sonstige: "Sonstige",
};

export const VOLLMACHT_MODUS_LABELS: Record<VollmachtModus, string> = {
  nur_vorschlag: "Nur Vorschläge",
  freigabe_erforderlich: "Freigabe erforderlich",
  vollautomatisch: "Vollautomatisch",
};

export const VOLLMACHT_STATUS_LABELS: Record<VollmachtStatus, string> = {
  entwurf: "Entwurf",
  aktiv: "Aktiv",
  pausiert: "Pausiert",
  widerrufen: "Widerrufen",
  abgelaufen: "Abgelaufen",
};

export const WECHSEL_STATUS_LABELS: Record<WechselStatus, string> = {
  analyse: "Analyse",
  empfehlung: "Empfehlung",
  wartet_freigabe: "Wartet auf Freigabe",
  freigegeben: "Freigegeben",
  kuendigung_alt: "Altvertrag wird gekündigt",
  anmeldung_neu: "Neuvertrag wird angemeldet",
  aktiv: "Abgeschlossen",
  abgelehnt: "Abgelehnt",
  fehlgeschlagen: "Fehlgeschlagen",
  widersprochen: "Widersprochen",
};

export const PROVISIONSMODELL_LABELS: Record<Provisionsmodell, string> = {
  saas_flat: "SaaS-Grundgebühr",
  erfolgsprovision: "Erfolgsprovision",
  hybrid: "Hybrid (SaaS + Erfolg)",
};
