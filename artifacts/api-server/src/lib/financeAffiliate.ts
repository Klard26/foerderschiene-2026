import { db } from "@workspace/db";
import {
  foerderschieneReportsTable,
  financePartnersTable,
  financeLeadsTable,
  type FinancePartner,
  type FinanceLead,
} from "@workspace/db";
import { eq, and, isNull, lte, or, sql } from "drizzle-orm";
import { logger } from "./logger";
import { matchFoerderschiene, type MassnahmeEstimate } from "./foerderschiene";
import { sendFinanceLeadToPartner, wasEmailSent } from "./email";

/**
 * Förder-Affiliate — the 5th revenue stream. ADDITIVE to the booking
 * marketplace; it never touches commissions or provider tiers.
 *
 * When a funding-relevant Gebäudereport is PAID and its buyer gave a SEPARATE,
 * timestamped financing-offer consent, we match active finance partners by
 * region/PLZ + estimated investment, create exactly one idempotent lead per
 * (report, partner), email each matched partner once, and track a fixed
 * per-lead fee as revenue. NO lead is ever created or shared without an active
 * (non-revoked) consent.
 *
 * The consent proof (version + text + timestamp) and everything the partner
 * needs (buyer contact, building profile, recommended measures, estimated
 * investment) are snapshotted onto each lead at creation, so a lead stays a
 * complete, lawful audit record even if the report or partner later changes.
 */

/**
 * Estimate the total project investment (in cents) for a building profile from
 * the recommended measures. Prefers the à-la-carte sum of Einzelmaßnahmen;
 * falls back to the largest Komplettsanierung when no single measures apply.
 */
function estimateInvestmentCents(massnahmen: MassnahmeEstimate[]): number {
  const mid = (m: MassnahmeEstimate) => (m.kostenMin + m.kostenMax) / 2;
  const einzelSum = massnahmen
    .filter((m) => m.art === "einzelmassnahme")
    .reduce((sum, m) => sum + mid(m), 0);
  const komplettMid = massnahmen
    .filter((m) => m.art === "komplettsanierung")
    .reduce((max, m) => Math.max(max, mid(m)), 0);
  return Math.round(Math.max(einzelSum, komplettMid) * 100);
}

/**
 * Geo eligibility (P1): a partner with PLZ prefixes matches only when the
 * report PLZ starts with one of them. A partner without PLZ prefixes matches
 * only when it is nationwide (regions empty or contains "bundesweit") — a
 * region-restricted partner must therefore also set PLZ prefixes to match,
 * because the building profile carries a PLZ but no Bundesland (fail-closed).
 */
function geoMatches(partner: FinancePartner, plz: string): boolean {
  const prefixes = partner.postalPrefixes ?? [];
  if (prefixes.length > 0) {
    if (!plz) return false;
    return prefixes.some((pre) => plz.startsWith(pre));
  }
  const regions = partner.regions ?? [];
  return regions.length === 0 || regions.includes("bundesweit");
}

function investmentMatches(partner: FinancePartner, estCents: number): boolean {
  if (partner.minInvestmentCents != null && estCents < partner.minInvestmentCents)
    return false;
  if (partner.maxInvestmentCents != null && estCents > partner.maxInvestmentCents)
    return false;
  return true;
}

/**
 * Persist the initial work item before starting asynchronous finance-lead
 * processing. If the process exits after acknowledging Stripe, the scheduler
 * will still discover and process this report after restart.
 */
export async function enqueueFinanceLeadCreation(reportId: number): Promise<void> {
  await db
    .update(foerderschieneReportsTable)
    .set({
      financeLeadRetryAt: new Date(),
      financeLeadLastError: null,
    })
    .where(
      and(
        eq(foerderschieneReportsTable.id, reportId),
        eq(foerderschieneReportsTable.status, "paid"),
        eq(foerderschieneReportsTable.financeConsent, true),
        isNull(foerderschieneReportsTable.financeConsentRevokedAt),
      ),
    );
}

/**
 * Create finance leads for a paid + consented report, idempotently, then email
 * each newly matched partner once. Safe to call from BOTH the success-page
 * reconcile and the Stripe webhook; re-running never duplicates a lead row or a
 * partner email. Returns the number of leads created on this pass.
 *
 * Fire-and-forget at the call sites — a partner-email or matching failure must
 * never block report fulfillment or the webhook ack. The caller persists the
 * initial work item first; later failures postpone that durable work item.
 */
export async function createFinanceLeadsForPaidReport(
  reportId: number,
): Promise<number> {
  try {
    const created = await createFinanceLeadsForPaidReportOnce(reportId);
    await clearFinanceLeadRetry(reportId);
    return created;
  } catch (err) {
    await recordFinanceLeadCreationFailure(reportId, err);
    throw err;
  }
}

