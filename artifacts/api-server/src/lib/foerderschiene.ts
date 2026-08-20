import { db, pool } from "@workspace/db";
import {
  foerderProgrammeTable,
  foerderschieneReportsTable,
  energieausweisOrdersTable,
  emailLogTable,
  type FoerderProgramm,
} from "@workspace/db";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import {
  sendFoerderschieneReportReadyUnlogged,
  sendEnergieausweisOrderConfirmation,
  wasEmailSent,
  type TransactionalEmailDeliveryResult,
} from "./email";

/** One-time price for the detailed Gebäudereport PDF (in cents). */
export const REPORT_PRICE_CENTS = 2900;

/** Energieausweis order prices by type (in cents). Fulfilled by a certified
 *  Aussteller — Förderschiene only collects intake + payment. */
export const ENERGIEAUSWEIS_PRICES: Record<string, number> = {
  verbrauch: 7900,
  bedarf: 14900,
};

export function energieausweisPrice(typ: string): number | null {
  return ENERGIEAUSWEIS_PRICES[typ] ?? null;
}

/**
 * Förderprogramm catalogue. Flattened from the Förderpilot classification
 * schema (amtliche Stammdaten). `tags` drive the building-profile matching.
 */
export const FOERDER_PROGRAMME_SEED: Omit<FoerderProgramm, "createdAt">[] = [
  {
    id: "beg-em-heizung-kfw458",
    titel: "BEG Einzelmaßnahmen – Heizungstausch (KfW 458)",
    foerdergeber: "KfW",
    ebene: "bund",
    art: "zuschuss",
    timing: "vor_vorhabenbeginn",
    foerderquoteText: "30 % Grundförderung + Boni, gedeckelt bei 70 %",
    quoteMax: 70,
    maxBetragText: "max. 30.000 € förderf. Kosten/WE → bis 21.000 € Zuschuss",
    maxBetragEur: 21000,
    kurzbeschreibung:
      "Zuschuss für den Austausch fossiler Heizungen durch klimafreundliche Systeme (Wärmepumpe, Pellet, Solarthermie, Biomasse).",
    besonderheit:
      "Antrag auch durch Heizungsbauer möglich; Einkommensbonus 30 % bis 40.000 € zvE. Antrag VOR Auftragsvergabe.",
    quelleUrl: "https://www.kfw.de",
    erfolgsquote: 78,
    tags: ["heizung"],
    region: "bundesweit",
    aktiv: true,
  },
  {
    id: "beg-em-huelle-bafa",
    titel: "BEG Einzelmaßnahmen – Gebäudehülle (BAFA)",
    foerdergeber: "BAFA",
    ebene: "bund",
    art: "zuschuss",
    timing: "vor_vorhabenbeginn",
    foerderquoteText: "15 % + 5 % iSFP-Bonus = 20 %",
    quoteMax: 20,
    maxBetragText: "max. 60.000 € förderf. Kosten/WE/Jahr (mit iSFP)",
    maxBetragEur: 12000,
    kurzbeschreibung:
      "Zuschuss für Dämmung von Fassade, Dach, Kellerdecke und für den Fenstertausch.",
    besonderheit:
      "Der iSFP-Bonus (5 %) setzt einen individuellen Sanierungsfahrplan voraus.",
    quelleUrl: "https://www.bafa.de",
    erfolgsquote: 82,
    tags: ["daemmung", "fenster"],
    region: "bundesweit",
    aktiv: true,
  },
  {
    id: "kfw-261-effizienzhaus",
    titel: "Wohngebäude – Kredit Effizienzhaus (KfW 261)",
    foerdergeber: "KfW",
    ebene: "bund",
    art: "kredit",
    timing: "vor_vorhabenbeginn",
    foerderquoteText: "Tilgungszuschuss bis 45 %",
    quoteMax: 45,
    maxBetragText: "max. 150.000 € Kredit pro Wohneinheit",
    maxBetragEur: 67500,
    kurzbeschreibung:
      "Kreditförderung für die Sanierung zum Effizienzhaus 85, 70, 55, 40 oder Denkmal.",
    besonderheit:
      "Energieeffizienz-Experte (dena-Liste) verpflichtend. Höchster Zuschuss bei EH 40 EE.",
    quelleUrl: "https://www.kfw.de",
    erfolgsquote: 71,
    tags: ["komplett"],
    region: "bundesweit",
    aktiv: true,
  },
  {
    id: "estg-35c-steuerbonus",
    titel: "§ 35c EStG – Steuerbonus energetische Sanierung",
    foerdergeber: "Finanzamt",
    ebene: "bund",
    art: "steuer",
    timing: "laufend",
    foerderquoteText: "20 % verteilt auf 3 Jahre",
    quoteMax: 20,
    maxBetragText: "max. 40.000 € Steuerermäßigung pro Objekt",
    maxBetragEur: 40000,
    kurzbeschreibung:
      "Steuerermäßigung für energetische Einzelmaßnahmen bei selbstgenutztem Wohneigentum.",
    besonderheit:
      "Nicht kombinierbar mit BAFA/KfW-Förderung für dieselbe Maßnahme. Nur selbstgenutzt.",
    quelleUrl: "https://www.bundesfinanzministerium.de",
    erfolgsquote: 90,
    tags: ["heizung", "daemmung", "fenster", "steuer"],
    region: "bundesweit",
    aktiv: true,
  },
  {
    id: "isfp-bafa-beratung",
    titel: "Energieberatung Wohngebäude / iSFP (BAFA)",
    foerdergeber: "BAFA",
    ebene: "bund",
    art: "beratung",
    timing: "vor_vorhabenbeginn",
    foerderquoteText: "50 % Zuschuss zum Beratungshonorar",
    quoteMax: 50,
    maxBetragText: "max. 650 € (EFH/ZFH), 850 € (MFH ab 3 WE)",
    maxBetragEur: 850,
    kurzbeschreibung:
      "Geförderter individueller Sanierungsfahrplan (iSFP) durch einen zertifizierten Energieberater.",
    besonderheit:
      "Der iSFP schaltet zusätzlich den 5 %-iSFP-Bonus bei BEG-Einzelmaßnahmen frei.",
    quelleUrl: "https://www.bafa.de",
    erfolgsquote: 88,
    tags: ["beratung"],
    region: "bundesweit",
    aktiv: true,
  },
  {
    id: "beg-em-pv-anlagentechnik",
    titel: "BEG EM – Anlagentechnik & Solarthermie (BAFA)",
    foerdergeber: "BAFA",
    ebene: "bund",
    art: "zuschuss",
    timing: "vor_vorhabenbeginn",
    foerderquoteText: "15 % + 5 % iSFP-Bonus",
    quoteMax: 20,
    maxBetragText: "max. 60.000 € förderf. Kosten/WE/Jahr",
    maxBetragEur: 12000,
    kurzbeschreibung:
      "Zuschuss für Lüftungsanlagen mit Wärmerückgewinnung, Solarthermie und sommerlichen Wärmeschutz.",
    besonderheit:
      "Photovoltaik selbst wird über das EEG (Einspeisevergütung) vergütet, nicht über BEG.",
    quelleUrl: "https://www.bafa.de",
    erfolgsquote: 80,
    tags: ["pv", "heizung"],
    region: "bundesweit",
    aktiv: true,
  },
];

