import type { EnergyClass, GebaeudeTyp, NwgKategorie } from "./types.ts";

/**
 * Primärenergiefaktoren (nicht erneuerbarer Anteil) und CO2-Emissionsfaktoren
 * pro kWh Endenergie. Quellen:
 *   - PEF: GEG 2024 Anlage 4
 *   - CO2: BAFA Heizspiegel 2024 / UBA-Emissionsbilanz 2024 / BEHG-Brennstoffe
 */
export const PEF: Record<string, { fp: number; co2: number; label: string }> = {
  erdgas:  { fp: 1.1, co2: 0.201, label: "Erdgas" },
  heizoel: { fp: 1.1, co2: 0.266, label: "Heizöl" },
  strom:   { fp: 1.8, co2: 0.434, label: "Strom (DE-Mix 2024)" },
  holz:    { fp: 0.2, co2: 0.027, label: "Holz/Pellets" },
  fw:      { fp: 0.7, co2: 0.180, label: "Fernwärme (KWK-Mix)" },
};

/**
 * Bauteil-U-Werte je Baualtersklasse (W/(m²·K)) für unsanierte Wohngebäude.
 * Quelle: IWU TABULA Gebäudetypologie Deutschland (2015), erweitert um
 * GEG 2024 Standardwerte. Felder:
 *   ym  = Maximum-Baujahr der Klasse (inklusiv)
 *   uAw = Außenwand
 *   uDa = Dach / oberste Geschossdecke
 *   uKe = Bodenplatte / Kellerdecke (gegen Erdreich)
 *   uFe = Standard-Fenster der Bauzeit (kann durch WI überschrieben werden)
 *   d   = Beschreibung der Klasse
 * Achtung: Felder uw/ur/uf/uwi sind Aliase für Rückwärtskompatibilität.
 */
export interface AgeBand {
  ym: number;
  uAw: number; uDa: number; uKe: number; uFe: number;
  uw: number; ur: number; uf: number; uwi: number;
  d: string;
}

function age(ym: number, uAw: number, uDa: number, uKe: number, uFe: number, d: string): AgeBand {
  return { ym, uAw, uDa, uKe, uFe, uw: uAw, ur: uDa, uf: uKe, uwi: uFe, d };
}

export const AGE: AgeBand[] = [
  age(1918, 1.70, 2.00, 1.20, 2.70, "Bauernhaus / Gründerzeit (≤1918)"),
  age(1948, 1.70, 1.40, 1.20, 2.70, "Zwischenkriegszeit (1919–1948)"),
  age(1957, 1.40, 1.40, 1.20, 2.70, "Wiederaufbau (1949–1957)"),
  age(1968, 1.20, 0.80, 1.00, 2.70, "Wirtschaftswunder (1958–1968)"),
  age(1978, 1.00, 0.60, 0.80, 2.70, "Vor 1. WSchV (1969–1978)"),
  age(1983, 0.80, 0.45, 0.60, 3.00, "1. WSchV 1977 (1979–1983)"),
  age(1994, 0.60, 0.40, 0.50, 2.80, "2. WSchV 1984 (1984–1994)"),
  age(2001, 0.40, 0.30, 0.40, 1.80, "WSchV 1995 (1995–2001)"),
  age(2009, 0.28, 0.22, 0.35, 1.40, "EnEV 2002/2007 (2002–2009)"),
  age(2015, 0.24, 0.20, 0.30, 1.30, "EnEV 2009/2014 (2010–2015)"),
  age(2023, 0.20, 0.18, 0.25, 1.10, "EnEV 2016 / GEG 2020 (2016–2023)"),
  age(2099, 0.18, 0.16, 0.25, 0.95, "GEG 2024 (ab 2024)"),
];

export interface Heizung {
  id: string;
  l: string;
  f: keyof typeof PEF;
  e: number;       // Erzeuger+Verteilung-Wirkungsgrad bzw. JAZ (für WP)
  ee: number;      // Anteil erneuerbar (%) — informativ
  isJaz?: boolean; // true: e ist Jahresarbeitszahl (Strom-WP)
  aus?: number;    // 1 = Austauschpflicht GEG §72 nach 30 J prüfen
}

