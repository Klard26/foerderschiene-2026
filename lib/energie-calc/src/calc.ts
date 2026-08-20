import {
  ageBand, bautyp, BPI, EC, HT, INS, nwgBenchmark, nwgProfil, PEF,
  plzKlima, plzPreisIndex, WI,
} from "./constants";
import type {
  BuildingInput,
  EnergyResult,
  ESGResult,
  RenovationMassnahme,
  RenovationSzenario,
  RestnutzungResult,
  RiskResult,
  SanierungDetail,
  SolarResult,
  ValueResult,
  WertResult,
} from "./types";

const HEUTE = new Date().getFullYear();

/** Zuordnung Bauteil → U-Wert-Feld einer Baualtersklasse. */
const BAUTEIL_KEY = {
  fassade: "uAw",
  dach: "uDa",
  kellerdecke: "uKe",
  fenster: "uFe",
} as const;

type OpakBauteil = keyof typeof BAUTEIL_KEY;

/**
 * Verfeinert den effektiven U-Wert eines Bauteils anhand eines Sanierungsjahrs:
 * Eine Sanierung bringt das Bauteil mindestens auf den zum Sanierungszeitpunkt
 * gültigen Neubaustandard (Baualtersklasse des Sanierungsjahrs). Der U-Wert
 * verschlechtert sich nie — es gilt min(Bestand/Ziel, Sanierungs-Standard).
 * Ohne Jahr bleibt der Basiswert (Schnellpfad-Verhalten) unverändert.
 */
function refineBauteilU(baseU: number, bauteil: OpakBauteil, details?: SanierungDetail[]): number {
  const det = details?.find((x) => x.bauteil === bauteil);
  if (det?.jahr && det.jahr > 1900 && det.jahr <= HEUTE) {
    const sb = ageBand(det.jahr);
    return Math.min(baseU, sb[BAUTEIL_KEY[bauteil]]);
  }
  return baseU;
}

interface HuelleParams {
  area: number; av: number; geschossHoehe: number;
  shAw: number; shDa: number; shKe: number; shFe: number;
}

interface HuelleResult {
  HT_sum: number; V: number; A: number; A_FE: number;
  u_aw: number; u_fe: number; wiG: number;
}

/**
 * Geometrie + spezifischer Transmissionswärmeverlust H_T der thermischen Hülle.
 * Identisch für Wohn- und Nichtwohngebäude — nur die Geometrieparameter (A/V,
 * Geschosshöhe, Hüllflächenanteile) unterscheiden sich.
 */
function computeHuelle(d: BuildingInput, p: HuelleParams): HuelleResult {
  const ag  = ageBand(d.baujahr);
  const ins = INS.find((x) => x.id === d.daemmung) ?? INS[0]!;
  const wi  = WI.find((x) => x.id === d.fenster) ?? WI[1]!;

  const V    = p.area * p.geschossHoehe;
  const A    = p.av * V;
  const A_AW = A * p.shAw;
  const A_DA = A * p.shDa;
  const A_KE = A * p.shKe;
  const A_FE = A * p.shFe;

  const u_aw = refineBauteilU(Math.min(ag.uAw, ins.tAw), "fassade", d.sanierungDetails);
  const u_da = refineBauteilU(Math.min(ag.uDa, ins.tDa), "dach", d.sanierungDetails);
  const u_ke = refineBauteilU(Math.min(ag.uKe, ins.tKe), "kellerdecke", d.sanierungDetails);
  const u_fe = refineBauteilU(wi.u, "fenster", d.sanierungDetails);

  const Fx_KE = 0.6; // gegen Erdreich (DIN V 18599-2 Tab. 5)
  const dU_WB =
    d.zustand === "saniert"     ? 0.03 :
    d.zustand === "teilsaniert" ? 0.05 :
    d.zustand === "unsaniert"   ? 0.10 :
                                  0.05;

  const HT_sum =
      u_aw * A_AW
    + u_da * A_DA
    + u_ke * A_KE * Fx_KE
    + u_fe * A_FE
    + dU_WB * A;

  return { HT_sum, V, A, A_FE, u_aw, u_fe, wiG: wi.g };
}