/**
 * Recommended measures (Einzelmaßnahmen + Komplettsanierungen) with cost
 * estimates at current market conditions. Costs are computed from the living
 * area where it scales with surface; fixed-price items use min/max directly.
 */
interface MassnahmeDef {
  id: string;
  label: string;
  art: "einzelmassnahme" | "komplettsanierung";
  tags: string[];
  einsparung: string;
  beschreibung: string;
  /** € per m² of living area (min/max), or null for fixed price. */
  proM2?: [number, number];
  fix?: [number, number];
}

const MASSNAHMEN: MassnahmeDef[] = [
  {
    id: "waermepumpe",
    label: "Wärmepumpe (Heizungstausch)",
    art: "einzelmassnahme",
    tags: ["heizung"],
    einsparung: "ca. 1.500–2.500 € Heizkosten/Jahr",
    beschreibung:
      "Austausch der fossilen Heizung gegen eine Luft- oder Sole-Wärmepumpe inkl. hydraulischem Abgleich.",
    fix: [22000, 38000],
  },
  {
    id: "fassadendaemmung",
    label: "Fassadendämmung (WDVS)",
    art: "einzelmassnahme",
    tags: ["daemmung"],
    einsparung: "ca. 15–25 % Heizenergie",
    beschreibung:
      "Wärmedämmverbundsystem auf der Außenfassade, größter Hebel bei ungedämmten Altbauten.",
    proM2: [180, 280],
  },
  {
    id: "dachdaemmung",
    label: "Dach- / Oberste-Geschossdecke-Dämmung",
    art: "einzelmassnahme",
    tags: ["daemmung"],
    einsparung: "ca. 7–15 % Heizenergie",
    beschreibung:
      "Dämmung der obersten Geschossdecke oder des Steildachs zwischen/auf den Sparren.",
    proM2: [60, 120],
  },
  {
    id: "fenster",
    label: "Fenstertausch (3-fach-Verglasung)",
    art: "einzelmassnahme",
    tags: ["fenster"],
    einsparung: "ca. 10–15 % Heizenergie",
    beschreibung:
      "Austausch alter Fenster gegen moderne 3-fach-verglaste Fenster mit gedämmten Rahmen.",
    proM2: [80, 140],
  },
  {
    id: "pv-anlage",
    label: "Photovoltaik-Anlage inkl. Speicher",
    art: "einzelmassnahme",
    tags: ["pv"],
    einsparung: "ca. 800–1.400 € Stromkosten/Jahr",
    beschreibung:
      "PV-Anlage (8–12 kWp) mit Batteriespeicher zur Eigenstromnutzung.",
    fix: [14000, 24000],
  },
  {
    id: "komplettsanierung-eh55",
    label: "Komplettsanierung Effizienzhaus 55",
    art: "komplettsanierung",
    tags: ["komplett", "heizung", "daemmung", "fenster"],
    einsparung: "ca. 60–75 % Endenergie",
    beschreibung:
      "Vollsanierung von Hülle und Anlagentechnik auf den Standard Effizienzhaus 55 — höchste Förderquote über KfW 261.",
    proM2: [900, 1400],
  },
];