/**
 * Heizungsarten mit anlagentechnischen Kenndaten für das vereinfachte
 * Endenergie-Verfahren. Wirkungsgrade aus DIN V 4701-10 / DIN V 18599-5,6
 * (Bestandsanlagen, mittlere Werte inkl. Erzeugung+Verteilung+Speicherung).
 */
export const HT: Heizung[] = [
  { id: "gas_kt",  l: "Gas-Konstanttemperatur (vor 1996)", f: "erdgas",  e: 0.78, ee: 0,   aus: 1 },
  { id: "gas_nt",  l: "Gas-Niedertemperatur",              f: "erdgas",  e: 0.85, ee: 0   },
  { id: "gas_bw",  l: "Gas-Brennwert",                     f: "erdgas",  e: 0.95, ee: 0   },
  { id: "oel_kt",  l: "Öl-Konstanttemperatur",             f: "heizoel", e: 0.75, ee: 0,   aus: 1 },
  { id: "oel_bw",  l: "Öl-Brennwert",                      f: "heizoel", e: 0.92, ee: 0   },
  { id: "wp_luft", l: "Wärmepumpe Luft/Wasser",            f: "strom",   e: 3.0,  ee: 75,  isJaz: true },
  { id: "wp_sole", l: "Wärmepumpe Sole/Wasser",            f: "strom",   e: 4.0,  ee: 80,  isJaz: true },
  { id: "pellet",  l: "Pellet-/Holzheizung",               f: "holz",    e: 0.85, ee: 100 },
  { id: "fw",      l: "Fernwärme",                         f: "fw",      e: 0.95, ee: 50  },
  { id: "elektro", l: "Nachtspeicherheizung (Strom)",      f: "strom",   e: 1.00, ee: 0   },
];

/**
 * Dämmstandard als Ziel-Niveau für die opaken Bauteile (AW/DA/KE).
 * Effektiver U-Wert = min(U_Baualtersklasse, U_Ziel) — eine Modernisierung
 * verbessert nie schlechter als der Bestand, und ein bereits modernes
 * Gebäude wird durch "KfW-55 Niveau" nicht weiter gedrückt.
 *   tAw / tDa / tKe = Ziel-U-Werte in W/(m²·K)
 *   f               = nur noch für UI-Sortierung (relativer Dämmgrad)
 */
export interface DaemmStufe {
  id: string; l: string; f: number;
  tAw: number; tDa: number; tKe: number;
}

export const INS: DaemmStufe[] = [
  { id: "none", l: "Keine Nachdämmung",             f: 1.00, tAw: 99,   tDa: 99,   tKe: 99   },
  { id: "w77",  l: "Teilsaniert (WSchV 77-Niveau)", f: 0.65, tAw: 0.80, tDa: 0.45, tKe: 0.60 },
  { id: "w95",  l: "Saniert (WSchV 95-Niveau)",     f: 0.45, tAw: 0.40, tDa: 0.30, tKe: 0.40 },
  { id: "enev", l: "EnEV-Standard",                 f: 0.30, tAw: 0.28, tDa: 0.22, tKe: 0.35 },
  { id: "kfw",  l: "KfW-55 Niveau",                 f: 0.22, tAw: 0.20, tDa: 0.18, tKe: 0.25 },
  { id: "pass", l: "Passivhaus / KfW-40",           f: 0.15, tAw: 0.15, tDa: 0.14, tKe: 0.20 },
];

export interface Fenster { id: string; l: string; u: number; g: number }

/**
 * Fenster-Kenndaten. Quelle: GEG 2024 Anlage 7 + BAFA-Standardwerte.
 *   u = U_w in W/(m²·K), g = solarer Energiedurchlass.
 */
export const WI: Fenster[] = [
  { id: "1f",   l: "Einfachverglasung",                  u: 5.0, g: 0.87 },
  { id: "2f_a", l: "2-fach-Isolierglas (vor 1995)",      u: 2.8, g: 0.76 },
  { id: "2f",   l: "2-fach-Wärmeschutz (ab 1995)",       u: 1.3, g: 0.63 },
  { id: "3f",   l: "3-fach-Wärmeschutz (Neubau)",        u: 0.7, g: 0.50 },
];