/**
 * Endenergiebedarf eines Wohngebäudes nach vereinfachtem Tabellenverfahren.
 *
 * Methodik (orientiert an):
 *   - DIN V 18599-1/-2/-5/-6/-10 (Energetische Bewertung von Gebäuden)
 *   - GEG 2024 §§ 9, 19, 20, 86, Anlagen 1, 4, 5
 *   - IWU TABULA Gebäudetypologie Deutschland 2015 (Bauteil-U-Werte)
 *   - BMWK-Bekanntmachung 2021 (Datenaufnahme im Wohngebäudebestand)
 *
 * Ablauf:
 *   1) Hüllfläche A aus A/V-Verhältnis × beheiztem Volumen
 *   2) Komponenten-U-Werte aus Baualtersklasse + Dämm-Modernisierung
 *   3) Spezifischer Transmissionswärmeverlust H'T inkl. Wärmebrückenzuschlag
 *   4) Heizwärmebedarf q_h = (Q_T + Q_V − 0,95·(Q_S + Q_I)) / A_N
 *   5) Trinkwarmwasser q_w = 12,5 kWh/(m²·a) pauschal (DIN V 18599-10)
 *   6) Endenergie q_end = (q_h + q_w) / η bzw. / JAZ
 *   7) Primärenergie und CO2 mit GEG-2024-Faktoren
 *
 * Ergebnis ist eine fundierte Schnelleinschätzung — kein Energieausweis.
 */
