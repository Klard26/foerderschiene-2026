/**
 * Typen für die Vorgangs-/Dokument-/Exposé-Erweiterung (Facilioo-Muster).
 *
 * Diese leben in der isolierten `foerderpilot`-Schema-Welt und sind NICHT Teil
 * des Orval/OpenAPI-Vertrags — die Routen sprechen den dedizierten
 * Förderpilot-Pool an (siehe lib/foerderpilotDb.ts).
 */

export type OrganisationTyp =
  | "hausverwaltung"
  | "bestandshalter"
  | "makler"
  | "energieberatung"
  | "sonstige";

export type VorgangStatus =
  | "neu"
  | "in_pruefung"
  | "unterlagen_offen"
  | "antrag_gestellt"
  | "bewilligt"
  | "abgelehnt"
  | "abgeschlossen";

export type NachrichtKanal =
  | "web"
  | "email"
  | "whatsapp"
  | "telefon"
  | "post"
  | "intern";

export type DokumentEbene =
  | "organisation"
  | "objekt"
  | "vorgang"
  | "antragsschritt"
  | "pflichtunterlage";

export interface Organisation {
  id: string;
  name: string;
  typ: OrganisationTyp;
  region: string | null;
  einheiten_ca: number | null;
  aktiv: boolean;
}

export interface Vorgang {
  id: string;
  organisation_id: string | null;
  objekt_id: string | null;
  programm_id: string | null;
  titel: string;
  status: VorgangStatus;
  faellig_am: string | null;
}

export interface VorgangUebersicht {
  id: string;
  titel: string;
  status: VorgangStatus;
  faellig_am: string | null;
  organisation: string | null;
  organisation_typ: OrganisationTyp | null;
  objekt: string | null;
  programm: string | null;
  pflicht_soll: number;
  pflicht_ist: number;
  nachrichten: number;
  aktualisiert_am: string;
}

export interface Dokument {
  id: string;
  vorgang_id: string | null;
  ebene: DokumentEbene;
  dateiname: string;
  mime_typ: string | null;
  geprueft: boolean;
  pflichtunterlage_id: string | null;
}

export interface Expose {
  id: string;
  objekt_id: string | null;
  titel: string;
  status: string;
  wohnflaeche_m2: number | null;
  zimmer: number | null;
  kaufpreis_eur: number | null;
  energie_kennwert_kwh_m2a: number | null;
  energie_klasse: string | null;
  energietraeger: string | null;
  beschreibung: string | null;
}