function fmtEur(n: number): number {
  return Math.round(n / 100) * 100;
}

export interface MassnahmeEstimate {
  id: string;
  label: string;
  art: "einzelmassnahme" | "komplettsanierung";
  kostenMin: number;
  kostenMax: number;
  einsparung: string;
  beschreibung: string;
  tags: string[];
}

export interface MatchInput {
  baujahr: number;
  wohnflaeche: number;
  wohneinheiten?: number | null;
  heizung: string;
  massnahmen?: string[];
  selbstgenutzt?: boolean | null;
}

export interface MatchResult {
  programme: FoerderProgramm[];
  massnahmen: MassnahmeEstimate[];
  geschaetzteFoerderungEur: number;
}

/**
 * Building-profile → eligible programs + recommended measures with cost
 * estimates. Selects relevant measure tags from the profile (old heating →
 * heizung, old building → daemmung/fenster, plus any explicit selections),
 * estimates costs from the living area, then filters programs by overlapping
 * tags and sums a rough achievable subsidy.
 */
export async function matchFoerderschiene(
  input: MatchInput,
): Promise<MatchResult> {
  const flaeche = Math.max(20, input.wohnflaeche || 0);
  const tags = new Set<string>(input.massnahmen ?? []);

  const fossilHeating = ["gas", "oel", "kohle", "nachtspeicher"];
  if (fossilHeating.includes(input.heizung)) tags.add("heizung");
  if (input.baujahr && input.baujahr < 1995) {
    tags.add("daemmung");
    tags.add("fenster");
  }
  if (input.baujahr && input.baujahr < 1979) tags.add("komplett");
  if (tags.size === 0) tags.add("heizung");

  const massnahmen: MassnahmeEstimate[] = MASSNAHMEN.filter((m) =>
    m.tags.some((t) => tags.has(t)),
  ).map((m) => {
    let min: number;
    let max: number;
    if (m.proM2) {
      min = fmtEur(m.proM2[0] * flaeche);
      max = fmtEur(m.proM2[1] * flaeche);
    } else if (m.fix) {
      min = m.fix[0];
      max = m.fix[1];
    } else {
      min = 0;
      max = 0;
    }
    return {
      id: m.id,
      label: m.label,
      art: m.art,
      kostenMin: min,
      kostenMax: max,
      einsparung: m.einsparung,
      beschreibung: m.beschreibung,
      tags: m.tags,
    };
  });

  const all = await listProgramme();
  const programme = all.filter((p) => {
    if (p.tags.includes("beratung")) return true; // beratung always relevant
    if (p.art === "steuer" && input.selbstgenutzt === false) return false;
    return p.tags.some((t: string) => tags.has(t));
  });

  // Rough achievable subsidy: 30 % of the median estimated investment of the
  // recommended Einzelmaßnahmen, capped at the highest program ceiling.
  const investMedian = massnahmen
    .filter((m) => m.art === "einzelmassnahme")
    .reduce((sum, m) => sum + (m.kostenMin + m.kostenMax) / 2, 0);
  const cap = Math.max(
    0,
    ...programme.map((p) => p.maxBetragEur ?? 0),
  );
  const geschaetzteFoerderungEur = fmtEur(
    Math.min(investMedian * 0.3, cap || investMedian * 0.3),
  );

  return { programme, massnahmen, geschaetzteFoerderungEur };
}