export function calcEnergie(d: BuildingInput): EnergyResult {
  // Dispatch: Nichtwohngebäude folgen einem eigenen Nutzungsprofil-Verfahren.
  // Default (kein/leeres nutzung-Feld) = Wohngebäude → volle Rückwärtskompatibilität
  // für bereits gespeicherte Reports.
  if (d.nutzung === "nichtwohngebaeude") {
    return calcNichtwohngebaeude(d);
  }

  const h    = HT.find((x) => x.id === d.heizung) ?? HT[2]!;
  const cl   = plzKlima(d.plz);
  const bt   = bautyp(d.gebaeudetyp);

  // ── 1) Geometrie + Hülle ───────────────────────────────────────
  const A_N = d.wohnflaeche * 1.20;                              // GEG-Nutzfläche A_N
  const hu = computeHuelle(d, {
    area: d.wohnflaeche, av: bt.av, geschossHoehe: bt.geschossHoehe,
    shAw: bt.shAw, shDa: bt.shDa, shKe: bt.shKe, shFe: bt.shFe,
  });
  const { HT_sum, V, A, A_FE, u_aw, u_fe } = hu;
  const HT_strich = HT_sum / A;                                   // W/(m²·K) Hülle

  // ── 3) Wärmeverluste (kWh/a) ───────────────────────────────────
  const HGT_kKh = cl.hgt * 24 / 1000;                             // kKh/a
  const Q_T = HT_sum * HGT_kKh;                                   // Transmissionsverlust

  // Luftwechsel: Wärmerückgewinnung senkt den effektiven Lüftungsverlust,
  // eine reine Abluftanlage leicht (DIN V 18599-6, vereinfacht).
  const n_LW =
    d.lueftung === "wrg"    ? 0.30 :
    d.lueftung === "abluft" ? 0.45 :
                              0.5;                                 // Luftwechsel 1/h
  const Q_V = 0.34 * n_LW * V * HGT_kKh;                          // Lüftungsverlust

  // ── 4) Wärmegewinne ────────────────────────────────────────────
  // Solare Gewinne: 4 Orientierungen gemittelt, Fenster über alle Seiten
  const Q_S = A_FE * hu.wiG * cl.iSol * 0.567;                    // 0,567 = F_S·F_F·F_C
  const Q_I = A_N * 22;                                           // intern, DIN 18599-10

  // ── 5) Heizwärmebedarf mit monatlichem Ausnutzungsgrad η_g ─────
  // Nach DIN V 18599-2 / EN ISO 13790 (vereinfacht, Zeitkonstante a=1):
  //   γ = Gewinne/Verluste,   η_g = (1 − γ^a) / (1 − γ^(a+1))
  // → Verlustdominierte alte Häuser nutzen Gewinne schwächer (~0,75),
  //   gewinndominierte Niedrigenergiehäuser nutzen sie stärker (~0,95).
  const losses = Q_T + Q_V;
  const gains  = Q_S + Q_I;
  const gamma  = gains / Math.max(losses, 1);
  const eta_g  = Math.abs(gamma - 1) < 1e-6
    ? 1 / 2
    : (1 - Math.pow(gamma, 1)) / (1 - Math.pow(gamma, 2));
  const Q_h = Math.max(0, losses - eta_g * gains);                // kWh/a
  const q_h = Q_h / A_N;                                          // kWh/(m²·a)

  // ── 6) Trinkwarmwasser pauschal ────────────────────────────────
  const q_w = d.warmwasser === "solar" ? 9.0 : 12.5;             // kWh/(m²·a)

  // ── 7) Endenergie je Energieträger ─────────────────────────────
  const q_end_calc = h.isJaz
    ? (q_h + q_w) / Math.max(h.e, 0.5)
    : (q_h + q_w) / Math.max(h.e, 0.3);

  // Liegt ein gültiger Energieausweis mit Endenergiekennwert vor, ist dieser
  // belastbarer als das Tabellenverfahren und überschreibt die Schätzung.
  const hatKennwert =
    !!d.energieausweisVorhanden &&
    typeof d.energiekennwert === "number" &&
    d.energiekennwert > 0;
  const q_end = hatKennwert ? d.energiekennwert! : q_end_calc;

  const pef  = PEF[h.f] ?? PEF["erdgas"]!;
  const q_pe = q_end * pef.fp;
  const q_co2 = q_end * pef.co2;

  const endenergie    = Math.round(q_end);
  const primaerenergie = Math.round(q_pe);
  const co2Pro_m2     = Math.round(q_co2 * 10) / 10;
  const co2Tonnen     = Math.round((q_co2 * d.wohnflaeche) / 100) / 10;

  const klasse = EC.find((c) => endenergie <= c.m) ?? EC[EC.length - 1]!;

  // ── 8) Norm-Heizlast (DIN EN 12831, vereinfacht) ───────────────
  // Auslegungs-Wärmeverlust bei Norm-Außentemperatur — OHNE Abzug interner/
  // solarer Gewinne (die zählen nur in der Jahresbilanz, nicht im Auslegungsfall).
  const thetaInt = 20;
  const heizlast = calcHeizlast(HT_sum, n_LW, V, thetaInt, cl.tNorm, d.wohnflaeche);

  // ── 9) Pflichten nach GEG ──────────────────────────────────────
  const pflichten: string[] = [];
  if (klasse.c === "F" || klasse.c === "G" || klasse.c === "H") {
    pflichten.push(
      "GEG §§ 47–48: Pflicht zur Dämmung der obersten Geschossdecke und zur " +
      "Heizungserneuerung bei Eigentümerwechsel.",
    );
  }
  if ((h.id === "gas_kt" || h.id === "oel_kt") && d.heizungBaujahr && HEUTE - d.heizungBaujahr > 30) {
    pflichten.push("GEG § 72: Konstanttemperatur-Heizkessel älter 30 Jahre — Austauschpflicht.");
  }
  if (d.baujahr < 2002 && (d.heizungBaujahr ?? d.baujahr) < 1996) {
    pflichten.push("GEG § 71: Neue Heizungsanlagen müssen ab 2024 zu 65 % mit erneuerbarer Energie betrieben werden.");
  }
  if (klasse.c === "H") {
    pflichten.push("Energieklasse H: Sanierungsfahrplan dringend empfohlen — KfW-Förderung BEG WG/EM verfügbar.");
  }
  if (d.denkmalschutz) {
    pflichten.push("Denkmalschutz: Energetische Maßnahmen sind genehmigungspflichtig; eine Außendämmung ist meist unzulässig (Innendämmung prüfen). Befreiung von GEG-Anforderungen nach § 105 möglich.");
  }
  if (d.ensembleschutz) {
    pflichten.push("Ensemble-/Erhaltungssatzung: Änderungen an der Fassade bedürfen der Genehmigung der Denkmal- bzw. Bauaufsichtsbehörde.");
  }
  if (d.milieuschutz) {
    pflichten.push("Milieuschutz (soziale Erhaltungssatzung): Modernisierungen sind genehmigungspflichtig; über das Erforderliche hinausgehende Luxussanierungen können untersagt werden.");
  }
  if (hatKennwert) {
    pflichten.push(`Grundlage: Endenergiekennwert ${endenergie} kWh/(m²·a) aus vorhandenem ${d.energieausweisTyp === "verbrauch" ? "Verbrauchs" : "Bedarfs"}ausweis.`);
  }

  return {
    endenergie,
    primaerenergie,
    klasse,
    co2Pro_m2,
    co2Tonnen,
    qH: Math.round(q_h),
    htP: Math.round(HT_strich * 100) / 100,
    uW: Math.round(u_aw * 100) / 100,
    uWN: Math.round(u_fe * 100) / 100,
    pflichten,
    heizlastKw: heizlast.kw,
    heizlastWProM2: heizlast.wProM2,
    tNorm: cl.tNorm,
    thetaInt,
    flaeche: d.wohnflaeche,
    nutzung: "wohngebaeude",
  };
}

