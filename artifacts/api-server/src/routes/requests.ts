import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  requestsTable,
  requestOffersTable,
  providersTable,
  type Request as RfqRequest,
} from "@workspace/db";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import {
  CreateRequestBody,
  AccessRequestBody,
  AcceptRequestOfferBody,
  AcceptRequestOfferParams,
} from "@workspace/api-zod";
import { generateAccessToken, verifyAccessToken } from "../lib/requestAccessToken";
import { matchProvidersForRequest } from "../lib/requestMatching";
import { sendNewRequestToProvider } from "../lib/email";

const router: IRouter = Router();

function getBaseUrl(req: import("express").Request): string {
  const host = req.get("host");
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  return `${proto}://${host}`;
}

/**
 * Customer-facing request DTO (matches the OpenAPI `RfqRequest`). NEVER exposes
 * the access-token hash or the consent bookkeeping columns.
 */
function toRequestDto(r: RfqRequest) {
  return {
    id: r.id,
    customerId: r.customerId,
    customerName: r.customerName,
    customerEmail: r.customerEmail,
    customerPhone: r.customerPhone,
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
    maxOffers: r.maxOffers,
    status: r.status,
    createdAt: r.createdAt,
  };
}

/**
 * Authorize access to a request: either the logged-in owning customer, or a
 * valid guest bearer token. Returns the request row or null when unauthorized.
 */
async function authorizeRequest(
  requestId: number,
  userId: string | null | undefined,
  token: string | null | undefined,
): Promise<RfqRequest | null> {
  const [request] = await db
    .select()
    .from(requestsTable)
    .where(eq(requestsTable.id, requestId))
    .limit(1);
  if (!request) return null;
  const ownedByUser = !!userId && request.customerId === userId;
  const validToken = verifyAccessToken(token, request.accessTokenHash);
  return ownedByUser || validToken ? request : null;
}

/**
 * POST /requests — public. Create an open request (guest or logged in). Requires
 * explicit DSGVO consent. Returns the request, a one-time raw access token, and
 * how many providers were matched + notified.
 */