let seeded = false;

/** Idempotently seed the program catalogue (runs once per process). */
export async function ensureProgrammeSeeded(): Promise<void> {
  if (seeded) return;
  for (const p of FOERDER_PROGRAMME_SEED) {
    await db
      .insert(foerderProgrammeTable)
      .values(p)
      .onConflictDoNothing({ target: foerderProgrammeTable.id });
  }
  seeded = true;
}

export async function listProgramme(): Promise<FoerderProgramm[]> {
  await ensureProgrammeSeeded();
  return db
    .select()
    .from(foerderProgrammeTable)
    .where(eq(foerderProgrammeTable.aktiv, true));
}

/** Idempotently mark a report paid. Returns true if it transitioned. */
export async function fulfillReport(
  sessionId: string,
  paymentIntentId?: string | null,
): Promise<boolean> {
  if (paymentIntentId) {
    await db
      .update(foerderschieneReportsTable)
      .set({ paymentIntentId })
      .where(
        and(
          eq(foerderschieneReportsTable.sessionId, sessionId),
          isNull(foerderschieneReportsTable.paymentIntentId),
        ),
      );
  }
  const [updated] = await db
    .update(foerderschieneReportsTable)
    .set({ status: "paid", paidAt: new Date() })
    .where(
      and(
        eq(foerderschieneReportsTable.sessionId, sessionId),
        eq(foerderschieneReportsTable.status, "pending"),
      ),
    )
    .returning();
  return !!updated;
}

export async function refundReport(
  paymentIntentId: string,
  sessionId?: string | null,
): Promise<{ id: number; email: string | null; amountCents: number } | null> {
  const lookup = sessionId
    ? or(
        eq(foerderschieneReportsTable.paymentIntentId, paymentIntentId),
        eq(foerderschieneReportsTable.sessionId, sessionId),
      )
    : eq(foerderschieneReportsTable.paymentIntentId, paymentIntentId);
  const [report] = await db
    .update(foerderschieneReportsTable)
    .set({ status: "refunded", refundedAt: new Date() })
    .where(and(lookup, ne(foerderschieneReportsTable.status, "refunded")))
    .returning({
      id: foerderschieneReportsTable.id,
      email: foerderschieneReportsTable.email,
      amountCents: foerderschieneReportsTable.amountCents,
    });
  if (report) return report;
  const [alreadyRefunded] = await db
    .select({
      id: foerderschieneReportsTable.id,
      email: foerderschieneReportsTable.email,
      amountCents: foerderschieneReportsTable.amountCents,
    })
    .from(foerderschieneReportsTable)
    .where(and(lookup, eq(foerderschieneReportsTable.status, "refunded")))
    .limit(1);
  return alreadyRefunded ?? null;
}

