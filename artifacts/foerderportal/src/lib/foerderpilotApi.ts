/**
 * Lightweight client for the Förderpilot funding catalog endpoints.
 *
 * These live on the shared backend under `/api/foerderpilot/...` and are NOT
 * part of the Orval-generated OpenAPI contract (the imported catalog uses its
 * own isolated schema), so we call them with plain root-relative `fetch` via
 * the shared proxy — a documented deviation from the codegen workflow.
 */

export type Ebene = "bund" | "land" | "eu" | "kommune";
export type Art =
  | "zuschuss"
  | "kredit"
  | "buergschaft"
  | "beteiligung"
  | "beratung"
  | "steuer";
export type Timing =
  | "vor_vorhabenbeginn"
  | "laufend"
  | "stichtag_call"
  | "budget_topf";
export type Status = "verifiziert" | "zu_pruefen" | "veraltet";

export interface Programm {
  id: string;
  titel: string;
  foerdergeber: string;
  ebene: Ebene;
  art: Art;
  timing: Timing;
  foerderquote_text: string | null;
  quote_min: string | null;
  quote_max: string | null;
  max_betrag_text: string | null;
  max_betrag_eur: string | null;
  kurzbeschreibung: string | null;
  besonderheit: string | null;
  quelle_url: string | null;
  quelle_stand: string | null;
  status: Status;
  aktiv: boolean;
  kategorien: string[];
  zielgruppen: string[];
  regionen: string[];
  erfolgsquote: number | null;
}

export interface Antragsschritt {
  reihenfolge: number;
  titel: string;
  beschreibung: string | null;
  aufwand_text: string | null;
  frist_bezug: string | null;
  erfordert_dokument_typ: string | null;
  erfordert_berater: boolean;
}

export interface Erfolgsfaktor {
  typ: string;
  text: string;
  gewicht: number;
}

export interface Pflichtunterlage {
  bezeichnung: string;
  pflicht: boolean;
}

export interface Berater {
  id: string;
  name: string;
  qualifikation: string | null;
  region: string | null;
  bewertung: number | null;
}

export interface ProgrammDetail extends Programm {
  antragspfad: Antragsschritt[];
  erfolgsfaktoren: Erfolgsfaktor[];
  ablehnungsgruende: Erfolgsfaktor[];
  pflichtunterlagen: Pflichtunterlage[];
  berater: Berater[];
}

export interface FinderResponse {
  total: number;
  limit: number;
  offset: number;
  anzahl: number;
  programme: Programm[];
}

export interface FilterOption {
  slug: string;
  name: string;
}

export interface FilterOptionen {
  ebene: Ebene[];
  art: Art[];
  timing: Timing[];
  status: Status[];
  kategorien: FilterOption[];
  zielgruppen: FilterOption[];
  regionen: string[];
}

export interface FinderFilter {
  ebene?: Ebene;
  art?: Art;
  kategorie?: string;
  zielgruppe?: string;
  region?: string;
  suche?: string;
  limit?: number;
  offset?: number;
}

export interface MatchProfil {
  zielgruppe?: string;
  region?: string;
  kategorien?: string[];
  limit?: number;
}

export interface MatchResponse {
  profil: { zielgruppe?: string; region?: string; kategorien?: string[] };
  anzahl: number;
  treffer: Programm[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Förderpilot-Anfrage fehlgeschlagen (${res.status})`);
  }
  return (await res.json()) as T;
}

export function fetchProgramme(filter: FinderFilter): Promise<FinderResponse> {
  const params = new URLSearchParams();
  if (filter.ebene) params.set("ebene", filter.ebene);
  if (filter.art) params.set("art", filter.art);
  if (filter.kategorie) params.set("kategorie", filter.kategorie);
  if (filter.zielgruppe) params.set("zielgruppe", filter.zielgruppe);
  if (filter.region) params.set("region", filter.region);
  if (filter.suche) params.set("suche", filter.suche);
  params.set("limit", String(filter.limit ?? 25));
  params.set("offset", String(filter.offset ?? 0));
  return getJson<FinderResponse>(`/api/foerderpilot/programme?${params.toString()}`);
}

export function fetchFilterOptionen(kategorie?: string): Promise<FilterOptionen> {
  const qs = kategorie ? `?kategorie=${encodeURIComponent(kategorie)}` : "";
  return getJson<FilterOptionen>(`/api/foerderpilot/filter-optionen${qs}`);
}

export function fetchProgrammDetail(id: string): Promise<ProgrammDetail> {
  return getJson<ProgrammDetail>(`/api/foerderpilot/programme/${id}`);
}

export async function matchProgramme(profil: MatchProfil): Promise<MatchResponse> {
  const res = await fetch("/api/foerderpilot/match", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(profil),
  });
  if (!res.ok) {
    throw new Error(`Förderpilot-Anfrage fehlgeschlagen (${res.status})`);
  }
  return (await res.json()) as MatchResponse;
}

/* ----------------------------- Label maps ----------------------------- */

export const EBENE_LABEL: Record<Ebene, string> = {
  bund: "Bund",
  land: "Land",
  eu: "EU",
  kommune: "Kommune",
};

export const ART_LABEL: Record<Art, string> = {
  zuschuss: "Zuschuss",
  kredit: "Kredit",
  buergschaft: "Bürgschaft",
  beteiligung: "Beteiligung",
  beratung: "Beratung",
  steuer: "Steuervorteil",
};

export const TIMING_LABEL: Record<Timing, string> = {
  vor_vorhabenbeginn: "Vor Vorhabenbeginn",
  laufend: "Laufend",
  stichtag_call: "Stichtag / Call",
  budget_topf: "Budget-Topf",
};

export const STATUS_LABEL: Record<Status, string> = {
  verifiziert: "Verifiziert",
  zu_pruefen: "Zu prüfen",
  veraltet: "Veraltet",
};

export const REGION_LABEL: Record<string, string> = {
  bundesweit: "Bundesweit",
  eu_weit: "EU-weit",
  baden_wuerttemberg: "Baden-Württemberg",
  bayern: "Bayern",
  berlin: "Berlin",
  brandenburg: "Brandenburg",
  bremen: "Bremen",
  hamburg: "Hamburg",
  hessen: "Hessen",
  mecklenburg_vorpommern: "Mecklenburg-Vorpommern",
  niedersachsen: "Niedersachsen",
  nordrhein_westfalen: "Nordrhein-Westfalen",
  rheinland_pfalz: "Rheinland-Pfalz",
  saarland: "Saarland",
  sachsen: "Sachsen",
  sachsen_anhalt: "Sachsen-Anhalt",
  schleswig_holstein: "Schleswig-Holstein",
  thueringen: "Thüringen",
  foerdergebiet_grw: "GRW-Fördergebiet",
};

export function regionLabel(slug: string): string {
  return REGION_LABEL[slug] ?? slug;
}