/**
 * Norm-Heizlast (vereinfacht nach DIN EN 12831): Auslegungs-Wärmeverlust bei
 * Norm-Außentemperatur. Φ = (H_T + H_V) · (θ_int − θ_e). Interne und solare
 * Gewinne werden im Auslegungsfall bewusst NICHT angerechnet.
 */
function calcHeizlast(
  HT_sum: number, n_LW: number, V: number, thetaInt: number, tNorm: number, area: number,
): { kw: number; wProM2: number } {
  const H_V = 0.34 * n_LW * V;            // W/K Lüftung
  const phiW = (HT_sum + H_V) * (thetaInt - tNorm); // W (gesamtes Gebäude)
  const A = Math.max(1, area);
  return { kw: Math.round((phiW / 1000) * 10) / 10, wProM2: Math.round(phiW / A) };
}

/**
 * Endenergiebedarf eines Nichtwohngebäudes (NWG) — vereinfachte Schnell­einschätzung
 * auf Basis der NWG-Standardnutzungsprofile (DIN V 18599-10). NWG werden NICHT mit
 * der Wohngebäude-Skala A+…H nach GEG § 86 bewertet; stattdessen liefert die Funktion
 * ein qualitatives Benchmark-Band. Ein GEG-konformer NWG-Energieausweis (Zonierung
 * nach DIN V 18599) ist nur durch einen zertifizierten Aussteller möglich.
 */
