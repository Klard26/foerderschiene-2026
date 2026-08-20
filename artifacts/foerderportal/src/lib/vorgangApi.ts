/**
 * Client for the Förderpilot Vorgangs-/Dokument-/Exposé-Verwaltung.
 *
 * These endpoints live on the shared backend under `/api/foerderpilot/...`, are
 * NOT part of the Orval/OpenAPI contract (the Förderpilot integration uses its
 * own isolated schema), and are gated behind `requireAdmin`. We therefore call
 * them with plain root-relative `fetch` and attach the Clerk session token as a
 * Bearer header — a documented deviation from the codegen workflow, consistent
 * with `foerderpilotApi.ts`.
 */

import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";

/* ----------------------------- Types ----------------------------- */

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

export type NachrichtRichtung = "eingehend" | "ausgehend";

export type DokumentEbene =
  | "organisation"
  | "objekt"
  | "vorgang"
  | "antragsschritt"
  | "pflichtunterlage";

export type OrganisationTyp =
  | "hausverwaltung"
  | "bestandshalter"
  | "makler"
  | "energieberatung"
  | "sonstige";

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

export interface Vorgang {
  id: string;
  organisation_id: string | null;
  objekt_id: string | null;
  programm_id: string | null;
  titel: string;
  status: VorgangStatus;
  faellig_am: string | null;
}

export interface Nachricht {
  kanal: NachrichtKanal;
  richtung: NachrichtRichtung;
  von: string | null;
  inhalt: string;
  erstellt_am: string;
}

export interface Dokument {
  id: string;
  vorgang_id?: string | null;
  ebene: DokumentEbene;
  dateiname: string;
  mime_typ: string | null;
  geprueft: boolean;
  pflichtunterlage_id: string | null;
}

export interface ChecklisteItem {
  id: string;
  bezeichnung: string;
  pflicht: boolean;
  vorhanden: boolean;
  geprueft: boolean;
}

export interface Checkliste {
  ausweis_vollstaendig: boolean;
  offen: number;
  unterlagen: ChecklisteItem[];
}

