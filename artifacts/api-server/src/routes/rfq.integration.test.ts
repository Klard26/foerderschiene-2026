import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Integration tests for the Pay-per-Lead (RfQ) marketplace routes:
//   - requests.ts          (public create + guest/owner offer view + accept)
//   - providerRequests.ts  (provider inbox, send offer w/ wallet charge, refund)
//
// These exercise the real route handlers and their DB writes against the live
// development Postgres. Only the external edges are mocked:
//   - Clerk auth (getAuth → the authenticated user; we flip the userId per test
//     to act as a guest, provider 1, provider 2, or a broke provider),
//   - the fire-and-forget notification emails (so no real mail is sent).
//
// The riskiest behaviours are asserted directly: contact PII stays hidden until
// a provider has offered, the lead fee is charged from the wallet
// server-authoritatively, the monthly/offer caps hold, refunds are owner-only
// and single-use, and a guest can accept purely with the bearer token.
// ---------------------------------------------------------------------------

const authState = vi.hoisted(() => ({ userId: null as string | null }));

const emailSpies = vi.hoisted(() => ({
  sendNewRequestToProvider: vi.fn(async () => undefined),
  sendOfferReceivedToCustomer: vi.fn(async () => undefined),
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: authState.userId }),
}));

vi.mock("../lib/email", () => ({
  sendNewRequestToProvider: emailSpies.sendNewRequestToProvider,
  sendOfferReceivedToCustomer: emailSpies.sendOfferReceivedToCustomer,
}));

import express, { type Express } from "express";
import requestsRouter from "./requests";
import providerRequestsRouter from "./providerRequests";
import {
  db,
  providersTable,
  providerWalletTable,
  walletTransactionsTable,
  leadUsageTable,
  requestsTable,
  requestMatchesTable,
  requestOffersTable,
  leadFeesTable,
  categoriesTable,
  providerLeadGrantsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { LEAD_PRICE_PRO_CENTS } from "../lib/leadPricing";
import {
  grantLeadCredits,
  revokeMonthlyPremiumGrants,
  countRemainingFreeLeads,
  LEAD_GRANT_SOURCES,
  ONE_TIME_PERIOD,
  currentPeriodMonth,
  startOfNextMonthUtc,
} from "../lib/leadGrants";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: Record<string, () => void> }).log = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    next();
  });
  app.use("/api", requestsRouter);
  app.use("/api", providerRequestsRouter);
  return app;
}