function calcNichtwohngebaeude(d: BuildingInput): EnergyResult {
  const h  = HT.find((x) => x.id === d.heizung) ?? HT[2]!;
  const cl = plzKlima(d.plz);
  const p  = nwgProfil(d.nwgKategorie);

  // Flächenbasis = Nettogrundfläche (NGF); Fallback auf wohnflaeche, falls NGF
  // nicht erfasst wurde (z. B. Schnellpfad mit repräsentativem Wert).
  const A_N = Math.max(1, d.nettoflaeche ?? d.wohnflaeche);

  const hu = computeHuelle(d, {
    area: A_N, av: p.av, geschossHoehe: p.geschossHoehe,
    shAw: p.shAw, shDa: p.shDa, shKe: p.shKe, shFe: p.shFe,
  });
  const { HT_sum, V, A, A_FE, u_aw, u_fe } = hu;
  const HT_strich = HT_sum / A;

  // ── Wärmeverluste ──────────────────────────────────────────────
  const HGT_kKh = cl.hgt * 24 / 1000;
  const Q_T = HT_sum * HGT_kKh;

  // Lüftung: hygienischer Mindestluftwechsel des Nutzungsprofils, durch eine
  // WRG-Anlage gemindert.
  const n_LW = d.lueftung === "wrg" ? p.nLuft * 0.55 : p.nLuft;
  const Q_V = 0.34 * n_LW * V * HGT_kKh;

  // Setpoint-Faktor: skaliert die HGT-basierten Verluste (Basis 20 °C) auf die
  // abweichende Raum-Solltemperatur des Profils; zusätzlich Minderung für den
  // reduzierten Betrieb (Nacht-/Wochenendabsenkung).
  const fSet = Math.min(1.4, Math.max(0.3, (p.thetaInt - cl.t) / (20 - cl.t)));
  const losses = (Q_T + Q_V) * fSet * p.betrieb;

  // ── Wärmegewinne ───────────────────────────────────────────────
  const Q_S = A_FE * hu.wiG * cl.iSol * 0.567;
  const Q_I = A_N * p.qIntern;
  const gains = Q_S + Q_I;

  const gamma = gains / Math.max(losses, 1);
  const eta_g = Math.abs(gamma - 1) < 1e-6
    ? 1 / 2
    : (1 - Math.pow(gamma, 1)) / (1 - Math.pow(gamma, 2));
  const Q_h = Math.max(0, losses - eta_g * gains);
  const q_h = Q_h / A_N;
  const q_w = p.qWarmwasser;

  const q_end_calc = h.isJaz
    ? (q_h + q_w) / Math.max(h.e, 0.5)
    : (q_h + q_w) / Math.max(h.e, 0.3);
  const hatKennwert =
    !!d.energieausweisVorhanden &&
    typeof d.energiekennwert === "number" &&
    d.energiekennwert > 0;
  const q_end = hatKennwert ? d.energiekennwert! : q_end_calc;

  const pef  = PEF[h.f] ?? PEF["erdgas"]!;
  const endenergie     = Math.round(q_end);
  const primaerenergie = Math.round(q_end * pef.fp);
  const q_co2          = q_end * pef.co2;
  const co2Pro_m2      = Math.round(q_co2 * 10) / 10;
  const co2Tonnen      = Math.round((q_co2 * A_N) / 100) / 10;

  // Wohngebäude-Klasse intern weiterhin bestimmt (Downstream-Kompatibilität),
  // im UI aber durch das NWG-Benchmark ersetzt.
  const klasse = EC.find((c) => endenergie <= c.m) ?? EC[EC.length - 1]!;
  const bench  = nwgBenchmark(endenergie);

  // ── Norm-Heizlast ──────────────────────────────────────────────
  const heizlast = calcHeizlast(HT_sum, n_LW, V, p.thetaInt, cl.tNorm, A_N);

  const pflichten: string[] = [];
  if (d.denkmalschutz) {
    pflichten.push("Denkmalschutz: Energetische Maßnahmen sind genehmigungspflichtig; eine Außendämmung ist meist unzulässig (Innendämmung prüfen). Befreiung von GEG-Anforderungen nach § 105 möglich.");
  }
  if (hatKennwert) {
    pflichten.push(`Grundlage: Endenergiekennwert ${endenergie} kWh/(m²·a) aus vorhandenem ${d.energieausweisTyp === "verbrauch" ? "Verbrauchs" : "Bedarfs"}ausweis.`);
  }

  const hinweise = [
    `Schnelleinschätzung für Nichtwohngebäude (Nutzungsprofil „${p.l}“). Nichtwohngebäude werden nicht nach der Wohngebäude-Skala A+ bis H (GEG § 86) bewertet.`,
    "Ein GEG-konformer Energieausweis für Nichtwohngebäude erfordert eine Zonierung nach DIN V 18599 durch einen zertifizierten Aussteller.",
  ];
  if (p.kuehlung || d.kuehlungVorhanden) {
    hinweise.push("Kühlung/Klimatisierung sowie Strombedarf für Beleuchtung und Lüftung sind in dieser Heizenergie-Schätzung nicht enthalten und können den Gesamt-Endenergiebedarf deutlich erhöhen.");
  }

  return {
    endenergie,
    primaerenergie,
    klasse,
    co2Pro_m2,
    co2Tonnen,
    qH: Math.round(q_h),
    htP: Math.round(HT_strich * 100) / 100,
    uW: Math.round(u_aw * 100) / 100,
    uWN: Math.round(u_fe * 100) / 100,
    pflichten,
    heizlastKw: heizlast.kw,
    heizlastWProM2: heizlast.wProM2,
    tNorm: cl.tNorm,
    thetaInt: p.thetaInt,
    flaeche: A_N,
    nutzung: "nichtwohngebaeude",
    nwgBenchmark: { stufe: bench.stufe, col: bench.col, hinweis: hinweise[0]! },
    hinweise,
  };
}

/**
 * Gebäudewert nach Sachwertverfahren (vereinfacht ImmoWertV §§ 35 ff.):
 *   Sachwert = Normalherstellungskosten 2010 (NHK) × Baupreisindex × Wohnfläche
 *              × Alterswertminderung nach Ross/Linear.
 *
 * NHK-Werte je Gebäudetyp aus NHK 2010 Tabelle (mittlerer Standard 3).
 */
