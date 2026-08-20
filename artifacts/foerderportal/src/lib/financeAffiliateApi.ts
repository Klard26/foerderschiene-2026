/**
 * Client for the Förder-Affiliate admin tooling (finance partners + leads).
 *
 * These endpoints live on the shared backend under `/api/finance/...`, are NOT
 * part of the Orval/OpenAPI contract (consistent with the Förderpilot Vorgangs-
 * tooling), and are gated behind `requireAdmin`. We call them with plain
 * root-relative `fetch` and attach the Clerk session token as a Bearer header.
 */

/* ----------------------------- Types ----------------------------- */

// "sending" is a transient claim state used server-side to make partner-email
// dispatch race-safe; it is not a user-selectable filter but may briefly appear
// in the list, so the label/badge maps below cover it.
export type FinanceLeadStatus =
  | "created"
  | "sending"
  | "sent"
  | "converted"
  | "rejected";

export interface FinancePartner {
  id: number;
  name: string;
  contactEmail: string;
  contactName: string | null;
  productTypes: string[];
  regions: string[];
  postalPrefixes: string[];
  minInvestmentCents: number | null;
  maxInvestmentCents: number | null;
  feePerLeadCents: number;
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceLead {
  id: number;
  reportId: number;
  partnerId: number;
  status: FinanceLeadStatus;
  feeCents: number;
  billed: boolean;
  estimatedInvestmentCents: number | null;
  buyerEmail: string | null;
  buyerName: string | null;
  adresse: string | null;
  postalCode: string | null;
  region: string | null;
  consentVersion: string | null;
  consentText: string | null;
  consentAt: string | null;
  sentAt: string | null;
  convertedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  partnerName: string | null;
  partnerContactEmail: string | null;
}

/* ----------------------------- Request payloads ----------------------------- */

export interface FinancePartnerInput {
  name: string;
  contactEmail: string;
  contactName?: string | null;
  productTypes?: string[];
  regions?: string[];
  postalPrefixes?: string[];
  minInvestmentCents?: number | null;
  maxInvestmentCents?: number | null;
  feePerLeadCents?: number;
  active?: boolean;
  notes?: string | null;
}

/* ----------------------------- Label maps ----------------------------- */

export const FINANCE_LEAD_STATUS: FinanceLeadStatus[] = [
  "created",
  "sent",
  "converted",
  "rejected",
];

export const FINANCE_LEAD_STATUS_LABEL: Record<FinanceLeadStatus, string> = {
  created: "Erstellt",
  sending: "Wird versendet",
  sent: "Versendet",
  converted: "Abgeschlossen",
  rejected: "Abgelehnt",
};

export const FINANCE_LEAD_STATUS_BADGE: Record<FinanceLeadStatus, string> = {
  created: "bg-slate-100 text-slate-800",
  sending: "bg-amber-100 text-amber-900",
  sent: "bg-sky-100 text-sky-900",
  converted: "bg-emerald-100 text-emerald-900",
  rejected: "bg-rose-100 text-rose-900",
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

const BASE = "/api/finance";

export const financeApi = {
  listPartners: (token: Token) =>
    authJson<FinancePartner[]>(token, `${BASE}/partners`),
  createPartner: (token: Token, body: FinancePartnerInput) =>
    authJson<FinancePartner>(token, `${BASE}/partners`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updatePartner: (token: Token, id: number, body: Partial<FinancePartnerInput>) =>
    authJson<FinancePartner>(token, `${BASE}/partners/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  listLeads: (token: Token, opts?: { status?: FinanceLeadStatus; partnerId?: number }) => {
    const qs = new URLSearchParams();
    if (opts?.status) qs.set("status", opts.status);
    if (opts?.partnerId) qs.set("partnerId", String(opts.partnerId));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return authJson<FinanceLead[]>(token, `${BASE}/leads${suffix}`);
  },
  convertLead: (token: Token, id: number) =>
    authJson<FinanceLead>(token, `${BASE}/leads/${id}/convert`, { method: "POST" }),
  rejectLead: (token: Token, id: number, reason?: string) =>
    authJson<FinanceLead>(token, `${BASE}/leads/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? null }),
    }),
};