const sfx = `rfqtest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const categorySlug = `${sfx}_cat`;
const userP1 = `${sfx}_p1`;
const userP2 = `${sfx}_p2`;
const userPoor = `${sfx}_poor`;

let server: Server;
let baseUrl: string;
let p1: typeof providersTable.$inferSelect;
let p2: typeof providersTable.$inferSelect;
let poor: typeof providersTable.$inferSelect;
const createdRequestIds: number[] = [];

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

/** Create an open request as a guest; returns its id + the one-time raw token. */
async function createRequest(
  overrides: Record<string, unknown> = {},
): Promise<{ requestId: number; token: string; matched: number }> {
  authState.userId = null;
  const res = await api("POST", "/api/requests", {
    customerName: "Max Mustermann",
    customerEmail: "max@example.com",
    customerPhone: "+49 30 1234567",
    categorySlug,
    title: "Anfrage Titel",
    consentDataShare: true,
    ...overrides,
  });
  expect(res.status).toBe(201);
  const requestId = res.body.request.id as number;
  createdRequestIds.push(requestId);
  return { requestId, token: res.body.accessToken as string, matched: res.body.matchedProviders };
}

async function fundWallet(providerId: number, cents: number): Promise<void> {
  await db
    .insert(providerWalletTable)
    .values({ providerId, balanceCents: cents })
    .onConflictDoUpdate({
      target: providerWalletTable.providerId,
      set: { balanceCents: cents },
    });
}

async function walletBalance(providerId: number): Promise<number> {
  const [row] = await db
    .select({ balanceCents: providerWalletTable.balanceCents })
    .from(providerWalletTable)
    .where(eq(providerWalletTable.providerId, providerId))
    .limit(1);
  return row?.balanceCents ?? 0;
}

beforeAll(async () => {
  server = makeApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.insert(categoriesTable).values({
    name: "RfQ Test Kategorie",
    slug: categorySlug,
    requiresDirectBilling: false,
    // Pay-per-Lead category in the professional world → flat pro lead price.
    worldId: "pro",
    pricingModel: "lead",
  });

  const inserted = await db
    .insert(providersTable)
    .values([
      {
        clerkUserId: userP1,
        approvalStatus: "approved",
        displayName: "RfQ Berater 1",
        email: "rfq-p1@example.com",
        category: "RfQ Test Kategorie",
        categorySlug,
        city: "Berlin",
        zip: "10115",
        subscriptionTier: "basic",
      },
      {
        clerkUserId: userP2,
        approvalStatus: "approved",
        displayName: "RfQ Berater 2",
        email: "rfq-p2@example.com",
        category: "RfQ Test Kategorie",
        categorySlug,
        city: "Berlin",
        zip: "10115",
        subscriptionTier: "basic",
      },
      {
        clerkUserId: userPoor,
        approvalStatus: "approved",
        displayName: "RfQ Berater (leer)",
        email: "rfq-poor@example.com",
        category: "RfQ Test Kategorie",
        categorySlug,
        city: "Berlin",
        zip: "10115",
        subscriptionTier: "basic",
      },
    ])
    .returning();
  p1 = inserted.find((p) => p.clerkUserId === userP1)!;
  p2 = inserted.find((p) => p.clerkUserId === userP2)!;
  poor = inserted.find((p) => p.clerkUserId === userPoor)!;

  await fundWallet(p1.id, 100_000);
  await fundWallet(p2.id, 100_000);
  await fundWallet(poor.id, 0);
});

afterAll(async () => {
  const providerIds = [p1?.id, p2?.id, poor?.id].filter(Boolean) as number[];
  if (createdRequestIds.length > 0) {
    await db.delete(requestOffersTable).where(inArray(requestOffersTable.requestId, createdRequestIds));
    await db.delete(leadFeesTable).where(inArray(leadFeesTable.requestId, createdRequestIds));
    await db.delete(requestMatchesTable).where(inArray(requestMatchesTable.requestId, createdRequestIds));
    await db.delete(requestsTable).where(inArray(requestsTable.id, createdRequestIds));
  }
  if (providerIds.length > 0) {
    await db.delete(walletTransactionsTable).where(inArray(walletTransactionsTable.providerId, providerIds));
    await db.delete(providerWalletTable).where(inArray(providerWalletTable.providerId, providerIds));
    await db.delete(leadUsageTable).where(inArray(leadUsageTable.providerId, providerIds));
    await db.delete(providerLeadGrantsTable).where(inArray(providerLeadGrantsTable.providerId, providerIds));
    await db.delete(providersTable).where(inArray(providersTable.id, providerIds));
  }
  await db.delete(categoriesTable).where(eq(categoriesTable.slug, categorySlug));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  emailSpies.sendNewRequestToProvider.mockClear();
  emailSpies.sendOfferReceivedToCustomer.mockClear();
  // Reset the monthly lead usage so the basic-tier cap (3/month) does not bleed
  // across unrelated tests. The cap itself is asserted in its own test below.
  const providerIds = [p1?.id, p2?.id, poor?.id].filter(Boolean) as number[];
  if (providerIds.length > 0) {
    await db.delete(leadUsageTable).where(inArray(leadUsageTable.providerId, providerIds));
    // Free-lead grants must not bleed across tests either — every grant test
    // seeds exactly the grants it needs.
    await db.delete(providerLeadGrantsTable).where(inArray(providerLeadGrantsTable.providerId, providerIds));
  }
});

describe("POST /requests — create + match", () => {
  it("requires explicit DSGVO consent", async () => {
    authState.userId = null;
    const res = await api("POST", "/api/requests", {
      customerName: "Max",
      customerEmail: "max@example.com",
      categorySlug,
      title: "Ohne Zustimmung",
      consentDataShare: false,
    });
    expect(res.status).toBe(400);
  });

  it("creates an open request, returns a one-time token, and matches providers", async () => {
    const { requestId, token, matched } = await createRequest();
    expect(requestId).toBeGreaterThan(0);
    expect(token).toHaveLength(43);
    // All three test providers share the category, so all are matched.
    expect(matched).toBeGreaterThanOrEqual(3);
    expect(emailSpies.sendNewRequestToProvider).toHaveBeenCalled();

    // The token hash is persisted, never the raw token.
    const [row] = await db
      .select()
      .from(requestsTable)
      .where(eq(requestsTable.id, requestId));
    expect(row?.accessTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.accessTokenHash).not.toBe(token);
    expect(row?.status).toBe("open");
  });
});

describe("provider inbox — anonymization before offering", () => {
  it("hides contact PII until the provider has sent an offer", async () => {
    const { requestId } = await createRequest({ customerName: "Geheim Kunde" });
    authState.userId = userP1;

    const list = await api("GET", "/api/providers/me/requests");
    expect(list.status).toBe(200);
    const entry = (list.body as any[]).find((r) => r.id === requestId);
    expect(entry).toBeTruthy();
    expect(entry.contactUnlocked).toBe(false);
    expect(entry.hasOffered).toBe(false);
    expect(entry.customerName).toBeNull();
    expect(entry.customerEmail).toBeNull();
    expect(entry.customerPhone).toBeNull();
    // Plain request → base lead price, no discount for basic.
    expect(entry.estimatedLeadPriceCents).toBe(LEAD_PRICE_PRO_CENTS);

    const detail = await api("GET", `/api/providers/me/requests/${requestId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.customerName).toBeNull();
  });

  it("404s when a provider opens a request it is not matched to", async () => {
    authState.userId = userP1;
    const res = await api("GET", `/api/providers/me/requests/99999999`);
    expect(res.status).toBe(404);
  });
});