export interface Bautyp {
  id: GebaeudeTyp;
  l: string;
  /** Hüllfläche-zu-beheiztem-Volumen-Verhältnis nach IWU TABULA. */
  av: number;
  /** Anteile der Hüllfläche je Bauteil (Summe muss 1.0 ergeben, Fenster getrennt). */
  shAw: number; shDa: number; shKe: number; shFe: number;
  /** Geschosshöhe in m für Hochrechnung Volumen. */
  geschossHoehe: number;
}

/**
 * Hüllflächen-Geometrie je Gebäudetyp. Werte aus IWU TABULA (mittlere
 * Bestandsbauten Deutschland) — A/V-Verhältnis entscheidend für
 * Wärmeverluste pro m² Wohnfläche.
 */
export const BT: Bautyp[] = [
  { id: "efh",   l: "Einfamilienhaus",        av: 0.80, shAw: 0.40, shDa: 0.22, shKe: 0.22, shFe: 0.16, geschossHoehe: 2.7 },
  { id: "dhh",   l: "Doppelhaushälfte",       av: 0.70, shAw: 0.36, shDa: 0.22, shKe: 0.22, shFe: 0.20, geschossHoehe: 2.7 },
  { id: "rh",    l: "Reihenhaus",             av: 0.65, shAw: 0.30, shDa: 0.24, shKe: 0.24, shFe: 0.22, geschossHoehe: 2.7 },
  { id: "mfh_s", l: "MFH 3–6 Wohneinheiten",  av: 0.55, shAw: 0.45, shDa: 0.18, shKe: 0.18, shFe: 0.19, geschossHoehe: 2.6 },
  { id: "mfh_m", l: "MFH 7–12 Wohneinheiten", av: 0.45, shAw: 0.45, shDa: 0.16, shKe: 0.16, shFe: 0.23, geschossHoehe: 2.6 },
  { id: "mfh_l", l: "MFH > 12 Wohneinheiten", av: 0.35, shAw: 0.45, shDa: 0.14, shKe: 0.14, shFe: 0.27, geschossHoehe: 2.6 },
];

/**
 * Vereinfachte Nutzungsprofile für Nichtwohngebäude (NWG), angelehnt an die
 * Standardnutzungsprofile der DIN V 18599-10. Für eine belastbare
 * Schnelleinschätzung — der GEG-konforme NWG-Energieausweis (Zonierung nach
 * DIN V 18599) wird weiterhin durch einen zertifizierten Aussteller erstellt.
 *   thetaInt = Raum-Solltemperatur Heizfall [°C]
 *   qIntern  = interne Wärmequellen (Personen, Geräte, Beleuchtung) [kWh/(m²·a)]
 *   betrieb  = Minderungsfaktor für reduzierten Betrieb (Nacht-/Wochenendabsenkung)
 *   qWarmwasser = Trinkwarmwasser-Nutzenergie [kWh/(m²·a)]
 *   nLuft    = hygienischer Mindestluftwechsel [1/h]
 *   kuehlung = typischerweise gekühlt/klimatisiert
 *   av       = mittleres Hüllfläche/Volumen-Verhältnis
 *   geschossHoehe = lichte Geschosshöhe [m]
 *   shAw/shDa/shKe/shFe = Hüllflächenanteile (Summe der opaken + Fenster = 1.0)
 */
export interface NwgProfil {
  id: NwgKategorie;
  l: string;
  thetaInt: number;
  qIntern: number;
  betrieb: number;
  qWarmwasser: number;
  nLuft: number;
  kuehlung: boolean;
  av: number;
  geschossHoehe: number;
  shAw: number; shDa: number; shKe: number; shFe: number;
}