export function calcWert(d: BuildingInput): WertResult {
  const nhkPerType: Record<string, number> = {
    efh: 1520, dhh: 1420, rh: 1350, mfh_s: 1280, mfh_m: 1220, mfh_l: 1180,
  };
  const nhk = nhkPerType[d.gebaeudetyp] ?? 1280;
  // Lineare Altersminderung: 0.8 % pro Jahr, min. 30 % Restwert
  const altersfaktor = Math.max(0.3, 1 - (HEUTE - d.baujahr) * 0.008);
  const sachwert2010 = nhk * d.wohnflaeche * altersfaktor;
  const sachwertAktuell = sachwert2010 * BPI;
  return {
    w1914:    Math.round(sachwert2010 / 12.782),                  // NHK-Faktor 2010 → 1914
    w2010:    Math.round(sachwert2010),
    wAktuell: Math.round(sachwertAktuell / 100) * 100,
    nhk,
    altersfaktor: Math.round(altersfaktor * 100) / 100,
  };
}

/**
 * Marktwert-Schätzung (Verkehrswert) als Plausibilitäts-Crosscheck zum
 * Sachwert. Basis: empirischer Quadratmeterpreis je Baualter × regionaler
 * Preisindex (Bundesschnitt = 1.0) × Energieklassen-Aufschlag.
 */
export function calcValue(d: BuildingInput, e: EnergyResult): ValueResult {
  const basis =
    d.baujahr >= 2020 ? 3400 :
    d.baujahr >= 2000 ? 2500 :
    d.baujahr >= 1980 ? 2000 :
    1500;
  const ci = EC.indexOf(e.klasse);
  const energieFaktor = 1.20 - ci * 0.055;                        // A+ +20 %, H −24 %
  const proQm = Math.round(basis * energieFaktor * plzPreisIndex(d.plz));
  return { total: Math.round(proQm * d.wohnflaeche), proQm };
}

/**
 * Restnutzungsdauer und steuerliche AfA-Optimierung
 * (BFH-Urteil IX R 25/19 vom 28.07.2021 + EStG § 7 Abs. 4 S. 2).
 */
export function calcRestnutzung(d: BuildingInput, e: EnergyResult, w: WertResult): RestnutzungResult {
  const gnd = ["efh", "dhh", "rh"].includes(d.gebaeudetyp) ? 80 : 60;
  const alter = HEUTE - d.baujahr;
  const rndRegulaer = Math.max(0, gnd - alter);
  const klasse = e.klasse.c;
  const zustandsFaktor =
    klasse === "H" || klasse === "G" ? 0.50 :
    klasse === "F" ? 0.65 :
    klasse === "E" ? 0.75 :
    klasse === "D" ? 0.85 :
    1.00;
  const rndWirtschaftlich = Math.max(5, Math.round(rndRegulaer * zustandsFaktor));
  const afaRegulaer  = d.baujahr < 1925 ? 2.5 : 2.0;              // EStG § 7 Abs. 4
  const afaVerkuerzt = rndWirtschaftlich > 0
    ? Math.round((100 / rndWirtschaftlich) * 100) / 100
    : 0;
  const bemessungsgrundlage = Math.round(w.wAktuell * 0.7);       // ohne Bodenwert
  const afaRegulaerJahr  = Math.round((bemessungsgrundlage * afaRegulaer)  / 100);
  const afaVerkuerztJahr = Math.round((bemessungsgrundlage * afaVerkuerzt) / 100);
  const mehrabschreibung = Math.max(0, afaVerkuerztJahr - afaRegulaerJahr);
  const steuerersparnis  = Math.round(mehrabschreibung * 0.42);   // ø Spitzensteuer
  return {
    alter, gnd, rndRegulaer, rndWirtschaftlich,
    afaRegulaer, afaVerkuerzt,
    afaRegulaerJahr, afaVerkuerztJahr,
    bemessungsgrundlage,
    gutachtenLohnt: afaVerkuerzt > afaRegulaer + 0.5,
    mehrabschreibung, steuerersparnis,
  };
}

/**
 * Klima- und Standortrisiko (qualitativ) basierend auf Klimazone (Sturm/Hitze)
 * und Baualter (Hochwasser-/Statik-Anfälligkeit).
 */
export function calcRisk(d: BuildingInput): RiskResult {
  const cl = plzKlima(d.plz);
  const sturm        = cl.t < 8.5 ? 3 : cl.t < 9.2 ? 2 : 1;
  const hitze        = cl.t > 9.5 ? 3 : cl.t > 8.8 ? 2 : 1;
  const baujahrRisiko = d.baujahr < 1960 ? 3 : d.baujahr < 1990 ? 2 : 1;
  const total = Math.round((sturm * 30 + hitze * 25 + baujahrRisiko * 25) / 3);
  const level: RiskResult["level"] =
    total <= 25 ? "Gering" : total <= 50 ? "Mittel" : "Erhöht";
  const color =
    total <= 25 ? "#4CAF50" :
    total <= 50 ? "#FFC107" :
                  "#FF9800";
  return { standortRisiko: sturm, hitzeRisiko: hitze, baujahrRisiko, total, level, color };
}

