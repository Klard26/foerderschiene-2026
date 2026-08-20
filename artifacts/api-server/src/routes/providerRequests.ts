import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  requestsTable,
  requestMatchesTable,
  requestOffersTable,
  leadFeesTable,
  providersTable,
  categoriesTable,
  providerWalletTable,
  type Request as RfqRequest,
} from "@workspace/db";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import {
  CreateProviderOfferBody,
  CreateProviderOfferParams,
  GetProviderRequestParams,
  CreateWalletTopupBody,
  RefundLeadParams,
  RefundLeadBody,
} from "@workspace/api-zod";
import { getUncachableStripeClient, STRIPE_CONFIG } from "../lib/stripeClient";
import {
  canRespondToLead,
  incrementLeadUsage,
} from "../lib/leadEntitlements";
import { calcLeadPriceCents } from "../lib/leadPricing";
import {
  getCategoryClassification,
  normalizeWorld,
  allowsLead,
} from "../lib/providerClassification";
import { applyWalletMovement, ensureWallet, listWalletTransactions } from "../lib/wallet";
import { sendOfferReceivedToCustomer } from "../lib/email";
import { consumeFreeLead, countRemainingFreeLeads } from "../lib/leadGrants";

const router: IRouter = Router();

function getBaseUrl(req: import("express").Request): string {
  const host = req.get("host");
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  return `${proto}://${host}`;
}

type Provider = typeof providersTable.$inferSelect;

/** Resolve the provider that owns the current Clerk session, or null. */
async function getProviderForUser(userId: string): Promise<Provider | null> {
  const [provider] = await db
    .select()
    .from(providersTable)
    .where(eq(providersTable.clerkUserId, userId))
    .limit(1);
  return provider ?? null;
}

/**
 * Provider-facing request DTO. Contact details (name/email/phone) are
 * anonymized — only revealed once this provider has sent an offer (`hasOffered`).
 */
function toProviderRequestDto(
  r: RfqRequest,
  opts: {
    hasOffered: boolean;
    offerCount: number;
    leadFeeId: number | null;
    estimatedLeadPriceCents: number;
  },
) {
  const unlocked = opts.hasOffered;
  return {
    id: r.id,
    categorySlug: r.categorySlug,
    serviceTemplateId: r.serviceTemplateId,
    title: r.title,
    description: r.description,
    answers: r.answers,
    postalCode: r.postalCode,
    city: r.city,
    budgetMinCents: r.budgetMinCents,
    budgetMaxCents: r.budgetMaxCents,
    urgency: r.urgency,
    fundingRelevant: r.fundingRelevant,
    status: r.status,
    contactUnlocked: unlocked,
    hasOffered: opts.hasOffered,
    estimatedLeadPriceCents: opts.estimatedLeadPriceCents,
    leadFeeId: opts.leadFeeId,
    offerCount: opts.offerCount,
    customerName: unlocked ? r.customerName : null,
    customerEmail: unlocked ? r.customerEmail : null,
    customerPhone: unlocked ? r.customerPhone : null,
    createdAt: r.createdAt,
  };
}

/**
 * GET /providers/me/requests — the signed-in provider's matched inbox (open or
 * matched requests), anonymized until they have sent an offer.
 */