export const NWG_PROFILE: Record<NwgKategorie, NwgProfil> = {
  buero:      { id: "buero",      l: "Bürogebäude / Verwaltung",       thetaInt: 20, qIntern: 25, betrieb: 0.82, qWarmwasser: 3,  nLuft: 0.7, kuehlung: true,  av: 0.34, geschossHoehe: 3.2, shAw: 0.42, shDa: 0.16, shKe: 0.16, shFe: 0.26 },
  handel:     { id: "handel",     l: "Handel / Verkauf",              thetaInt: 19, qIntern: 30, betrieb: 0.88, qWarmwasser: 3,  nLuft: 0.9, kuehlung: true,  av: 0.38, geschossHoehe: 3.6, shAw: 0.45, shDa: 0.18, shKe: 0.18, shFe: 0.19 },
  schule:     { id: "schule",     l: "Schule / Bildung",              thetaInt: 20, qIntern: 15, betrieb: 0.78, qWarmwasser: 5,  nLuft: 0.9, kuehlung: false, av: 0.36, geschossHoehe: 3.3, shAw: 0.44, shDa: 0.18, shKe: 0.18, shFe: 0.20 },
  hotel:      { id: "hotel",      l: "Hotel / Beherbergung",          thetaInt: 21, qIntern: 18, betrieb: 0.92, qWarmwasser: 25, nLuft: 0.6, kuehlung: true,  av: 0.40, geschossHoehe: 2.9, shAw: 0.46, shDa: 0.16, shKe: 0.16, shFe: 0.22 },
  gesundheit: { id: "gesundheit", l: "Gesundheit / Pflege",           thetaInt: 22, qIntern: 20, betrieb: 0.95, qWarmwasser: 20, nLuft: 1.0, kuehlung: true,  av: 0.40, geschossHoehe: 3.1, shAw: 0.46, shDa: 0.16, shKe: 0.16, shFe: 0.22 },
  lager:      { id: "lager",      l: "Lager / Logistik (beheizt)",    thetaInt: 16, qIntern: 8,  betrieb: 0.70, qWarmwasser: 1,  nLuft: 0.4, kuehlung: false, av: 0.26, geschossHoehe: 5.0, shAw: 0.50, shDa: 0.22, shKe: 0.22, shFe: 0.06 },
  produktion: { id: "produktion", l: "Produktion / Gewerbe",          thetaInt: 18, qIntern: 22, betrieb: 0.80, qWarmwasser: 3,  nLuft: 0.8, kuehlung: false, av: 0.30, geschossHoehe: 4.5, shAw: 0.48, shDa: 0.20, shKe: 0.20, shFe: 0.12 },
  sonstiges:  { id: "sonstiges",  l: "Sonstiges Nichtwohngebäude",    thetaInt: 20, qIntern: 18, betrieb: 0.82, qWarmwasser: 5,  nLuft: 0.7, kuehlung: false, av: 0.35, geschossHoehe: 3.3, shAw: 0.44, shDa: 0.18, shKe: 0.18, shFe: 0.20 },
};

/** Reihenfolge + Labels der NWG-Kategorien für die UI. */
export const NWG_KATEGORIEN: { id: NwgKategorie; l: string }[] =
  (Object.keys(NWG_PROFILE) as NwgKategorie[]).map((id) => ({ id, l: NWG_PROFILE[id].l }));

export interface NwgBenchmarkBand { max: number; stufe: string; col: string }

/**
 * Qualitative Endenergie-Benchmarkbänder für Nichtwohngebäude [kWh/(m²·a)].
 * NWG werden NICHT mit der Wohngebäude-Skala A+…H bewertet (GEG § 86 gilt nur
 * für Wohngebäude); diese Bänder dienen einer groben Einordnung des Bestands.
 */
export const NWG_BENCHMARK: NwgBenchmarkBand[] = [
  { max: 80,   stufe: "Sehr effizient",      col: "#00843D" },
  { max: 130,  stufe: "Effizient",           col: "#8BC34A" },
  { max: 200,  stufe: "Durchschnittlich",    col: "#FFC107" },
  { max: 300,  stufe: "Hoher Verbrauch",     col: "#FF5722" },
  { max: 9999, stufe: "Sehr hoher Verbrauch", col: "#D32F2F" },
];

export function nwgProfil(id: NwgKategorie | undefined): NwgProfil {
  return (id && NWG_PROFILE[id]) || NWG_PROFILE.buero;
}

export function nwgBenchmark(endenergie: number): NwgBenchmarkBand {
  return NWG_BENCHMARK.find((b) => endenergie <= b.max) ?? NWG_BENCHMARK[NWG_BENCHMARK.length - 1]!;
}

/**
 * Energieeffizienzklassen Wohngebäude nach GEG § 86 (Endenergie kWh/(m²·a)).
 */