/**
 * Discriminated result returned by deliverReportReadyEmail.
 * Callers (webhook, reconcile) can inspect this to decide whether to
 * propagate a failure (e.g. return 5xx to Stripe so it retries the event).
 */
export type ReportEmailDeliveryResult =
  | "sent"           // Resend accepted the email
  | "skipped"        // Resend client not configured (dev / missing key)
  | "failed"         // Resend returned an error — caller should retry
  | "already_delivered" // A prior call already wrote 'sent' — idempotent no-op
  | "no_report"      // No matching report row found — nothing to send
  | "not_paid";      // A cancelled or refunded order must never be unlocked

/**
 * Send the "report ready" email for a paid Checkout session, exactly once,
 * even under concurrent callers. Safe to call from BOTH the Stripe webhook
 * and the success-page reconcile route simultaneously.
 *
 * Concurrency guarantee
 * ---------------------
 * Delivery is claimed via an INSERT … ON CONFLICT (DO UPDATE / DO NOTHING)
 * against the unique partial index on email_log(template_id, related_id)
 * WHERE status IN ('in_flight', 'sent').  Exactly one concurrent caller wins
 * the INSERT; any other returns "already_delivered" immediately.
 *
 * Stale-lease reclaim
 * -------------------
 * If a process crashes while holding an 'in_flight' claim the DO UPDATE arm
 * of the upsert automatically reclaims it — but only when the lease is older
 * than 10 minutes.  This means a Stripe webhook retry (which arrives after at
 * least 1 hour) will always find a reclaimable slot.
 *
 * Retry path
 * ----------
 * When Resend returns an error the claim row is transitioned to 'failed'.
 * 'failed' is excluded from the partial index, so the next invocation (e.g.
 * a Stripe webhook retry) can INSERT a fresh 'in_flight' slot and try again.
 * 'sent' is written only after a successful Resend call — the delivery state
 * is never pre-committed.
 *
 * Caller responsibility
 * ---------------------
 * When this function returns "failed" the caller SHOULD signal an error
 * upstream so the originating event can be retried automatically (e.g. return
 * 5xx from the Stripe webhook so Stripe enqueues a retry).
 */