router.post("/requests", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    const parsed = CreateRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    if (d.consentDataShare !== true) {
      res
        .status(400)
        .json({ error: "Bitte stimmen Sie der Weitergabe Ihrer Anfrage an passende Anbieter zu." });
      return;
    }

    const { token, tokenHash } = generateAccessToken();

    const { request, matched } = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(requestsTable)
        .values({
          customerId: userId ?? null,
          customerName: d.customerName,
          customerEmail: d.customerEmail,
          customerPhone: d.customerPhone ?? null,
          categorySlug: d.categorySlug,
          serviceTemplateId: d.serviceTemplateId ?? null,
          title: d.title,
          description: d.description ?? null,
          answers: d.answers ?? null,
          postalCode: d.postalCode ?? null,
          city: d.city ?? null,
          budgetMinCents: d.budgetMinCents ?? null,
          budgetMaxCents: d.budgetMaxCents ?? null,
          urgency: d.urgency ?? "flexibel",
          fundingRelevant: d.fundingRelevant ?? false,
          maxOffers: d.maxOffers ?? 3,
          consentDataShare: true,
          consentTimestamp: new Date(),
          status: "open",
          accessTokenHash: tokenHash,
        })
        .returning();
      const matched = await matchProvidersForRequest(
        tx,
        created.id,
        created.categorySlug,
        created.postalCode,
      );
      return { request: created, matched };
    });

    // Notify matched providers (fire-and-forget; never block the response).
    const providerUrl = `${getBaseUrl(req)}/berater/anfragen`;
    for (const p of matched) {
      void sendNewRequestToProvider({
        providerEmail: p.email,
        providerName: p.displayName,
        requestTitle: request.title,
        city: request.city,
        categorySlug: request.categorySlug,
        requestUrl: providerUrl,
      }).catch((err) =>
        req.log.error({ err, providerId: p.id }, "new_request_provider email failed"),
      );
    }

    res
      .status(201)
      .json({ request: toRequestDto(request), accessToken: token, matchedProviders: matched.length });
  } catch (err) {
    req.log.error({ err }, "Failed to create request");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /requests/mine — the logged-in customer's own requests (newest first).
 */
router.get("/requests/mine", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Nicht angemeldet." });
      return;
    }
    const rows = await db
      .select()
      .from(requestsTable)
      .where(eq(requestsTable.customerId, userId))
      .orderBy(desc(requestsTable.createdAt));
    res.json(rows.map(toRequestDto));
  } catch (err) {
    req.log.error({ err }, "Failed to list my requests");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /requests/access — view a request and its offers. Authorized by the
 * owning customer (auth) OR a valid guest token. Offers include a public
 * provider summary so the customer can compare.
 */
router.post("/requests/access", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    const parsed = AccessRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const request = await authorizeRequest(parsed.data.requestId, userId, parsed.data.token);
    if (!request) {
      res.status(404).json({ error: "Anfrage nicht gefunden oder kein Zugriff." });
      return;
    }

    const offerRows = await db
      .select({
        offer: requestOffersTable,
        provider: {
          id: providersTable.id,
          displayName: providersTable.displayName,
          category: providersTable.category,
          city: providersTable.city,
          rating: providersTable.rating,
          reviewCount: providersTable.reviewCount,
          verified: providersTable.verified,
          subscriptionTier: providersTable.subscriptionTier,
        },
      })
      .from(requestOffersTable)
      .innerJoin(providersTable, eq(providersTable.id, requestOffersTable.providerId))
      .where(eq(requestOffersTable.requestId, request.id))
      .orderBy(desc(requestOffersTable.createdAt));

    const offers = offerRows.map(({ offer, provider }) => ({
      id: offer.id,
      requestId: offer.requestId,
      providerId: offer.providerId,
      priceCents: offer.priceCents,
      priceType: offer.priceType,
      message: offer.message,
      availableFrom: offer.availableFrom,
      estimatedDuration: offer.estimatedDuration,
      status: offer.status,
      createdAt: offer.createdAt,
      provider: {
        id: provider.id,
        displayName: provider.displayName,
        category: provider.category,
        city: provider.city,
        rating: provider.rating,
        reviewCount: provider.reviewCount,
        verified: provider.verified,
        subscriptionTier: provider.subscriptionTier,
        avatarUrl: null,
      },
    }));

    res.json({ request: toRequestDto(request), offers });
  } catch (err) {
    req.log.error({ err }, "Failed to access request");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /request-offers/{id}/accept — accept one offer. Authorized by the owning
 * customer (auth) OR a valid guest token. Marks the offer accepted, the request
 * fulfilled, and declines the other still-open offers.
 */
router.post("/request-offers/:id/accept", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    const params = AcceptRequestOfferParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = AcceptRequestOfferBody.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const [offer] = await db
      .select()
      .from(requestOffersTable)
      .where(eq(requestOffersTable.id, params.data.id))
      .limit(1);
    if (!offer) {
      res.status(404).json({ error: "Angebot nicht gefunden." });
      return;
    }

    const request = await authorizeRequest(offer.requestId, userId, body.data.token);
    if (!request) {
      res.status(404).json({ error: "Anfrage nicht gefunden oder kein Zugriff." });
      return;
    }

    let accepted;
    try {
      accepted = await db.transaction(async (tx) => {
        // Re-read request + offer under a row lock so two concurrent accepts
        // cannot both win (which would leave two accepted offers / a re-opened
        // fulfilled request). Authorization already happened above.
        const [lockedRequest] = await tx
          .select({ status: requestsTable.status })
          .from(requestsTable)
          .where(eq(requestsTable.id, request.id))
          .for("update")
          .limit(1);
        if (!lockedRequest) throw new Error("NOT_FOUND");
        if (!["open", "matched"].includes(lockedRequest.status)) throw new Error("NOT_OPEN");

        const [lockedOffer] = await tx
          .select({ status: requestOffersTable.status })
          .from(requestOffersTable)
          .where(eq(requestOffersTable.id, offer.id))
          .for("update")
          .limit(1);
        if (!lockedOffer) throw new Error("NOT_FOUND");
        if (!["sent", "viewed"].includes(lockedOffer.status)) throw new Error("OFFER_NOT_OPEN");

        const now = new Date();
        const [acceptedOffer] = await tx
          .update(requestOffersTable)
          .set({ status: "accepted", respondedAt: now, updatedAt: now })
          .where(eq(requestOffersTable.id, offer.id))
          .returning();
        await tx
          .update(requestsTable)
          .set({ status: "fulfilled", updatedAt: now })
          .where(eq(requestsTable.id, request.id));
        // Decline the remaining open offers on this request.
        await tx
          .update(requestOffersTable)
          .set({ status: "declined", respondedAt: now, updatedAt: now })
          .where(
            and(
              eq(requestOffersTable.requestId, request.id),
              ne(requestOffersTable.id, offer.id),
              inArray(requestOffersTable.status, ["sent", "viewed"]),
            ),
          );
        return acceptedOffer;
      });
    } catch (txErr) {
      const msg = txErr instanceof Error ? txErr.message : "";
      const map: Record<string, [number, string]> = {
        NOT_FOUND: [404, "Angebot nicht gefunden."],
        NOT_OPEN: [409, "Diese Anfrage ist bereits abgeschlossen."],
        OFFER_NOT_OPEN: [409, "Dieses Angebot kann nicht mehr angenommen werden."],
      };
      const hit = map[msg];
      if (hit) {
        res.status(hit[0]).json({ error: hit[1], code: msg });
        return;
      }
      throw txErr;
    }

    res.json({
      id: accepted.id,
      requestId: accepted.requestId,
      providerId: accepted.providerId,
      leadFeeId: accepted.leadFeeId,
      priceCents: accepted.priceCents,
      priceType: accepted.priceType,
      message: accepted.message,
      availableFrom: accepted.availableFrom,
      estimatedDuration: accepted.estimatedDuration,
      status: accepted.status,
      viewedAt: accepted.viewedAt,
      respondedAt: accepted.respondedAt,
      createdAt: accepted.createdAt,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to accept offer");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