/**
 * ESG-Bewertung: CRREM-Pfad Wohngebäude DE 2024 = ca. 55 kWh/(m²·a) Endenergie.
 * EU-Taxonomie Kriterium Wohngebäude: Top-15 % Bestand ≈ ≤100 kWh/(m²·a).
 */
export function calcESG(e: EnergyResult): ESGResult {
  return {
    crrem:       e.endenergie <= 55  ? "On Track" : "Off Track",
    euTaxonomie: e.endenergie <= 100,
  };
}

/**
 * Photovoltaik-Potenzial: 60 % der Grundfläche als geeignetes Dach,
 * 7 m²/kWp Modulfläche, spezifischer Ertrag 950 kWh/(kWp·a) — D-Mittel.
 */
export function calcSolar(d: BuildingInput): SolarResult {
  const dachflaeche = (d.wohnflaeche / Math.max(d.geschosse, 1)) * 0.6;
  const kWp = Math.round(dachflaeche / 7);
  const kWhJahr = kWp * 950;
  return {
    potenzialQm: Math.round(dachflaeche),
    kWp,
    kWhJahr,
    ersparnisEur: Math.round(kWhJahr * 0.12),
  };
}

/**
 * Sanierungs-Szenarien für die nächsten Energieklassen-Sprünge mit
 * Maßnahmen-Mix, Kosten (BAFA Kostenrahmen 2024) und Endenergie-Einsparung.
 */
export function calcRenovation(d: BuildingInput, e: EnergyResult): RenovationSzenario[] {
  const aktKw = e.endenergie;
  const ziele = EC.filter((c) => c.m < aktKw).slice(0, 3);
  const done = new Set(d.sanierungen ?? []);
  const denkmal = !!d.denkmalschutz || !!d.ensembleschutz;
  return ziele.map((ziel) => {
    const massnahmen: RenovationMassnahme[] = [];
    let rest = aktKw - ziel.m;
    let kosten = 0;
    if (!done.has("fassade") && rest > 5 && e.uW > 0.24) {
      if (denkmal) {
        // Außendämmung am Denkmal i. d. R. unzulässig → Innendämmung: teurer, geringere Wirkung.
        const sv = Math.min(rest * 0.18, 32);
        const k  = d.wohnflaeche * 210;
        massnahmen.push({ name: "Innendämmung (denkmalgerecht, diffusionsoffen)", kosten: k, einsparung: sv });
        rest -= sv; kosten += k;
      } else {
        const sv = Math.min(rest * 0.30, 55);
        const k  = d.wohnflaeche * 165;
        massnahmen.push({ name: "Fassadendämmung (WDVS 16 cm)", kosten: k, einsparung: sv });
        rest -= sv; kosten += k;
      }
    }
    if (!done.has("fenster") && rest > 5 && e.uWN > 1.3) {
      const sv = Math.min(rest * 0.18, 28);
      const k  = d.wohnflaeche * 95;
      massnahmen.push({ name: "Fenstertausch (3-fach Wärmeschutz)", kosten: k, einsparung: sv });
      rest -= sv; kosten += k;
    }
    if (!done.has("heizung") && rest > 5 && (e.klasse.c === "G" || e.klasse.c === "H" || e.klasse.c === "F")) {
      const sv = Math.min(rest * 0.40, 50);
      const k  = d.wohnflaeche * 240;
      massnahmen.push({ name: "Heizungstausch auf Wärmepumpe (JAZ ≥ 3)", kosten: k, einsparung: sv });
      rest -= sv; kosten += k;
    }
    if (!done.has("dach") && rest > 5) {
      const k = d.wohnflaeche * 85;
      massnahmen.push({ name: "Dach-/Geschossdeckendämmung", kosten: k, einsparung: rest });
      kosten += k;
    }
    return {
      klasse: ziel.c,
      massnahmen,
      gesamtKosten: Math.round(kosten),
      restEinsparung: Math.max(0, Math.round(rest)),
    };
  });
}

export const _internals = { HEUTE };
