import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  foerderschieneReportsTable,
  energieausweisOrdersTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { getUncachableStripeClient, STRIPE_CONFIG } from "../lib/stripeClient";
import {
  listProgramme,
  matchFoerderschiene,
  fulfillReport,
  fulfillEnergieausweis,
  deliverReportReadyEmail,
  deliverEnergieausweisConfirmationEmail,
  energieausweisPrice,
  REPORT_PRICE_CENTS,
  type MatchInput,
} from "../lib/foerderschiene";
import {
  createFinanceLeadsForPaidReport,
  enqueueFinanceLeadCreation,
} from "../lib/financeAffiliate";
import { foerderLeadsTable } from "@workspace/db";
import { SubmitFoerderFinderBody } from "@workspace/api-zod";
import { finderLimiter } from "../middlewares/rateLimit";
import { processFoerderFinderLead } from "../lib/foerderFinder";
import { and, gte, sql } from "drizzle-orm";

/**
 * Förderprogramm-Finder consent — snapshotted server-side (like the finance
 * consent above). Bump the version whenever the wording changes.
 */
const FINDER_CONSENT_VERSION = "1.0";
const FINDER_CONSENT_TEXT =
  "Ich willige ein, dass meine Angaben zur Erstellung und Zusendung der Förderanalyse verarbeitet werden. Die Einwilligung kann ich jederzeit mit Wirkung für die Zukunft widerrufen.";

/** Per-address cooldown between finder submissions (anti-harassment/spam). */
const FINDER_EMAIL_COOLDOWN_MS = 15 * 60 * 1000;

const router: IRouter = Router();

/**
 * Förder-Affiliate consent defaults — used when the client opts in but does not
 * send its own version/text. Bump the version whenever the wording changes so
 * each lead's snapshot proves exactly which consent the buyer agreed to.
 */
const FINANCE_CONSENT_VERSION = "1.0";
const FINANCE_CONSENT_TEXT =
  "Ich willige ein, dass meine Kontakt- und Gebäudedaten zur Erstellung unverbindlicher Finanzierungsangebote an passende Finanzierungspartner (Banken/Kreditinstitute) weitergegeben werden. Diese Einwilligung ist freiwillig und jederzeit mit Wirkung für die Zukunft widerrufbar.";

function getBaseUrl(req: import("express").Request): string {
  const host = req.get("host");
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  return `${proto}://${host}`;
}