export async function deliverReportReadyEmail(
  session: {
    id: string;
    customer_details?: { email?: string | null } | null;
    customer_email?: string | null;
  },
  baseUrl: string,
): Promise<ReportEmailDeliveryResult> {
  const [report] = await db
    .select()
    .from(foerderschieneReportsTable)
    .where(eq(foerderschieneReportsTable.sessionId, session.id))
    .limit(1);
  if (!report) return "no_report";
  if (report.status !== "paid") return "not_paid";

  const email =
    session.customer_details?.email ?? session.customer_email ?? report.email ?? null;
  if (!email) return "no_report";

  if (!report.email) {
    await db
      .update(foerderschieneReportsTable)
      .set({ email })
      .where(eq(foerderschieneReportsTable.id, report.id));
  }

  const reportUrl = `${baseUrl}/foerderschiene/report?status=success&session_id=${session.id}`;

  // Atomic in-flight claim with stale-lease reclaim.
  //
  // The unique partial index email_log_active_dedup covers
  // (template_id, related_id) WHERE status IN ('in_flight', 'sent').
  //
  // On INSERT:
  //   • No active claim → INSERT succeeds, RETURNING yields the new row id.
  //   • Active 'sent' claim → DO UPDATE WHERE is FALSE → effectively DO NOTHING,
  //     RETURNING yields nothing → caller returns "already_delivered".
  //   • Recent 'in_flight' (< 10 min) → same as 'sent' above.
  //   • Stale 'in_flight' (≥ 10 min, crash survivor) → DO UPDATE resets the
  //     row to a fresh 'in_flight', RETURNING yields the row id → winner reclaims
  //     the slot and retries delivery.
  //
  // Using the pg Pool directly (not Drizzle ORM) because Drizzle's Postgres
  // driver does not expose the ON CONFLICT … DO UPDATE … WHERE partial-index
  // target syntax needed for atomic lease reclaim.
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO email_log (template_id, recipient, related_id, subject, status)
     VALUES ($1, $2, $3, $4, 'in_flight')
     ON CONFLICT (template_id, related_id) WHERE status IN ('in_flight', 'sent')
     DO UPDATE SET
       status    = 'in_flight',
       recipient = EXCLUDED.recipient,
       sent_at   = NOW()
     WHERE email_log.status = 'in_flight'
       AND email_log.sent_at < NOW() - INTERVAL '10 minutes'
     RETURNING id`,
    [
      "foerderschiene_report_ready",
      email,
      String(report.id),
      "Ihr Gebäudereport ist fertig",
    ],
  );

  const claimedId = rows[0]?.id ?? null;
  if (!claimedId) return "already_delivered"; // 'sent' exists, or another caller holds a recent lease.

  // Call Resend. The committed 'in_flight' row is visible to all concurrent
  // callers — no double-send can race past the INSERT above.
  const result = await sendFoerderschieneReportReadyUnlogged({
    email,
    adresse: report.adresse,
    reportUrl,
  });

  // Transition the claim row to its final state.
  // 'sent'            → wasEmailSent() returns true; dedup guard blocks future sends.
  // 'failed'/'skipped' → excluded from the partial index; the next call (e.g. a
  //                      Stripe webhook retry) can INSERT a fresh slot and retry.
  const finalStatus = result.sent ? "sent" : result.skipped ? "skipped" : "failed";
  await db
    .update(emailLogTable)
    .set({ status: finalStatus, error: result.error ?? null })
    .where(eq(emailLogTable.id, claimedId));

  return finalStatus as ReportEmailDeliveryResult;
}

/**
 * Sweep orphaned Energieausweis orders (status=pending_payment, sessionId IS
 * NULL).  These can only arise from the *old* two-step checkout (INSERT then
 * Stripe then UPDATE) where the process crashed between steps.  The current
 * checkout creates the Stripe session first and inserts the row with the
 * sessionId already set, so new orphans are impossible.
 *
 * Two age tiers:
 *
 *  • 1 h – 24 h old  → Log a structured warning.  The Stripe session for this
 *    order may still be live; cancelling now risks losing a real payment if the
 *    buyer finds and completes the link.
 *
 *  • ≥ 24 h old      → Cancel (storniert).  Stripe Checkout sessions expire
 *    after 24 h by default, so no payment can ever arrive; cancellation is
 *    safe and prevents the order from lingering permanently.
 *
 * Safe to call on every server startup.  Returns counts per tier.
 */
export async function sweepOrphanedEnergieausweisOrders(
  log: (msg: string, data?: Record<string, unknown>) => void = () => {},
): Promise<{ warned: number; cancelled: number }> {
  // Tier 1: 1 h – 24 h old — log only, do not cancel.
  const recentOrphans = await db
    .select({
      id: energieausweisOrdersTable.id,
      createdAt: energieausweisOrdersTable.createdAt,
    })
    .from(energieausweisOrdersTable)
    .where(
      sql`${energieausweisOrdersTable.status} = 'pending_payment'
          AND ${energieausweisOrdersTable.sessionId} IS NULL
          AND ${energieausweisOrdersTable.createdAt} >= NOW() - INTERVAL '24 hours'
          AND ${energieausweisOrdersTable.createdAt} < NOW() - INTERVAL '1 hour'`,
    );

  if (recentOrphans.length > 0) {
    log(
      "Energieausweis orders with no sessionId (1–24 h old) — Stripe session may still be live; not cancelling",
      { count: recentOrphans.length, orderIds: recentOrphans.map((r) => r.id) },
    );
  }

  // Tier 2: ≥ 24 h old — Stripe session definitely expired; cancel safely.
  const cancelled = await db
    .update(energieausweisOrdersTable)
    .set({ status: "storniert" })
    .where(
      sql`${energieausweisOrdersTable.status} = 'pending_payment'
          AND ${energieausweisOrdersTable.sessionId} IS NULL
          AND ${energieausweisOrdersTable.createdAt} < NOW() - INTERVAL '24 hours'`,
    )
    .returning({ id: energieausweisOrdersTable.id });

  if (cancelled.length > 0) {
    log(
      "Stale orphaned Energieausweis orders cancelled (≥24 h, no sessionId, Stripe session expired)",
      { count: cancelled.length, orderIds: cancelled.map((r) => r.id) },
    );
  }

  return { warned: recentOrphans.length, cancelled: cancelled.length };
}

/** Idempotently mark an Energieausweis order paid + queued for the issuer. */
export async function fulfillEnergieausweis(
  sessionId: string,
  paymentIntentId?: string | null,
): Promise<boolean> {
  if (paymentIntentId) {
    await db
      .update(energieausweisOrdersTable)
      .set({ paymentIntentId })
      .where(
        and(
          eq(energieausweisOrdersTable.sessionId, sessionId),
          isNull(energieausweisOrdersTable.paymentIntentId),
        ),
      );
  }
  const [updated] = await db
    .update(energieausweisOrdersTable)
    .set({ status: "in_bearbeitung", paidAt: new Date() })
    .where(
      sql`${energieausweisOrdersTable.sessionId} = ${sessionId} AND ${energieausweisOrdersTable.status} = 'pending_payment'`,
    )
    .returning();
  return !!updated;
}

export async function refundEnergieausweis(
  paymentIntentId: string,
  sessionId?: string | null,
): Promise<{
  id: number;
  email: string;
  kontaktName: string;
  amountCents: number;
} | null> {
  const lookup = sessionId
    ? or(
        eq(energieausweisOrdersTable.paymentIntentId, paymentIntentId),
        eq(energieausweisOrdersTable.sessionId, sessionId),
      )
    : eq(energieausweisOrdersTable.paymentIntentId, paymentIntentId);
  const [order] = await db
    .update(energieausweisOrdersTable)
    .set({ status: "refunded", refundedAt: new Date() })
    .where(and(lookup, ne(energieausweisOrdersTable.status, "refunded")))
    .returning({
      id: energieausweisOrdersTable.id,
      email: energieausweisOrdersTable.kontaktEmail,
      kontaktName: energieausweisOrdersTable.kontaktName,
      amountCents: energieausweisOrdersTable.amountCents,
    });
  if (order) return order;
  const [alreadyRefunded] = await db
    .select({
      id: energieausweisOrdersTable.id,
      email: energieausweisOrdersTable.kontaktEmail,
      kontaktName: energieausweisOrdersTable.kontaktName,
      amountCents: energieausweisOrdersTable.amountCents,
    })
    .from(energieausweisOrdersTable)
    .where(and(lookup, eq(energieausweisOrdersTable.status, "refunded")))
    .limit(1);
  return alreadyRefunded ?? null;
}

/**
 * Send the order confirmation email for a paid Energieausweis Checkout session,
 * idempotently. Captures the buyer's email from the Stripe session (or falls back
 * to the stored kontaktEmail), then uses an atomic email-log claim to ensure that
 * webhook retries and success-page reconciliation cannot double-send.
 * Safe to call from BOTH the success-page reconcile and the Stripe webhook.
 */
export type EnergieausweisConfirmationDeliveryResult =
  | TransactionalEmailDeliveryResult
  | "no_order"
  | "not_paid";

export async function deliverEnergieausweisConfirmationEmail(
  session: {
    id: string;
    customer_details?: { email?: string | null } | null;
    customer_email?: string | null;
  },
): Promise<EnergieausweisConfirmationDeliveryResult> {
  const [order] = await db
    .select()
    .from(energieausweisOrdersTable)
    .where(eq(energieausweisOrdersTable.sessionId, session.id))
    .limit(1);
  if (!order) return "no_order";
  if (order.status === "refunded") return "not_paid";
  const email =
    session.customer_details?.email ??
    session.customer_email ??
    order.kontaktEmail ??
    null;
  if (!email) return "no_order";
  const ausweisLabel =
    order.ausweisTyp === "bedarf"
      ? "Energiebedarfsausweis"
      : "Energieverbrauchsausweis";
  return sendEnergieausweisOrderConfirmation({
    email,
    kontaktName: order.kontaktName ?? "Kunde",
    ausweisLabel,
    orderId: order.id,
  });
}