router.get("/providers/me/requests", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Nicht angemeldet." });
      return;
    }
    const provider = await getProviderForUser(userId);
    if (!provider) {
      res.status(404).json({ error: "Kein Anbieterprofil gefunden." });
      return;
    }

    const rows = await db
      .select({
        request: requestsTable,
        offerId: requestOffersTable.id,
        leadFeeId: requestOffersTable.leadFeeId,
        worldId: categoriesTable.worldId,
        categoryLeadPriceCents: categoriesTable.leadPriceCents,
      })
      .from(requestMatchesTable)
      .innerJoin(requestsTable, eq(requestsTable.id, requestMatchesTable.requestId))
      .leftJoin(
        requestOffersTable,
        and(
          eq(requestOffersTable.requestId, requestsTable.id),
          eq(requestOffersTable.providerId, provider.id),
        ),
      )
      .leftJoin(categoriesTable, eq(categoriesTable.slug, requestsTable.categorySlug))
      .where(
        and(
          eq(requestMatchesTable.providerId, provider.id),
          inArray(requestsTable.status, ["open", "matched"]),
        ),
      )
      .orderBy(desc(requestsTable.createdAt));

    // Total offer count per request (across all providers).
    const ids = rows.map((r) => r.request.id);
    const counts = new Map<number, number>();
    if (ids.length > 0) {
      const grouped = await db
        .select({ requestId: requestOffersTable.requestId, n: count() })
        .from(requestOffersTable)
        .where(inArray(requestOffersTable.requestId, ids))
        .groupBy(requestOffersTable.requestId);
      for (const g of grouped) counts.set(g.requestId, Number(g.n));
    }

    const dto = rows.map((r) =>
      toProviderRequestDto(r.request, {
        hasOffered: r.offerId != null,
        offerCount: counts.get(r.request.id) ?? 0,
        leadFeeId: r.leadFeeId ?? null,
        estimatedLeadPriceCents: calcLeadPriceCents({
          worldId: normalizeWorld(r.worldId),
          categoryLeadPriceCents: r.categoryLeadPriceCents,
        }),
      }),
    );
    res.json(dto);
  } catch (err) {
    req.log.error({ err }, "Failed to list provider requests");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /providers/me/requests/{requestId} — detail for a matched request. Marks
 * the match as viewed. 404 unless this provider is matched to the request.
 */
router.get("/providers/me/requests/:requestId", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Nicht angemeldet." });
      return;
    }
    const provider = await getProviderForUser(userId);
    if (!provider) {
      res.status(404).json({ error: "Kein Anbieterprofil gefunden." });
      return;
    }
    const params = GetProviderRequestParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [matched] = await db
      .select({ request: requestsTable })
      .from(requestMatchesTable)
      .innerJoin(requestsTable, eq(requestsTable.id, requestMatchesTable.requestId))
      .where(
        and(
          eq(requestMatchesTable.providerId, provider.id),
          eq(requestMatchesTable.requestId, params.data.requestId),
        ),
      )
      .limit(1);
    if (!matched) {
      res.status(404).json({ error: "Anfrage nicht gefunden." });
      return;
    }

    // Mark the match as viewed (best effort).
    await db
      .update(requestMatchesTable)
      .set({ viewedAt: new Date() })
      .where(
        and(
          eq(requestMatchesTable.providerId, provider.id),
          eq(requestMatchesTable.requestId, params.data.requestId),
        ),
      );

    const [ownOffer] = await db
      .select({ id: requestOffersTable.id, leadFeeId: requestOffersTable.leadFeeId })
      .from(requestOffersTable)
      .where(
        and(
          eq(requestOffersTable.requestId, matched.request.id),
          eq(requestOffersTable.providerId, provider.id),
        ),
      )
      .limit(1);
    const [{ n: offerCount } = { n: 0 }] = await db
      .select({ n: count() })
      .from(requestOffersTable)
      .where(eq(requestOffersTable.requestId, matched.request.id));

    const classification = await getCategoryClassification(matched.request.categorySlug);
    res.json(
      toProviderRequestDto(matched.request, {
        hasOffered: !!ownOffer,
        offerCount: Number(offerCount),
        leadFeeId: ownOffer?.leadFeeId ?? null,
        estimatedLeadPriceCents: calcLeadPriceCents({
          worldId: classification.worldId,
          categoryLeadPriceCents: classification.leadPriceCents,
        }),
      }),
    );
  } catch (err) {
    req.log.error({ err }, "Failed to get provider request");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /providers/me/requests/{requestId}/offers — send a binding offer. Charges
 * the server-computed lead fee from the wallet inside one transaction (lock
 * request, enforce category + max-offers + monthly cap, debit wallet, write
 * lead_fee + offer, bump usage, auto-close at cap). Pricing is server-side only.
 */
router.post("/providers/me/requests/:requestId/offers", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Nicht angemeldet." });
      return;
    }
    const provider = await getProviderForUser(userId);
    if (!provider) {
      res.status(404).json({ error: "Kein Anbieterprofil gefunden." });
      return;
    }
    const params = CreateProviderOfferParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = CreateProviderOfferBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const d = body.data;

    // Monthly lead-cap gate (premium is unlimited).
    const gate = await canRespondToLead(provider.id, provider.subscriptionTier);
    if (!gate.allowed) {
      res.status(403).json({ error: gate.reason, upgradeRequired: true });
      return;
    }

    let result;
    try {
      result = await db.transaction(async (tx) => {
        const [request] = await tx
          .select()
          .from(requestsTable)
          .where(eq(requestsTable.id, params.data.requestId))
          .for("update")
          .limit(1);
        if (!request) throw new Error("NOT_FOUND");
        if (!["open", "matched"].includes(request.status)) throw new Error("NOT_OPEN");
        if (request.categorySlug !== provider.categorySlug) throw new Error("WRONG_CATEGORY");

        // Only a provider actually matched to this request may offer (and thereby
        // unlock its contact PII). Request ids are enumerable, so without this
        // gate any same-category provider could buy a lead — and reveal the
        // customer's contact details — for a request they were never matched to.
        const [match] = await tx
          .select({ id: requestMatchesTable.id })
          .from(requestMatchesTable)
          .where(
            and(
              eq(requestMatchesTable.requestId, request.id),
              eq(requestMatchesTable.providerId, provider.id),
            ),
          )
          .limit(1);
        if (!match) throw new Error("NOT_MATCHED");

        const [existing] = await tx
          .select({ id: requestOffersTable.id })
          .from(requestOffersTable)
          .where(
            and(
              eq(requestOffersTable.requestId, request.id),
              eq(requestOffersTable.providerId, provider.id),
            ),
          )
          .limit(1);
        if (existing) throw new Error("ALREADY_OFFERED");

        const [{ n: offerCount } = { n: 0 }] = await tx
          .select({ n: count() })
          .from(requestOffersTable)
          .where(eq(requestOffersTable.requestId, request.id));
        if (Number(offerCount) >= request.maxOffers) throw new Error("MAX_OFFERS");

        // Model B + world-aware lead price: resolve the request's category world
        // and pricing model. Lead/hybrid categories charge the world lead fee;
        // now-only categories reject (they monetize via booking commission).
        const [cat] = await tx
          .select({
            worldId: categoriesTable.worldId,
            pricingModel: categoriesTable.pricingModel,
            leadPriceCents: categoriesTable.leadPriceCents,
          })
          .from(categoriesTable)
          .where(eq(categoriesTable.slug, request.categorySlug))
          .limit(1);
        if (!allowsLead(cat?.pricingModel ?? null)) throw new Error("WRONG_MODEL");
        const leadFeeCents = calcLeadPriceCents({
          worldId: normalizeWorld(cat?.worldId),
          categoryLeadPriceCents: cat?.leadPriceCents ?? null,
        });
        const basePriceCents = leadFeeCents;

        // Free leads first: consume a free-lead grant (Basic welcome bonus or
        // Premium allotment) BEFORE touching the wallet. When one is available
        // the lead is free (chargedCents 0, no wallet movement); otherwise we
        // debit the wallet as usual (throws INSUFFICIENT_FUNDS on overdraw).
        const grantId = await consumeFreeLead(tx, provider.id);
        const freeLeadUsed = grantId !== null;
        const chargedCents = freeLeadUsed ? 0 : leadFeeCents;

        let walletBalanceCents: number;
        if (freeLeadUsed) {
          const [wallet] = await tx
            .select({ balanceCents: providerWalletTable.balanceCents })
            .from(providerWalletTable)
            .where(eq(providerWalletTable.providerId, provider.id))
            .limit(1);
          walletBalanceCents = wallet?.balanceCents ?? 0;
        } else {
          walletBalanceCents = await applyWalletMovement(tx, provider.id, {
            type: "lead_charge",
            amountCents: -leadFeeCents,
            referenceId: request.id,
            note: `Lead-Gebühr für Anfrage #${request.id}`,
          });
        }

        const [leadFee] = await tx
          .insert(leadFeesTable)
          .values({
            providerId: provider.id,
            requestId: request.id,
            amountCents: chargedCents,
            currency: STRIPE_CONFIG.currency,
            paidFromCredit: !freeLeadUsed,
            leadGrantId: grantId,
            status: "paid",
          })
          .returning();

        const [offer] = await tx
          .insert(requestOffersTable)
          .values({
            requestId: request.id,
            providerId: provider.id,
            leadFeeId: leadFee.id,
            priceCents: d.priceCents,
            priceType: d.priceType ?? "fixed",
            message: d.message ?? null,
            availableFrom: d.availableFrom ?? null,
            estimatedDuration: d.estimatedDuration ?? null,
            status: "sent",
          })
          .returning();

        await incrementLeadUsage(tx, provider.id);

        // Auto-close the request once the offer cap is reached.
        if (Number(offerCount) + 1 >= request.maxOffers && request.status === "open") {
          await tx
            .update(requestsTable)
            .set({ status: "matched", updatedAt: new Date() })
            .where(eq(requestsTable.id, request.id));
        }

        return {
          offer,
          leadFeeCents: chargedCents,
          basePriceCents,
          walletBalanceCents,
          freeLeadUsed,
          request,
        };
      });
    } catch (txErr) {
      const msg = txErr instanceof Error ? txErr.message : "";
      const map: Record<string, [number, string]> = {
        NOT_FOUND: [404, "Anfrage nicht gefunden."],
        NOT_OPEN: [409, "Diese Anfrage nimmt keine Angebote mehr an."],
        WRONG_CATEGORY: [403, "Diese Anfrage gehört nicht zu Ihrer Kategorie."],
        WRONG_MODEL: [403, "Diese Kategorie nimmt keine bezahlten Leads an."],
        NOT_MATCHED: [403, "Diese Anfrage wurde Ihnen nicht zugewiesen."],
        ALREADY_OFFERED: [409, "Sie haben auf diese Anfrage bereits ein Angebot abgegeben."],
        MAX_OFFERS: [409, "Diese Anfrage hat bereits die maximale Anzahl an Angeboten."],
        INSUFFICIENT_FUNDS: [
          402,
          "Ihr Lead-Guthaben reicht für diese Anfrage nicht aus. Bitte laden Sie Ihr Guthaben auf.",
        ],
      };
      const hit = map[msg];
      if (hit) {
        res.status(hit[0]).json({ error: hit[1], code: msg });
        return;
      }
      throw txErr;
    }

    // Notify the customer (fire-and-forget).
    const customerUrl = `${getBaseUrl(req)}/meine-anfragen?requestId=${result.request.id}`;
    void sendOfferReceivedToCustomer({
      customerEmail: result.request.customerEmail,
      customerName: result.request.customerName,
      requestTitle: result.request.title,
      providerName: provider.displayName,
      priceCents: result.offer.priceCents,
      message: result.offer.message,
      requestUrl: customerUrl,
    }).catch((err) => req.log.error({ err }, "offer_received email failed"));

    // Free leads remaining AFTER this offer — surfaced so the UI can show the
    // provider their remaining allotment without a second request.
    const freeLeadsRemaining = await countRemainingFreeLeads(provider.id);

    res.status(201).json({
      offer: {
        id: result.offer.id,
        requestId: result.offer.requestId,
        providerId: result.offer.providerId,
        leadFeeId: result.offer.leadFeeId,
        priceCents: result.offer.priceCents,
        priceType: result.offer.priceType,
        message: result.offer.message,
        availableFrom: result.offer.availableFrom,
        estimatedDuration: result.offer.estimatedDuration,
        status: result.offer.status,
        viewedAt: result.offer.viewedAt,
        respondedAt: result.offer.respondedAt,
        createdAt: result.offer.createdAt,
      },
      leadFeeCents: result.leadFeeCents,
      basePriceCents: result.basePriceCents,
      freeLeadUsed: result.freeLeadUsed,
      freeLeadsRemaining,
      tier: gate.entitlements.tier,
      walletBalanceCents: result.walletBalanceCents,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create provider offer");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /providers/me/wallet — wallet balance, recent ledger, and tier
 * entitlements (incl. this period's lead usage).
 */
router.get("/providers/me/wallet", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Nicht angemeldet." });
      return;
    }
    const provider = await getProviderForUser(userId);
    if (!provider) {
      res.status(404).json({ error: "Kein Anbieterprofil gefunden." });
      return;
    }

    const balanceCents = await ensureWallet(provider.id);
    const gate = await canRespondToLead(provider.id, provider.subscriptionTier);
    const transactions = await listWalletTransactions(provider.id);
    const freeLeadsRemaining = await countRemainingFreeLeads(provider.id);

    res.json({
      balanceCents,
      currency: STRIPE_CONFIG.currency,
      entitlements: {
        tier: gate.entitlements.tier,
        maxLeadsMonth: gate.entitlements.maxLeadsMonth,
        leadsUsed: gate.leadsUsed,
        leadDiscountPct: gate.entitlements.leadDiscountPct,
        rankingBoost: gate.entitlements.rankingBoost,
        freeLeadsRemaining,
      },
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amountCents: t.amountCents,
        balanceAfterCents: t.balanceAfterCents,
        referenceId: t.referenceId,
        note: t.note,
        createdAt: t.createdAt,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get wallet");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /providers/me/wallet/topup — create a Stripe Checkout session to top up
 * the lead wallet. The wallet is credited by the webhook (metadata.kind =
 * wallet_topup) so a successful payment is the source of truth.
 */
router.post("/providers/me/wallet/topup", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Nicht angemeldet." });
      return;
    }
    const provider = await getProviderForUser(userId);
    if (!provider) {
      res.status(404).json({ error: "Kein Anbieterprofil gefunden." });
      return;
    }
    const body = CreateWalletTopupBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const stripe = await getUncachableStripeClient();
    if (!stripe) {
      res.status(503).json({ error: "Zahlungsdienst derzeit nicht verfügbar." });
      return;
    }
    await ensureWallet(provider.id);

    const baseUrl = getBaseUrl(req);
    const amountCents = body.data.amountCents;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: STRIPE_CONFIG.currency,
            unit_amount: amountCents,
            product_data: { name: "Klard Lead-Guthaben" },
          },
        },
      ],
      metadata: {
        kind: "wallet_topup",
        providerId: String(provider.id),
        amountCents: String(amountCents),
      },
      success_url: `${baseUrl}/berater/wallet?topup=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/berater/wallet?topup=cancel`,
    });

    if (!session.url) {
      res.status(502).json({ error: "Checkout-Session konnte nicht erstellt werden." });
      return;
    }
    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    req.log.error({ err }, "Failed to create wallet topup");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /leads/{leadFeeId}/refund — Lead-Garantie. Refunds a paid lead fee back
 * to the provider's wallet. Provider-owner only (IDOR-guarded: the lead fee must
 * belong to the calling provider). Idempotent-safe: a refunded fee is rejected.
 */