router.get("/foerderschiene/programme", async (req, res): Promise<void> => {
  try {
    const programme = await listProgramme();
    res.json(programme);
  } catch (err) {
    req.log.error({ err }, "Failed to list foerder programme");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/foerderschiene/match", async (req, res): Promise<void> => {
  try {
    const body = (req.body ?? {}) as Partial<MatchInput>;
    const baujahr = Number(body.baujahr);
    const wohnflaeche = Number(body.wohnflaeche);
    if (!Number.isFinite(baujahr) || !Number.isFinite(wohnflaeche)) {
      res.status(400).json({ error: "baujahr und wohnflaeche sind erforderlich" });
      return;
    }
    const result = await matchFoerderschiene({
      baujahr,
      wohnflaeche,
      wohneinheiten:
        body.wohneinheiten != null ? Number(body.wohneinheiten) : null,
      heizung: String(body.heizung ?? ""),
      massnahmen: Array.isArray(body.massnahmen)
        ? body.massnahmen.map(String)
        : [],
      selbstgenutzt:
        typeof body.selbstgenutzt === "boolean" ? body.selbstgenutzt : null,
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to match foerderschiene");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/foerderschiene/report/checkout", async (req, res): Promise<void> => {
  try {
    // Guest Express-Checkout: a report can be bought without an account.
    // If the buyer happens to be signed in we still attach their userId.
    const { userId } = getAuth(req);
    const body = (req.body ?? {}) as {
      adresse?: unknown;
      profil?: unknown;
      kontakt?: unknown;
      financeConsent?: unknown;
    };
    if (!body.profil || typeof body.profil !== "object") {
      res.status(400).json({ error: "profil ist erforderlich" });
      return;
    }
    // Optional buyer Personalien (for registration / report assignment). All
    // fields optional; only used to prefill Stripe + store as metadata.
    const k =
      body.kontakt && typeof body.kontakt === "object"
        ? (body.kontakt as Record<string, unknown>)
        : {};
    const str = (v: unknown) => {
      const s = v != null ? String(v).trim() : "";
      return s.length > 0 ? s : undefined;
    };
    const kontakt = {
      vorname: str(k.vorname),
      nachname: str(k.nachname),
      email: str(k.email),
      telefon: str(k.telefon),
      anschrift: str(k.anschrift),
    };
    const kontaktName = [kontakt.vorname, kontakt.nachname]
      .filter(Boolean)
      .join(" ");
    // Förder-Affiliate: a SEPARATE, opt-in financing-offer consent. Only a
    // literal `true` counts. The consent proof (version + text + timestamp) is
    // snapshotted from SERVER-side constants only — client-supplied version/text
    // are never trusted, so the proof cannot be forged for a lawful audit record.
    const financeConsent = body.financeConsent === true;
    const financeConsentVersion = financeConsent ? FINANCE_CONSENT_VERSION : null;
    const financeConsentText = financeConsent ? FINANCE_CONSENT_TEXT : null;
    const stripe = await getUncachableStripeClient();
    if (!stripe) {
      res.status(503).json({
        error:
          "Stripe ist noch nicht verbunden. Bitte aktivieren Sie die Stripe-Integration im Replit-Workspace.",
      });
      return;
    }
    const adresse = body.adresse != null ? String(body.adresse) : null;
    const [report] = await db
      .insert(foerderschieneReportsTable)
      .values({
        userId: userId ?? null,
        status: "pending",
        amountCents: REPORT_PRICE_CENTS,
        adresse,
        profil: body.profil,
        email: kontakt.email ?? null,
        financeConsent,
        financeConsentAt: financeConsent ? new Date() : null,
        financeConsentVersion,
        financeConsentText,
      })
      .returning();

    const baseUrl = getBaseUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: STRIPE_CONFIG.currency,
            unit_amount: REPORT_PRICE_CENTS,
            product_data: {
              name: "Detaillierter Gebäudereport (PDF) – Förderschiene",
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/foerderschiene/report?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/foerderschiene/report?status=cancelled`,
      ...(kontakt.email ? { customer_email: kontakt.email } : {}),
      metadata: {
        kind: "foerderschiene_report",
        reportId: String(report.id),
        ...(userId ? { userId } : {}),
        ...(kontaktName ? { kontaktName } : {}),
        ...(kontakt.telefon ? { kontaktTelefon: kontakt.telefon } : {}),
        ...(kontakt.anschrift ? { kontaktAnschrift: kontakt.anschrift } : {}),
      },
    });

    await db
      .update(foerderschieneReportsTable)
      .set({ sessionId: session.id })
      .where(eq(foerderschieneReportsTable.id, report.id));

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    req.log.error({ err }, "Failed to create report checkout");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

router.post("/foerderschiene/report/reconcile", async (req, res): Promise<void> => {
  try {
    // Guest flow: possession of the Checkout sessionId is the only credential
    // needed to unlock + view the report (no account, no ownership check).
    const sessionId = String((req.body as { sessionId?: unknown })?.sessionId ?? "");
    if (!sessionId) {
      res.status(400).json({ error: "Missing sessionId" });
      return;
    }
    const [report] = await db
      .select()
      .from(foerderschieneReportsTable)
      .where(eq(foerderschieneReportsTable.sessionId, sessionId))
      .limit(1);
    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    const stripe = await getUncachableStripeClient();
    if (!stripe) {
      res.status(503).json({ error: "Stripe nicht konfiguriert" });
      return;
    }
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === "paid") {
      await fulfillReport(
        sessionId,
        typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
      );
      await deliverReportReadyEmail(session, getBaseUrl(req));
      // Förder-Affiliate: create + email consented finance leads (idempotent,
      // fire-and-forget). Runs after the report email so the buyer email is
      // persisted first; the durable work item is saved before detaching it so
      // a process restart cannot lose it.
      await enqueueFinanceLeadCreation(report.id);
      void createFinanceLeadsForPaidReport(report.id).catch((err) =>
        req.log.error(
          { err, reportId: report.id },
          "finance lead creation (reconcile) failed",
        ),
      );
    }
    const [fresh] = await db
      .select()
      .from(foerderschieneReportsTable)
      .where(eq(foerderschieneReportsTable.id, report.id))
      .limit(1);
    res.json(fresh ?? report);
  } catch (err) {
    req.log.error({ err }, "Failed to reconcile report");
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/foerderschiene/reports", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const reports = await db
      .select()
      .from(foerderschieneReportsTable)
      .where(eq(foerderschieneReportsTable.userId, userId))
      .orderBy(desc(foerderschieneReportsTable.createdAt));
    res.json(reports);
  } catch (err) {
    req.log.error({ err }, "Failed to list reports");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/foerderschiene/energieausweis/checkout",
  async (req, res): Promise<void> => {
    try {
      const { userId } = getAuth(req);
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const body = (req.body ?? {}) as {
        ausweisTyp?: unknown;
        kontaktName?: unknown;
        kontaktEmail?: unknown;
        intake?: unknown;
      };
      const ausweisTyp = String(body.ausweisTyp ?? "");
      const price = energieausweisPrice(ausweisTyp);
      if (!price) {
        res.status(400).json({ error: "Unbekannter Ausweistyp" });
        return;
      }
      const kontaktName = String(body.kontaktName ?? "").trim();
      const kontaktEmail = String(body.kontaktEmail ?? "").trim();
      if (!kontaktName || !kontaktEmail) {
        res
          .status(400)
          .json({ error: "Name und E-Mail des Kontakts sind erforderlich" });
        return;
      }
      if (!body.intake || typeof body.intake !== "object") {
        res.status(400).json({ error: "intake ist erforderlich" });
        return;
      }
      const stripe = await getUncachableStripeClient();
      if (!stripe) {
        res.status(503).json({
          error:
            "Stripe ist noch nicht verbunden. Bitte aktivieren Sie die Stripe-Integration im Replit-Workspace.",
        });
        return;
      }
      const baseUrl = getBaseUrl(req);
      const label =
        ausweisTyp === "bedarf"
          ? "Energiebedarfsausweis"
          : "Energieverbrauchsausweis";

      // Create the Stripe session BEFORE inserting the DB record so there is
      // never an orphaned order row without a sessionId if Stripe fails.
      let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
      try {
        session = await stripe.checkout.sessions.create({
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: STRIPE_CONFIG.currency,
                unit_amount: price,
                product_data: {
                  name: `${label} – Ausstellung durch zertifizierten Aussteller`,
                },
              },
              quantity: 1,
            },
          ],
          success_url: `${baseUrl}/foerderschiene/energieausweis?status=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${baseUrl}/foerderschiene/energieausweis?status=cancelled`,
          customer_email: kontaktEmail || undefined,
          metadata: {
            kind: "foerderschiene_energieausweis",
            userId,
          },
        });
      } catch (err) {
        req.log.error({ err }, "Failed to create energieausweis Stripe session");
        res.status(503).json({ error: "Failed to create checkout session" });
        return;
      }

      // Session is live — persist the order with sessionId set from the start
      // so there is never a window where the row exists without a sessionId.
      await db.insert(energieausweisOrdersTable).values({
        userId,
        ausweisTyp,
        status: "pending_payment",
        amountCents: price,
        kontaktName,
        kontaktEmail,
        intake: body.intake,
        sessionId: session.id,
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
      req.log.error({ err }, "Failed to create energieausweis checkout");
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  },
);

router.post(
  "/foerderschiene/energieausweis/reconcile",
  async (req, res): Promise<void> => {
    try {
      const { userId } = getAuth(req);
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const sessionId = String(
        (req.body as { sessionId?: unknown })?.sessionId ?? "",
      );
      if (!sessionId) {
        res.status(400).json({ error: "Missing sessionId" });
        return;
      }
      const [order] = await db
        .select()
        .from(energieausweisOrdersTable)
        .where(eq(energieausweisOrdersTable.sessionId, sessionId))
        .limit(1);
      if (!order || order.userId !== userId) {
        res.status(404).json({ error: "Order not found" });
        return;
      }
      const stripe = await getUncachableStripeClient();
      if (!stripe) {
        res.status(503).json({ error: "Stripe nicht konfiguriert" });
        return;
      }
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === "paid") {
        await fulfillEnergieausweis(
          sessionId,
          typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
        );
        await deliverEnergieausweisConfirmationEmail(session);
      }
      const [fresh] = await db
        .select()
        .from(energieausweisOrdersTable)
        .where(eq(energieausweisOrdersTable.id, order.id))
        .limit(1);
      res.json(fresh ?? order);
    } catch (err) {
      req.log.error({ err }, "Failed to reconcile energieausweis order");
      res.status(500).json({ error: "Failed" });
    }
  },
);

router.get(
  "/foerderschiene/energieausweis/orders",
  async (req, res): Promise<void> => {
    try {
      const { userId } = getAuth(req);
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const orders = await db
        .select()
        .from(energieausweisOrdersTable)
        .where(eq(energieausweisOrdersTable.userId, userId))
        .orderBy(desc(energieausweisOrdersTable.createdAt));
      res.json(orders);
    } catch (err) {
      req.log.error({ err }, "Failed to list energieausweis orders");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.post(
  "/foerderschiene/finder",
  finderLimiter,
  async (req, res): Promise<void> => {
    try {
      const parsed = SubmitFoerderFinderBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      const input = parsed.data;
      // GDPR: the analysis email may only be sent with explicit consent.
      if (input.dsgvoConsent !== true) {
        res.status(400).json({
          error:
            "Bitte stimmen Sie der Verarbeitung Ihrer Daten zu (DSGVO-Einwilligung).",
        });
        return;
      }
      const { name, email, telefon, dsgvoConsent: _c, ...wizard } = input;
      // Dedupe + cap massnahmen server-side so oversized bodies cannot
      // inflate the AI prompt.
      wizard.massnahmen = [...new Set(wizard.massnahmen)].slice(0, 6);

      // Per-address cooldown: one analysis email per address per 15 minutes.
      // Check + insert run in a transaction under a per-address advisory lock
      // so concurrent requests cannot both pass the check.
      const emailNorm = email.trim().toLowerCase();
      const lead = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${"foerder_finder:" + emailNorm}))`,
        );
        const [recent] = await tx
          .select({ id: foerderLeadsTable.id })
          .from(foerderLeadsTable)
          .where(
            and(
              eq(foerderLeadsTable.email, emailNorm),
              gte(
                foerderLeadsTable.createdAt,
                new Date(Date.now() - FINDER_EMAIL_COOLDOWN_MS),
              ),
            ),
          )
          .limit(1);
        if (recent) return null;

        // Store the lead FIRST so it can never be lost even if the AI
        // analysis or the email send fails afterwards.
        const [inserted] = await tx
          .insert(foerderLeadsTable)
          .values({
            name: name.trim(),
            email: emailNorm,
            telefon: telefon?.trim() || null,
            eingaben: wizard,
            emailStatus: "pending",
            consentVersion: FINDER_CONSENT_VERSION,
            consentText: FINDER_CONSENT_TEXT,
          })
          .returning();
        return inserted;
      });

      if (!lead) {
        res.status(429).json({
          error:
            "Für diese E-Mail-Adresse wurde gerade eine Analyse angefordert. Bitte prüfen Sie Ihr Postfach oder versuchen Sie es in einigen Minuten erneut.",
        });
        return;
      }

      // Generate + send in the background; the wizard shows a "check your
      // inbox" confirmation immediately. Failures are recorded on the lead
      // (emailStatus "failed") and surface in the admin dashboard.
      void processFoerderFinderLead(lead.id, {
        name: lead.name,
        email: lead.email,
        telefon: telefon?.trim() || undefined,
        gebaeudeTyp: input.gebaeudeTyp,
        baujahr: input.baujahr,
        massnahmen: input.massnahmen,
        eigennutzer: input.eigennutzer,
        bundesland: input.bundesland,
      }).catch((err) =>
        req.log.error({ err, leadId: lead.id }, "finder lead processing failed"),
      );

      res.status(201).json({ ok: true, leadId: lead.id });
    } catch (err) {
      req.log.error({ err }, "Failed to submit foerder finder");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