export interface VorgangDetail extends Omit<VorgangUebersicht, "nachrichten"> {
  nachrichten: Nachricht[];
  dokumente: Dokument[];
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

export interface EmailDeliveryFailure {
  id: number;
  templateId: string;
  recipient: string;
  error: string | null;
  sentAt: string;
}

export interface EmailDeliveryHealth {
  healthy: boolean;
  windowHours: number;
  monitoredTemplateIds: string[];
  failedCount: number;
  failures: EmailDeliveryFailure[];
}

/* ----------------------------- Request payloads ----------------------------- */

export interface VorgangInput {
  titel: string;
  programm_id?: string;
  faellig_am?: string;
}

export interface NachrichtInput {
  kanal: NachrichtKanal;
  richtung: NachrichtRichtung;
  von?: string;
  inhalt: string;
}

export interface DokumentInput {
  dateiname: string;
  mime_typ?: string;
  ebene: DokumentEbene;
  pflichtunterlage_id?: string;
}

export interface ExposeInput {
  titel: string;
  wohnflaeche_m2?: number;
  zimmer?: number;
  kaufpreis_eur?: number;
  energie_kennwert_kwh_m2a?: number;
  energie_klasse?: string;
  energietraeger?: string;
  beschreibung?: string;
}

/* ----------------------------- Label maps ----------------------------- */

export const VORGANG_STATUS: VorgangStatus[] = [
  "neu",
  "in_pruefung",
  "unterlagen_offen",
  "antrag_gestellt",
  "bewilligt",
  "abgelehnt",
  "abgeschlossen",
];

export const VORGANG_STATUS_LABEL: Record<VorgangStatus, string> = {
  neu: "Neu",
  in_pruefung: "In Prüfung",
  unterlagen_offen: "Unterlagen offen",
  antrag_gestellt: "Antrag gestellt",
  bewilligt: "Bewilligt",
  abgelehnt: "Abgelehnt",
  abgeschlossen: "Abgeschlossen",
};

export const VORGANG_STATUS_BADGE: Record<VorgangStatus, string> = {
  neu: "bg-slate-100 text-slate-800",
  in_pruefung: "bg-amber-100 text-amber-900",
  unterlagen_offen: "bg-orange-100 text-orange-900",
  antrag_gestellt: "bg-sky-100 text-sky-900",
  bewilligt: "bg-emerald-100 text-emerald-900",
  abgelehnt: "bg-rose-100 text-rose-900",
  abgeschlossen: "bg-teal-100 text-teal-900",
};

export const KANAL_LABEL: Record<NachrichtKanal, string> = {
  web: "Web",
  email: "E-Mail",
  whatsapp: "WhatsApp",
  telefon: "Telefon",
  post: "Post",
  intern: "Intern",
};

export const EBENE_LABEL: Record<DokumentEbene, string> = {
  organisation: "Organisation",
  objekt: "Objekt",
  vorgang: "Vorgang",
  antragsschritt: "Antragsschritt",
  pflichtunterlage: "Pflichtunterlage",
};

export const ORG_TYP_LABEL: Record<OrganisationTyp, string> = {
  hausverwaltung: "Hausverwaltung",
  bestandshalter: "Bestandshalter",
  makler: "Makler",
  energieberatung: "Energieberatung",
  sonstige: "Sonstige",
};

/* ----------------------------- Fetch helper ----------------------------- */

type Token = string | null;

async function authJson<T>(token: Token, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `Anfrage fehlgeschlagen (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* keep default message */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const BASE = "/api/foerderpilot";

export const vorgangApi = {
  list: (token: Token, status?: VorgangStatus) =>
    authJson<{ anzahl: number; vorgaenge: VorgangUebersicht[] }>(
      token,
      `${BASE}/vorgaenge${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  detail: (token: Token, id: string) =>
    authJson<VorgangDetail>(token, `${BASE}/vorgaenge/${id}`),
  create: (token: Token, body: VorgangInput) =>
    authJson<Vorgang>(token, `${BASE}/vorgaenge`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  setStatus: (token: Token, id: string, status: VorgangStatus) =>
    authJson<Vorgang>(token, `${BASE}/vorgaenge/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  addNachricht: (token: Token, id: string, body: NachrichtInput) =>
    authJson<Nachricht>(token, `${BASE}/vorgaenge/${id}/nachrichten`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  addDokument: (token: Token, id: string, body: DokumentInput) =>
    authJson<Dokument>(token, `${BASE}/vorgaenge/${id}/dokumente`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  pruefeDokument: (token: Token, id: string) =>
    authJson<Dokument>(token, `${BASE}/dokumente/${id}/pruefen`, { method: "PATCH" }),
  checkliste: (token: Token, id: string) =>
    authJson<Checkliste>(token, `${BASE}/vorgaenge/${id}/checkliste`),
  createExpose: (token: Token, body: ExposeInput) =>
    authJson<{ expose: Expose; pflichtangaben_hinweis: string }>(token, `${BASE}/expose`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

/* ----------------------------- Admin hook ----------------------------- */

/** Detects whether the signed-in Clerk user is a platform admin (fail-closed). */
export function useIsAdmin() {
  const { getToken, isSignedIn } = useAuth();
  return useQuery({
    queryKey: ["fp-admin-me"],
    enabled: !!isSignedIn,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/admin/me", {
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) return { isAdmin: false };
      return (await res.json()) as { isAdmin: boolean };
    },
  });
}

/** Polls the admin email delivery health endpoint while the admin page is open. */
export function useEmailDeliveryHealth() {
  const { getToken, isSignedIn } = useAuth();
  return useQuery({
    queryKey: ["fp-admin-email-health"],
    enabled: !!isSignedIn,
    refetchInterval: 60_000,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/admin/email-health?windowHours=24", {
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        let message = `E-Mail-Status konnte nicht geladen werden (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // Keep the status-based fallback message.
        }
        throw new Error(message);
      }
      return (await res.json()) as EmailDeliveryHealth;
    },
  });
}