router.post("/leads/:leadFeeId/refund", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Nicht angemeldet." });
      return;
    }
    const provider = await getProviderForUser(userId);
    if (!provider) {
      res.status(404).json({ error: "Kein Anbieterprofil gefunden." });
      return;
    }
    const params = RefundLeadParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = RefundLeadBody.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    let result;
    try {
      result = await db.transaction(async (tx) => {
        const [leadFee] = await tx
          .select()
          .from(leadFeesTable)
          .where(eq(leadFeesTable.id, params.data.leadFeeId))
          .for("update")
          .limit(1);
        if (!leadFee) throw new Error("NOT_FOUND");
        if (leadFee.providerId !== provider.id) throw new Error("FORBIDDEN");
        if (leadFee.status === "refunded") throw new Error("ALREADY_REFUNDED");

        // Lead-Garantie covers unusable leads, not ones that already converted:
        // if the provider's offer on this lead was accepted, deny the refund so a
        // won lead cannot be reclaimed for free.
        const [linkedOffer] = await tx
          .select({ status: requestOffersTable.status })
          .from(requestOffersTable)
          .where(eq(requestOffersTable.leadFeeId, leadFee.id))
          .limit(1);
        if (linkedOffer?.status === "accepted") throw new Error("LEAD_CONVERTED");

        // Free leads (paid from a grant, amountCents 0) cost the provider
        // nothing, so the Lead-Garantie has nothing to refund: mark it refunded
        // for bookkeeping but move no money and do NOT re-credit the grant.
        if (leadFee.amountCents <= 0) {
          const [wallet] = await tx
            .select({ balanceCents: providerWalletTable.balanceCents })
            .from(providerWalletTable)
            .where(eq(providerWalletTable.providerId, provider.id))
            .limit(1);
          await tx
            .update(leadFeesTable)
            .set({
              status: "refunded",
              refundReason: body.data.reason ?? "Lead-Garantie",
            })
            .where(eq(leadFeesTable.id, leadFee.id));
          return { refundedCents: 0, balanceCents: wallet?.balanceCents ?? 0 };
        }

        const balanceCents = await applyWalletMovement(tx, provider.id, {
          type: "refund",
          amountCents: leadFee.amountCents,
          referenceId: leadFee.requestId,
          note: `Lead-Garantie Erstattung für Anfrage #${leadFee.requestId}`,
        });
        await tx
          .update(leadFeesTable)
          .set({
            status: "refunded",
            refundReason: body.data.reason ?? "Lead-Garantie",
          })
          .where(eq(leadFeesTable.id, leadFee.id));
        return { refundedCents: leadFee.amountCents, balanceCents };
      });
    } catch (txErr) {
      const msg = txErr instanceof Error ? txErr.message : "";
      const map: Record<string, [number, string]> = {
        NOT_FOUND: [404, "Lead-Gebühr nicht gefunden."],
        FORBIDDEN: [403, "Diese Lead-Gebühr gehört nicht zu Ihrem Konto."],
        ALREADY_REFUNDED: [409, "Diese Lead-Gebühr wurde bereits erstattet."],
        LEAD_CONVERTED: [409, "Ein angenommener Lead kann nicht erstattet werden."],
      };
      const hit = map[msg];
      if (hit) {
        res.status(hit[0]).json({ error: hit[1], code: msg });
        return;
      }
      throw txErr;
    }

    res.json({ ok: true, refundedCents: result.refundedCents, balanceCents: result.balanceCents });
  } catch (err) {
    req.log.error({ err }, "Failed to refund lead");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