describe("POST /providers/me/requests/:id/offers — wallet charge + PII reveal", () => {
  it("charges the server-computed lead fee from the wallet and unlocks contact", async () => {
    const { requestId } = await createRequest();
    const before = await walletBalance(p1.id);
    authState.userId = userP1;

    const res = await api("POST", `/api/providers/me/requests/${requestId}/offers`, {
      priceCents: 12_000,
      message: "Mein Angebot",
      // A malicious client could try to undercut the fee — it must be ignored.
      leadFeeCents: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body.leadFeeCents).toBe(LEAD_PRICE_PRO_CENTS);
    expect(res.body.walletBalanceCents).toBe(before - LEAD_PRICE_PRO_CENTS);
    expect(emailSpies.sendOfferReceivedToCustomer).toHaveBeenCalledTimes(1);

    expect(await walletBalance(p1.id)).toBe(before - LEAD_PRICE_PRO_CENTS);

    // Contact is now revealed to this provider.
    const detail = await api("GET", `/api/providers/me/requests/${requestId}`);
    expect(detail.body.contactUnlocked).toBe(true);
    expect(detail.body.customerEmail).toBe("max@example.com");
    expect(detail.body.leadFeeId).toBeTruthy();
  });

  it("rejects a second offer from the same provider on the same request", async () => {
    const { requestId } = await createRequest();
    authState.userId = userP1;
    const first = await api("POST", `/api/providers/me/requests/${requestId}/offers`, {
      priceCents: 9_000,
    });
    expect(first.status).toBe(201);
    const second = await api("POST", `/api/providers/me/requests/${requestId}/offers`, {
      priceCents: 9_000,
    });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("ALREADY_OFFERED");
  });

  it("403s when a provider offers on a request it was not matched to", async () => {
    // Request ids are enumerable, so offering must require an actual match row —
    // otherwise any same-category provider could buy a lead (and reveal the
    // customer's contact PII) for a request they were never matched to.
    const { requestId } = await createRequest();
    await db
      .delete(requestMatchesTable)
      .where(
        and(
          eq(requestMatchesTable.requestId, requestId),
          eq(requestMatchesTable.providerId, p1.id),
        ),
      );
    authState.userId = userP1;
    const res = await api("POST", `/api/providers/me/requests/${requestId}/offers`, {
      priceCents: 9_000,
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_MATCHED");
  });

  it("returns 402 INSUFFICIENT_FUNDS when the wallet cannot cover the fee", async () => {
    const { requestId } = await createRequest();
    authState.userId = userPoor;
    const res = await api("POST", `/api/providers/me/requests/${requestId}/offers`, {
      priceCents: 9_000,
    });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("INSUFFICIENT_FUNDS");
  });

  it("enforces the basic-tier monthly lead cap (3/month → 403 upgradeRequired)", async () => {
    // Pre-seed this period's usage at the basic cap so the next offer is gated.
    const periodMonth = new Date().toISOString().slice(0, 7);
    await db
      .insert(leadUsageTable)
      .values({ providerId: p1.id, periodMonth, leadsUsed: 3 })
      .onConflictDoUpdate({
        target: [leadUsageTable.providerId, leadUsageTable.periodMonth],
        set: { leadsUsed: 3 },
      });

    const { requestId } = await createRequest();
    authState.userId = userP1;
    const res = await api("POST", `/api/providers/me/requests/${requestId}/offers`, {
      priceCents: 9_000,
    });
    expect(res.status).toBe(403);
    expect(res.body.upgradeRequired).toBe(true);
  });

  it("enforces the request's maxOffers cap (auto-closes, then rejects)", async () => {
    const { requestId } = await createRequest({ maxOffers: 1 });

    authState.userId = userP2;
    const ok = await api("POST", `/api/providers/me/requests/${requestId}/offers`, {
      priceCents: 8_000,
    });
    expect(ok.status).toBe(201);

    // The request auto-closes to "matched" at the cap.
    const [row] = await db
      .select()
      .from(requestsTable)
      .where(eq(requestsTable.id, requestId));
    expect(row?.status).toBe("matched");

    authState.userId = userP1;
    const capped = await api("POST", `/api/providers/me/requests/${requestId}/offers`, {
      priceCents: 8_000,
    });
    expect(capped.status).toBe(409);
    expect(capped.body.code).toBe("MAX_OFFERS");
  });
});

describe("guest offer view + accept (bearer token only)", () => {
  it("lets a guest view offers and accept one purely with the token", async () => {
    const { requestId, token } = await createRequest();
    authState.userId = userP1;
    const offerRes = await api("POST", `/api/providers/me/requests/${requestId}/offers`, {
      priceCents: 15_000,
      message: "Festpreis",
    });
    expect(offerRes.status).toBe(201);
    const offerId = offerRes.body.offer.id as number;

    // Guest view with the bearer token.
    authState.userId = null;
    const view = await api("POST", "/api/requests/access", { requestId, token });
    expect(view.status).toBe(200);
    expect(view.body.offers).toHaveLength(1);
    expect(view.body.offers[0].id).toBe(offerId);

    // Wrong token is rejected.
    const bad = await api("POST", "/api/requests/access", { requestId, token: "wrong" });
    expect(bad.status).toBe(404);

    // Accept with the token → offer accepted, request fulfilled.
    const accept = await api("POST", `/api/request-offers/${offerId}/accept`, { token });
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe("accepted");

    const [reqRow] = await db
      .select()
      .from(requestsTable)
      .where(eq(requestsTable.id, requestId));
    expect(reqRow?.status).toBe("fulfilled");
  });

  it("rejects an accept attempt with the wrong token", async () => {
    const { requestId, token } = await createRequest();
    authState.userId = userP1;
    const offerRes = await api("POST", `/api/providers/me/requests/${requestId}/offers`, {
      priceCents: 10_000,
    });
    const offerId = offerRes.body.offer.id as number;
    void token;

    authState.userId = null;
    const accept = await api("POST", `/api/request-offers/${offerId}/accept`, { token: "nope" });
    expect(accept.status).toBe(404);
  });

  it("rejects a second accept once the request is already fulfilled", async () => {
    const { requestId, token } = await createRequest();
    authState.userId = userP1;
    const offerRes = await api("POST", `/api/providers/me/requests/${requestId}/offers`, {
      priceCents: 10_000,
    });
    const offerId = offerRes.body.offer.id as number;

    authState.userId = null;
    const first = await api("POST", `/api/request-offers/${offerId}/accept`, { token });
    expect(first.status).toBe(200);
    // The request is now fulfilled — a replayed accept must be rejected, not
    // silently re-fulfill the request / re-accept the offer.
    const second = await api("POST", `/api/request-offers/${offerId}/accept`, { token });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("NOT_OPEN");
  });
});

describe("POST /leads/:leadFeeId/refund — owner-only, single-use", () => {
  it("refunds the lead fee back to the owning provider's wallet once", async () => {
    const { requestId } = await createRequest();
    authState.userId = userP2;
    const before = await walletBalance(p2.id);
    const offerRes = await api("POST", `/api/providers/me/requests/${requestId}/offers`, {
      priceCents: 11_000,
    });
    expect(offerRes.status).toBe(201);
    const leadFeeId = offerRes.body.offer.leadFeeId as number;
    expect(await walletBalance(p2.id)).toBe(before - LEAD_PRICE_PRO_CENTS);

    const refund = await api("POST", `/api/leads/${leadFeeId}/refund`, { reason: "Test" });
    expect(refund.status).toBe(200);
    expect(refund.body.refundedCents).toBe(LEAD_PRICE_PRO_CENTS);
    expect(await walletBalance(p2.id)).toBe(before);

    // Second refund is rejected.
    const again = await api("POST", `/api/leads/${leadFeeId}/refund`, {});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_REFUNDED");
  });

  it("forbids refunding a lead fee that belongs to another provider (IDOR)", async () => {
    const { requestId } = await createRequest();
    authState.userId = userP1;
    const offerRes = await api("POST", `/api/providers/me/requests/${requestId}/offers`, {
      priceCents: 13_000,
    });
    const leadFeeId = offerRes.body.offer.leadFeeId as number;

    // Provider 2 tries to refund provider 1's lead fee.
    authState.userId = userP2;
    const refund = await api("POST", `/api/leads/${leadFeeId}/refund`, {});
    expect(refund.status).toBe(403);
    expect(refund.body.code).toBe("FORBIDDEN");
  });

  it("refuses to refund a lead whose offer was already accepted (converted)", async () => {
    const { requestId, token } = await createRequest();
    authState.userId = userP2;
    const offerRes = await api("POST", `/api/providers/me/requests/${requestId}/offers`, {
      priceCents: 12_000,
    });
    const offerId = offerRes.body.offer.id as number;
    const leadFeeId = offerRes.body.offer.leadFeeId as number;

    // Customer accepts → the lead converted; Lead-Garantie no longer applies.
    authState.userId = null;
    const accept = await api("POST", `/api/request-offers/${offerId}/accept`, { token });
    expect(accept.status).toBe(200);

    authState.userId = userP2;
    const refund = await api("POST", `/api/leads/${leadFeeId}/refund`, { reason: "Test" });
    expect(refund.status).toBe(409);
    expect(refund.body.code).toBe("LEAD_CONVERTED");
  });
});

describe("auth gating", () => {
  it("401s the provider inbox for a signed-out caller", async () => {
    authState.userId = null;
    const res = await api("GET", "/api/providers/me/requests");
    expect(res.status).toBe(401);
  });
});

describe("free-lead grants — consume before wallet debit", () => {
  it("uses a free lead first: lead fee 0, wallet untouched, remaining decremented", async () => {
    // Two free leads for p1; the wallet is fully funded but must NOT be touched.
    await grantLeadCredits(db, {
      providerId: p1.id,
      source: LEAD_GRANT_SOURCES.basicSignup,
      periodMonth: ONE_TIME_PERIOD,
      count: 2,
    });
    const before = await walletBalance(p1.id);
    const { requestId } = await createRequest();
    authState.userId = userP1;

    const res = await api("POST", `/api/providers/me/requests/${requestId}/offers`, {
      priceCents: 12_000,
    });
    expect(res.status).toBe(201);
    expect(res.body.freeLeadUsed).toBe(true);
    expect(res.body.leadFeeCents).toBe(0);
    // Wallet balance is reported unchanged AND actually unchanged in the DB.
    expect(res.body.walletBalanceCents).toBe(before);
    expect(await walletBalance(p1.id)).toBe(before);
    // One of the two free leads was spent.
    expect(res.body.freeLeadsRemaining).toBe(1);
    expect(await countRemainingFreeLeads(p1.id)).toBe(1);

    // The lead fee row records the free lead: amount 0, not paid from credit,
    // and linked to the grant it was drawn from.
    const [fee] = await db
      .select()
      .from(leadFeesTable)
      .where(eq(leadFeesTable.id, res.body.offer.leadFeeId));
    expect(fee.amountCents).toBe(0);
    expect(fee.paidFromCredit).toBe(false);
    expect(fee.leadGrantId).not.toBeNull();
  });

  it("debits the wallet once the free leads are exhausted", async () => {
    // Exactly one free lead: the first offer is free, the second pays full price.
    await grantLeadCredits(db, {
      providerId: p1.id,
      source: LEAD_GRANT_SOURCES.basicSignup,
      periodMonth: ONE_TIME_PERIOD,
      count: 1,
    });
    const before = await walletBalance(p1.id);

    const first = await createRequest();
    authState.userId = userP1;
    const firstRes = await api("POST", `/api/providers/me/requests/${first.requestId}/offers`, {
      priceCents: 9_000,
    });
    expect(firstRes.status).toBe(201);
    expect(firstRes.body.freeLeadUsed).toBe(true);
    expect(firstRes.body.leadFeeCents).toBe(0);
    expect(await walletBalance(p1.id)).toBe(before);

    const second = await createRequest();
    authState.userId = userP1;
    const secondRes = await api("POST", `/api/providers/me/requests/${second.requestId}/offers`, {
      priceCents: 9_000,
    });
    expect(secondRes.status).toBe(201);
    expect(secondRes.body.freeLeadUsed).toBe(false);
    expect(secondRes.body.leadFeeCents).toBe(LEAD_PRICE_PRO_CENTS);
    expect(await walletBalance(p1.id)).toBe(before - LEAD_PRICE_PRO_CENTS);
    expect(await countRemainingFreeLeads(p1.id)).toBe(0);
  });

  it("spends both free leads from a single aggregate grant row (no false debit)", async () => {
    // Regression guard for the aggregate-counter consumption: a grant row with
    // remainingCount=2 must be fully drained across two offers, with the wallet
    // untouched both times — never a premature wallet debit while a free lead
    // still remains in the (momentarily locked) row.
    await grantLeadCredits(db, {
      providerId: p1.id,
      source: LEAD_GRANT_SOURCES.basicSignup,
      periodMonth: ONE_TIME_PERIOD,
      count: 2,
    });
    const before = await walletBalance(p1.id);

    for (let i = 0; i < 2; i++) {
      const { requestId } = await createRequest();
      authState.userId = userP1;
      const res = await api("POST", `/api/providers/me/requests/${requestId}/offers`, {
        priceCents: 9_000,
      });
      expect(res.status).toBe(201);
      expect(res.body.freeLeadUsed).toBe(true);
      expect(res.body.leadFeeCents).toBe(0);
    }
    expect(await walletBalance(p1.id)).toBe(before);
    expect(await countRemainingFreeLeads(p1.id)).toBe(0);
  });

  it("spends the soonest-expiring (monthly) grant before the one-time grant", async () => {
    // p1 has a monthly grant (expires next month) and a one-time grant. The
    // monthly one must be drawn down first so use-it-or-lose-it leads aren't lost.
    await grantLeadCredits(db, {
      providerId: p1.id,
      source: LEAD_GRANT_SOURCES.premiumActivation,
      periodMonth: ONE_TIME_PERIOD,
      count: 1,
    });
    await grantLeadCredits(db, {
      providerId: p1.id,
      source: LEAD_GRANT_SOURCES.premiumMonthly,
      periodMonth: currentPeriodMonth(),
      count: 1,
      expiresAt: startOfNextMonthUtc(),
    });

    const { requestId } = await createRequest();
    authState.userId = userP1;
    const res = await api("POST", `/api/providers/me/requests/${requestId}/offers`, {
      priceCents: 9_000,
    });
    expect(res.status).toBe(201);
    expect(res.body.freeLeadUsed).toBe(true);

    // The monthly grant was drained; the one-time activation grant survives.
    const grants = await db
      .select()
      .from(providerLeadGrantsTable)
      .where(eq(providerLeadGrantsTable.providerId, p1.id));
    const monthly = grants.find((g) => g.source === LEAD_GRANT_SOURCES.premiumMonthly);
    const oneTime = grants.find((g) => g.source === LEAD_GRANT_SOURCES.premiumActivation);
    expect(monthly?.remainingCount).toBe(0);
    expect(oneTime?.remainingCount).toBe(1);
  });

  it("refunding a free lead is a no-op: marked refunded, no wallet movement", async () => {
    await grantLeadCredits(db, {
      providerId: p2.id,
      source: LEAD_GRANT_SOURCES.basicSignup,
      periodMonth: ONE_TIME_PERIOD,
      count: 1,
    });
    const before = await walletBalance(p2.id);
    const { requestId } = await createRequest();
    authState.userId = userP2;
    const offerRes = await api("POST", `/api/providers/me/requests/${requestId}/offers`, {
      priceCents: 11_000,
    });
    expect(offerRes.status).toBe(201);
    expect(offerRes.body.freeLeadUsed).toBe(true);
    const leadFeeId = offerRes.body.offer.leadFeeId as number;
    expect(await walletBalance(p2.id)).toBe(before);

    const refund = await api("POST", `/api/leads/${leadFeeId}/refund`, { reason: "Test" });
    expect(refund.status).toBe(200);
    // Nothing is refunded (the lead cost nothing) and the wallet is untouched.
    expect(refund.body.refundedCents).toBe(0);
    expect(await walletBalance(p2.id)).toBe(before);

    // The lead fee is marked refunded, but the grant is NOT re-credited.
    const [fee] = await db
      .select()
      .from(leadFeesTable)
      .where(eq(leadFeesTable.id, leadFeeId));
    expect(fee.status).toBe("refunded");
    expect(await countRemainingFreeLeads(p2.id)).toBe(0);
  });

  it("downgrade revokes unused monthly grants but keeps one-time grants", async () => {
    await grantLeadCredits(db, {
      providerId: p1.id,
      source: LEAD_GRANT_SOURCES.premiumActivation,
      periodMonth: ONE_TIME_PERIOD,
      count: 5,
    });
    await grantLeadCredits(db, {
      providerId: p1.id,
      source: LEAD_GRANT_SOURCES.premiumMonthly,
      periodMonth: currentPeriodMonth(),
      count: 3,
      expiresAt: startOfNextMonthUtc(),
    });
    expect(await countRemainingFreeLeads(p1.id)).toBe(8);

    await db.transaction(async (tx) => {
      await revokeMonthlyPremiumGrants(tx, p1.id);
    });

    // Only the 5 one-time activation leads survive; the 3 monthly are revoked.
    expect(await countRemainingFreeLeads(p1.id)).toBe(5);
    const grants = await db
      .select()
      .from(providerLeadGrantsTable)
      .where(eq(providerLeadGrantsTable.providerId, p1.id));
    const monthly = grants.find((g) => g.source === LEAD_GRANT_SOURCES.premiumMonthly);
    const oneTime = grants.find((g) => g.source === LEAD_GRANT_SOURCES.premiumActivation);
    expect(monthly?.remainingCount).toBe(0);
    expect(oneTime?.remainingCount).toBe(5);
  });
});