export const EC: EnergyClass[] = [
  { c: "A+", m: 30,   col: "#00843D" },
  { c: "A",  m: 50,   col: "#4CAF50" },
  { c: "B",  m: 75,   col: "#8BC34A" },
  { c: "C",  m: 100,  col: "#CDDC39" },
  { c: "D",  m: 130,  col: "#FFEB3B" },
  { c: "E",  m: 160,  col: "#FFC107" },
  { c: "F",  m: 200,  col: "#FF9800" },
  { c: "G",  m: 250,  col: "#FF5722" },
  { c: "H",  m: 9999, col: "#D32F2F" },
];

/**
 * Klimazonen Deutschland (vereinfacht aus DIN V 18599-10 Anhang A,
 * 19 → 10 Zonen aggregiert). hgt = Heizgradtage [Kd/a] (Basis 20/15 °C),
 * t = mittlere Außentemperatur Heizperiode [°C], iSol = mittlere
 * solare Einstrahlung Süd-Vertikal [kWh/(m²·a)].
 */
export interface KlimaZone {
  hgt: number; t: number; iSol: number; l: string;
  /** Norm-Außentemperatur θ_e [°C] nach DIN EN 12831 / DIN/TS 12831-1 (für Heizlast). */
  tNorm: number;
  /** Heiztage-Äquivalent (HGT/14, gerundet) für Legacy-UI-Anzeige. */
  d: number;
}

function zone(hgt: number, t: number, iSol: number, tNorm: number, l: string): KlimaZone {
  return { hgt, t, iSol, tNorm, l, d: Math.round(hgt / 14) };
}

export const CL: Record<number, KlimaZone> = {
  0: zone(3850, 7.8, 360, -12, "Mecklenburg-Vorpommern / Ostsee"),
  1: zone(3700, 8.2, 365, -14, "Berlin / Brandenburg"),
  2: zone(3500, 8.6, 355, -12, "Hamburg / Norddeutschland"),
  3: zone(3650, 8.4, 350, -14, "Sachsen-Anhalt / Mitteldeutschland"),
  4: zone(3400, 9.0, 340, -10, "Nordrhein-Westfalen"),
  5: zone(3200, 9.6, 360, -10, "Rhein-Main / Saarland"),
  6: zone(3100, 9.8, 365, -10, "Oberrheingraben / Pfalz"),
  7: zone(3500, 8.9, 370, -12, "Baden-Württemberg"),
  8: zone(3900, 7.9, 390, -16, "Bayern (Voralpen)"),
  9: zone(3700, 8.3, 380, -14, "Franken / Thüringen"),
};

export interface SspSzenario {
  id: string; l: string; t30: number; t50: number; t80: number; col: string;
}

export const SSP: SspSzenario[] = [
  { id: "ssp126", l: "SSP1-2.6 (Optimistisch)", t30: 1.2, t50: 1.5, t80: 1.6, col: "#4CAF50" },
  { id: "ssp245", l: "SSP2-4.5 (Moderat)",      t30: 1.3, t50: 1.8, t80: 2.4, col: "#FFC107" },
  { id: "ssp585", l: "SSP5-8.5 (Pessimistisch)", t30: 1.4, t50: 2.3, t80: 4.2, col: "#D32F2F" },
];

/** Energetischer Gesamtzustand des Gebäudes. */
export const ZUSTAND: { id: string; l: string }[] = [
  { id: "unsaniert",   l: "Unsaniert (weitgehend Originalzustand)" },
  { id: "teilsaniert", l: "Teilsaniert (einzelne Maßnahmen)" },
  { id: "saniert",     l: "Vollsaniert / energetisch modernisiert" },
];

/** Bereits durchgeführte energetische Sanierungsmaßnahmen. */
export const SANIERUNG_OPTIONS: { id: string; l: string }[] = [
  { id: "fassade",  l: "Fassade / Außenwand gedämmt" },
  { id: "dach",     l: "Dach / oberste Geschossdecke gedämmt" },
  { id: "keller",   l: "Kellerdecke / Bodenplatte gedämmt" },
  { id: "fenster",  l: "Fenster erneuert" },
  { id: "heizung",  l: "Heizung erneuert" },
  { id: "lueftung", l: "Lüftungsanlage eingebaut" },
  { id: "pv",       l: "Photovoltaik / Solarthermie installiert" },
];

