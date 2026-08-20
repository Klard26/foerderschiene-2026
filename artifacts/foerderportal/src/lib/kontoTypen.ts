import type { ImmobilienKundeInputTyp } from "@workspace/api-client-react";

/**
 * Commercial account types for the Förderschiene business area. The shared
 * `immobilien_kunde` enum still contains `privat` for back-compat, but the
 * commercial UI intentionally hides it — Förderschiene's profile is for
 * Hausverwaltungen, Makler, Bestandshalter, Handwerk etc.
 */
export const KOMMERZIELLE_KONTO_TYPEN: {
  value: ImmobilienKundeInputTyp;
  label: string;
}[] = [
  { value: "hausverwaltung", label: "Hausverwaltung" },
  { value: "makler", label: "Makler / Immobilienvermittlung" },
  { value: "bestandshalter", label: "Bestandshalter / Investor" },
  { value: "bautraeger", label: "Bauträger / Projektentwickler" },
  { value: "genossenschaft", label: "Wohnungsgenossenschaft" },
  { value: "handwerker", label: "Handwerk / Sanierungsbetrieb" },
  { value: "gewerbe", label: "Sonstiges Gewerbe" },
];

export const KONTO_TYP_LABELS: Record<string, string> = {
  privat: "Privat",
  ...Object.fromEntries(KOMMERZIELLE_KONTO_TYPEN.map((t) => [t.value, t.label])),
};

/** Types for the end-customers a commercial user manages (verwaltete Kunden). */
export const KUNDEN_TYPEN = [
  "Eigentümer",
  "Eigentümergemeinschaft (WEG)",
  "Mieter",
  "Vermieter",
  "Gewerbekunde",
  "Sonstige",
];

export const GEBAEUDETYPEN = [
  "Einfamilienhaus",
  "Doppelhaushälfte",
  "Reihenhaus",
  "Mehrfamilienhaus",
  "Wohn- und Geschäftshaus",
  "Gewerbeobjekt",
];

export const HEIZUNGSARTEN = [
  "Gas",
  "Öl",
  "Fernwärme",
  "Wärmepumpe",
  "Pellet / Holz",
  "Nachtspeicher (Strom)",
  "Sonstige",
];
