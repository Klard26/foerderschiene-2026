export type GebaeudeTyp = "efh" | "dhh" | "rh" | "mfh_s" | "mfh_m" | "mfh_l";

export type Zustand = "unsaniert" | "teilsaniert" | "saniert";
export type EnergieausweisTyp = "bedarf" | "verbrauch";

/** Gebäudenutzung: Wohngebäude (WG) oder Nichtwohngebäude (NWG). */
export type Nutzung = "wohngebaeude" | "nichtwohngebaeude";

/** Nichtwohngebäude-Kategorie (vereinfachte Nutzungsprofile nach DIN V 18599-10). */
export type NwgKategorie =
  | "buero"
  | "handel"
  | "schule"
  | "hotel"
  | "gesundheit"
  | "lager"
  | "produktion"
  | "sonstiges";

/** Sanierbares Bauteil der thermischen Hülle bzw. Anlagentechnik. */
export type Bauteil = "fassade" | "dach" | "kellerdecke" | "fenster" | "heizung";

/** Pro Bauteil durchgeführte Sanierung mit Jahr — verfeinert den effektiven U-Wert. */
export interface SanierungDetail {
  bauteil: Bauteil;
  /** Sanierungsjahr — der zu diesem Zeitpunkt gültige Neubaustandard verbessert den U-Wert. */
  jahr?: number;
}

export interface BuildingInput {
  plz: string;
  city?: string;
  /** Straße (ohne Hausnummer) — optional, für Standortanalyse & Report. */
  strasse?: string;
  /** Hausnummer — optional. */
  hausnummer?: string;
  /** Geokoordinate Breitengrad (aus Adress-Autocomplete). */
  lat?: number;
  /** Geokoordinate Längengrad (aus Adress-Autocomplete). */
  lng?: number;
  baujahr: number;
  wohnflaeche: number;
  geschosse: number;
  wohneinheiten: number;
  gebaeudetyp: GebaeudeTyp;
  heizung: string;
  daemmung: string;
  fenster: string;
  heizungBaujahr?: number;

  /** Energetischer Gesamtzustand des Gebäudes. */
  zustand?: Zustand;
  /** Liegt ein gültiger Energieausweis vor? */
  energieausweisVorhanden?: boolean;
  /** Art des vorhandenen Energieausweises. */
  energieausweisTyp?: EnergieausweisTyp;
  /** Endenergiekennwert aus dem vorhandenen Ausweis (kWh/(m²·a)) — überschreibt die Schätzung. */
  energiekennwert?: number;
  /** Einzeldenkmal. */
  denkmalschutz?: boolean;
  /** Ensemble-/Erhaltungssatzung. */
  ensembleschutz?: boolean;
  /** Soziale Erhaltungssatzung (Milieuschutz). */
  milieuschutz?: boolean;
  /** Bereits durchgeführte energetische Maßnahmen (IDs aus SANIERUNG_OPTIONS). */
  sanierungen?: string[];
  /** Art der Warmwasserbereitung (IDs aus WARMWASSER). */
  warmwasser?: string;
  /** Lüftungskonzept (IDs aus LUEFTUNG). */
  lueftung?: string;
  /** Photovoltaik-/Solaranlage bereits vorhanden. */
  pvVorhanden?: boolean;

  /** Gebäudenutzung — steuert Wohn- vs. Nichtwohngebäude-Verfahren (default: wohngebaeude). */
  nutzung?: Nutzung;
  /** Nichtwohngebäude-Kategorie (nur relevant bei nutzung === "nichtwohngebaeude"). */
  nwgKategorie?: NwgKategorie;
  /** Nettogrundfläche (NGF) in m² — Flächenbasis für Nichtwohngebäude. */
  nettoflaeche?: number;
  /** Kühlung / Klimatisierung vorhanden (v. a. Nichtwohngebäude). */
  kuehlungVorhanden?: boolean;
  /** Pro Bauteil durchgeführte Sanierungen mit Jahr — verfeinern die effektiven U-Werte. */
  sanierungDetails?: SanierungDetail[];
}

export interface EnergyClass {
  c: string;
  m: number;
  col: string;
}

export interface NwgBenchmark {
  /** Bewertungsstufe, z. B. "Sehr effizient" … "Sehr hoher Verbrauch". */
  stufe: string;
  col: string;
  /** Erläuternder Hinweis zur Einordnung. */
  hinweis: string;
}

export interface EnergyResult {
  endenergie: number;
  primaerenergie: number;
  klasse: EnergyClass;
  co2Pro_m2: number;
  co2Tonnen: number;
  qH: number;
  htP: number;
  uW: number;
  uWN: number;
  pflichten: string[];

  /** Norm-Heizlast des gesamten Gebäudes in kW (vereinfacht nach DIN EN 12831). */
  heizlastKw: number;
  /** Spezifische Heizlast pro m² beheizter Fläche in W/m². */
  heizlastWProM2: number;
  /** Verwendete Norm-Außentemperatur in °C. */
  tNorm: number;
  /** Verwendete Innen-Solltemperatur (Heizfall) in °C. */
  thetaInt: number;
  /** Flächenbasis der Auswertung in m² (Wohnfläche bzw. Nettogrundfläche). */
  flaeche: number;
  /** Gebäudenutzung dieser Auswertung. */
  nutzung: Nutzung;
  /** Bei Nichtwohngebäuden: qualitatives Benchmark-Band statt Wohngebäude-Klasse. */
  nwgBenchmark?: NwgBenchmark;
  /** Methodische Hinweise zur Einschätzung (z. B. NWG-Schnelleinschätzung). */
  hinweise?: string[];
}

export interface WertResult {
  w1914: number;
  w2010: number;
  wAktuell: number;
  nhk: number;
  altersfaktor: number;
}

export interface ValueResult {
  total: number;
  proQm: number;
}

export interface RestnutzungResult {
  alter: number;
  gnd: number;
  rndRegulaer: number;
  rndWirtschaftlich: number;
  afaRegulaer: number;
  afaVerkuerzt: number;
  afaRegulaerJahr: number;
  afaVerkuerztJahr: number;
  bemessungsgrundlage: number;
  gutachtenLohnt: boolean;
  mehrabschreibung: number;
  steuerersparnis: number;
}

export interface RiskResult {
  standortRisiko: number;
  hitzeRisiko: number;
  baujahrRisiko: number;
  total: number;
  level: "Gering" | "Mittel" | "Erhöht";
  color: string;
}

export interface ESGResult {
  crrem: "On Track" | "Off Track";
  euTaxonomie: boolean;
}

export interface SolarResult {
  potenzialQm: number;
  kWp: number;
  kWhJahr: number;
  ersparnisEur: number;
}

export interface RenovationMassnahme {
  name: string;
  kosten: number;
  einsparung: number;
}

export interface RenovationSzenario {
  klasse: string;
  massnahmen: RenovationMassnahme[];
  gesamtKosten: number;
  restEinsparung: number;
}