async function createFinanceLeadsForPaidReportOnce(
  reportId: number,
): Promise<number> {
  const [report] = await db
    .select()
    .from(foerderschieneReportsTable)
    .where(eq(foerderschieneReportsTable.id, reportId))
    .limit(1);
  if (!report) return 0;

  // Consent gate — fail-closed. A lead is only ever created while the buyer's
  // financing-offer consent is present AND not revoked, the report is paid, and
  // we have a buyer email to hand to the partner.
  if (report.status !== "paid") return 0;
  if (!report.financeConsent) return 0;
  if (!report.financeConsentAt) return 0;
  if (report.financeConsentRevokedAt) return 0;
  if (!report.email) return 0;

  const profil = (report.profil ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const baujahr = num(profil["baujahr"]);
  const wohnflaeche = num(profil["wohnflaeche"]);
  const wohneinheiten =
    profil["wohneinheiten"] != null ? num(profil["wohneinheiten"]) : null;
  const heizung = String(profil["heizung"] ?? "");
  const plz = String(profil["plz"] ?? "").trim();

  const match = await matchFoerderschiene({
    baujahr,
    wohnflaeche,
    wohneinheiten,
    heizung,
    massnahmen: [],
    selbstgenutzt: null,
  });
  const estCents = estimateInvestmentCents(match.massnahmen);

  const result = await db.transaction(async (tx) => {
    // Re-read under a row lock immediately before creating/shareable lead
    // snapshots. A consent revocation waits for this short transaction, so an
    // already-revoked consent can never result in a new lead row.
    const [lockedReport] = await tx
      .select()
      .from(foerderschieneReportsTable)
      .where(eq(foerderschieneReportsTable.id, report.id))
      .for("update")
      .limit(1);
    if (
      !lockedReport ||
      lockedReport.status !== "paid" ||
      !lockedReport.financeConsent ||
      !lockedReport.financeConsentAt ||
      lockedReport.financeConsentRevokedAt ||
      !lockedReport.email
    ) {
      return { created: 0, shouldEmail: false };
    }

    // Only funding-relevant reports (with a real investment) generate leads.
    if (estCents <= 0) {
      await tx
        .update(foerderschieneReportsTable)
        .set({ financeLeadProcessedAt: new Date() })
        .where(eq(foerderschieneReportsTable.id, lockedReport.id));
      return { created: 0, shouldEmail: false };
    }

    const partners = await tx
      .select()
      .from(financePartnersTable)
      .where(eq(financePartnersTable.active, true));
    const matched = partners.filter(
      (p) => geoMatches(p, plz) && investmentMatches(p, estCents),
    );

    let created = 0;
    for (const partner of matched) {
      const [inserted] = await tx
        .insert(financeLeadsTable)
        .values({
          reportId: lockedReport.id,
          partnerId: partner.id,
          status: "created",
          feeCents: partner.feePerLeadCents,
          estimatedInvestmentCents: estCents,
          buyerEmail: lockedReport.email,
          buyerName: null,
          adresse: lockedReport.adresse,
          postalCode: plz || null,
          region: null,
          profil: lockedReport.profil,
          massnahmen: match.massnahmen,
          consentVersion: lockedReport.financeConsentVersion,
          consentText: lockedReport.financeConsentText,
          consentAt: lockedReport.financeConsentAt,
        })
        .onConflictDoNothing({
          target: [financeLeadsTable.reportId, financeLeadsTable.partnerId],
        })
        .returning();
      if (inserted) created += 1;
    }

    await tx
      .update(foerderschieneReportsTable)
      .set({ financeLeadProcessedAt: new Date() })
      .where(eq(foerderschieneReportsTable.id, lockedReport.id));
    return { created, shouldEmail: true };
  });

  // Email after inserts commit so a retry only ever sends still-unsent leads.
  // Failure here propagates to the durable retry path; retry state is cleared
  // only after every pending partner email succeeds.
  if (result.shouldEmail) await emailPendingLeadsForReport(report.id);
  return result.created;
}

const FINANCE_LEAD_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_ERROR_LENGTH = 1_000;

/**
 * Store a failed asynchronous creation pass on the report itself. This is
 * intentionally best effort: if the database is unavailable there is nowhere
 * durable to write, but the initial work item was already persisted before the
 * asynchronous pass began and remains available for a future scheduler tick.
 */
async function recordFinanceLeadCreationFailure(
  reportId: number,
  error: unknown,
): Promise<void> {
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  try {
    await db
      .update(foerderschieneReportsTable)
      .set({
        financeLeadRetryAt: new Date(Date.now() + FINANCE_LEAD_RETRY_DELAY_MS),
        financeLeadRetryCount: sql`${foerderschieneReportsTable.financeLeadRetryCount} + 1`,
        financeLeadLastError: message.slice(0, MAX_RETRY_ERROR_LENGTH),
      })
      .where(eq(foerderschieneReportsTable.id, reportId));
  } catch (recordErr) {
    logger.error(
      { err: recordErr, originalErr: error, reportId },
      "finance lead creation failed and retry state could not be recorded",
    );
  }
}

async function clearFinanceLeadRetry(reportId: number): Promise<void> {
  await db
    .update(foerderschieneReportsTable)
    .set({
      financeLeadRetryAt: null,
      financeLeadLastError: null,
    })
    .where(eq(foerderschieneReportsTable.id, reportId));
}

/**
 * Email every still-"created" lead of a report to its partner exactly once.
 *
 * Claim-then-send: the report row is locked while a lead is claimed, its
 * consent is re-checked, and the email is submitted. This makes revocation and
 * email handoff serial: a revocation either wins before the claim (no email)
 * or waits until that in-progress consented handoff finishes.
 *
 * A hard crash leaves the lead in "sending". Stale claims are recovered after
 * five minutes: the email log identifies already-sent messages without
 * resending them; otherwise the lead is reclaimed. The report retry is only
 * cleared once no created/sending lead remains.
 */
async function emailPendingLeadsForReport(reportId: number): Promise<void> {
  const staleBefore = new Date(Date.now() - 5 * 60_000);
  const rows = await db
    .select({ lead: financeLeadsTable, partner: financePartnersTable })
    .from(financeLeadsTable)
    .innerJoin(
      financePartnersTable,
      eq(financeLeadsTable.partnerId, financePartnersTable.id),
    )
    .where(
      and(
        eq(financeLeadsTable.reportId, reportId),
        or(
          eq(financeLeadsTable.status, "created"),
          and(
            eq(financeLeadsTable.status, "sending"),
            lte(financeLeadsTable.updatedAt, staleBefore),
          ),
        ),
      ),
    );

  for (const { lead, partner } of rows) {
    try {
      await db.transaction(async (tx) => {
        const [report] = await tx
          .select({ id: foerderschieneReportsTable.id })
          .from(foerderschieneReportsTable)
          .where(eq(foerderschieneReportsTable.id, reportId))
          .for("update")
          .limit(1);
        if (!report) return;

        const [current] = await tx
          .select({
            id: financeLeadsTable.id,
            status: financeLeadsTable.status,
            updatedAt: financeLeadsTable.updatedAt,
          })
          .from(financeLeadsTable)
          .where(eq(financeLeadsTable.id, lead.id))
          .for("update")
          .limit(1);
        if (!current) return;

        // Re-check consent while the report row is locked. A concurrent
        // revocation cannot slip between this check and the email handoff.
        const [activeReport] = await tx
          .select({ id: foerderschieneReportsTable.id })
          .from(foerderschieneReportsTable)
          .where(
            and(
              eq(foerderschieneReportsTable.id, reportId),
              eq(foerderschieneReportsTable.status, "paid"),
              eq(foerderschieneReportsTable.financeConsent, true),
              isNull(foerderschieneReportsTable.financeConsentRevokedAt),
            ),
          )
          .limit(1);
        if (!activeReport) return;

        // A completed email is authoritative even if a process crashed before
        // it could advance the finance lead's local status.
        if (await wasEmailSent("finance_lead_partner", current.id)) {
          await tx
            .update(financeLeadsTable)
            .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
            .where(eq(financeLeadsTable.id, current.id));
          return;
        }

        // A live claim belongs to another worker. A stale one is safely
        // reclaimed here under the same lead/report locks.
        if (
          current.status === "sending" &&
          current.updatedAt.getTime() > staleBefore.getTime()
        ) {
          return;
        }
        if (current.status !== "created" && current.status !== "sending") return;

        await tx
          .update(financeLeadsTable)
          .set({ status: "sending", updatedAt: new Date() })
          .where(eq(financeLeadsTable.id, current.id));

        await sendFinanceLeadToPartner({
          partnerEmail: partner.contactEmail,
          partnerName: partner.name,
          buyerEmail: lead.buyerEmail,
          adresse: lead.adresse,
          postalCode: lead.postalCode,
          estimatedInvestmentCents: lead.estimatedInvestmentCents,
          massnahmen: (lead.massnahmen as MassnahmeEstimate[] | null) ?? [],
          leadId: lead.id,
        });
        if (!(await wasEmailSent("finance_lead_partner", current.id))) {
          throw new Error("finance lead partner email was not confirmed as sent");
        }
        await tx
          .update(financeLeadsTable)
          .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
          .where(eq(financeLeadsTable.id, current.id));
      });
    } catch (err) {
      logger.error(
        { err, leadId: lead.id },
        "finance lead partner email failed",
      );
      throw err;
    }
  }

  const [unsent] = await db
    .select({ id: financeLeadsTable.id })
    .from(financeLeadsTable)
    .where(
      and(
        eq(financeLeadsTable.reportId, reportId),
        or(
          eq(financeLeadsTable.status, "created"),
          eq(financeLeadsTable.status, "sending"),
        ),
      ),
    )
    .limit(1);
  if (unsent) {
    throw new Error(`finance lead ${unsent.id} is still awaiting partner delivery`);
  }
}

export type { FinanceLead, FinancePartner };