/** Art der Warmwasserbereitung. */
export const WARMWASSER: { id: string; l: string }[] = [
  { id: "zentral",   l: "Zentral über die Heizung" },
  { id: "dezentral", l: "Dezentral (Durchlauferhitzer/Boiler)" },
  { id: "solar",     l: "Mit Solarthermie-Unterstützung" },
];

/** Lüftungskonzept. */
export const LUEFTUNG: { id: string; l: string }[] = [
  { id: "fenster", l: "Fensterlüftung (manuell)" },
  { id: "abluft",  l: "Abluftanlage" },
  { id: "wrg",     l: "Lüftung mit Wärmerückgewinnung" },
];

/** Art des Energieausweises. */
export const ENERGIEAUSWEIS_TYP: { id: string; l: string }[] = [
  { id: "bedarf",    l: "Bedarfsausweis" },
  { id: "verbrauch", l: "Verbrauchsausweis" },
];

export const BPI = 1.487; // Baupreisindex 2024 vs. NHK 2010

const PI: Record<number, number> = {
  10: 1.55, 20: 1.45, 30: 1.05, 40: 1.20, 50: 1.20, 60: 1.50, 70: 1.50, 80: 1.95, 90: 1.20,
};

export function plzPraefix(plz: string): number | null {
  if (!plz || plz.length < 2) return null;
  const n = Number.parseInt(plz.substring(0, 2), 10);
  return Number.isFinite(n) ? n : null;
}

export function plzPreisIndex(plz: string): number {
  const n = plzPraefix(plz);
  return n === null ? 1 : PI[Math.floor(n / 10) * 10] ?? 1;
}

export function plzKlima(plz: string): KlimaZone {
  const n = plzPraefix(plz);
  if (n === null) return CL[5]!;
  // Grobe Zuordnung PLZ-Erstbereich → Klimazone
  if (n >= 17 && n <= 19) return CL[0]!;
  if ((n >= 10 && n <= 16) || n === 39) return CL[1]!;
  if (n >= 20 && n <= 29) return CL[2]!;
  if (n >= 30 && n <= 38) return CL[3]!;
  if (n >= 40 && n <= 59) return CL[4]!;
  if (n >= 60 && n <= 67) return CL[5]!;
  if (n >= 76 && n <= 79) return CL[6]!;
  if ((n >= 68 && n <= 75) || (n >= 88 && n <= 89)) return CL[7]!;
  if ((n >= 80 && n <= 87) || (n >= 94 && n <= 96)) return CL[8]!;
  if (n >= 90 && n <= 99) return CL[9]!;
  return CL[5]!;
}

export function plzBundesland(plz: string): string {
  const n = plzPraefix(plz);
  if (n === null) return "";
  if (n >= 10 && n <= 12) return "Berlin";
  if (n >= 14 && n <= 16) return "Brandenburg";
  if (n >= 17 && n <= 19) return "Mecklenburg-Vorpommern";
  if (n >= 20 && n <= 21) return "Hamburg";
  if (n >= 22 && n <= 27) return "Schleswig-Holstein";
  if (n >= 28 && n <= 29) return "Niedersachsen";
  if (n >= 30 && n <= 38) return "Niedersachsen";
  if (n === 39) return "Sachsen-Anhalt";
  if (n >= 40 && n <= 59) return "Nordrhein-Westfalen";
  if (n >= 60 && n <= 65) return "Hessen";
  if (n >= 66 && n <= 67) return "Rheinland-Pfalz/Saarland";
  if (n >= 68 && n <= 79) return "Baden-Württemberg";
  if (n >= 80 && n <= 87) return "Bayern";
  if (n >= 88 && n <= 89) return "Baden-Württemberg";
  if (n >= 90 && n <= 96) return "Bayern";
  if (n === 97) return "Unterfranken";
  if (n >= 98 && n <= 99) return "Thüringen";
  return "";
}

export function ageBand(baujahr: number): AgeBand {
  return AGE.find((a) => baujahr <= a.ym) ?? AGE[AGE.length - 1]!;
}

export function bautyp(id: GebaeudeTyp): Bautyp {
  return BT.find((b) => b.id === id) ?? BT[0]!;
}
