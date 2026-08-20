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
// Integration tests for the Premium subscription + payment-sync flows in
// billing.ts:
//   - POST   /providers/me/subscription/checkout (create/reuse Stripe
//            product+price+customer, return a Checkout session url; reject when
//            the provider is already premium)
//   - DELETE /providers/me/subscription          (cancel at period end)
//   - POST   /billing/reconcile                  (flip tier -> premium when
//            Stripe reports an active sub; mark a booking paid when its session
//            is paid)
//
// As with bookingsBilling.integration.test.ts, only the external edges are
// mocked (Clerk auth + Stripe). Everything else — the provider/booking query
// layer and the DB writes — runs for real against the development Postgres DB,
// and assertions verify the persisted state changed.
// ---------------------------------------------------------------------------

const authState = vi.hoisted(() => ({ userId: null as string | null }));

// Configurable Stripe test double. Tests set the `*Return` fields to drive the
// mocked Stripe responses and read the `*Args` / `*Calls` fields to assert what
// billing.ts asked Stripe to do.
const stripeState = vi.hoisted(() => ({
  // products.search -> { data }
  productSearchData: [] as Array<{ id: string }>,
  productCreateArgs: null as Record<string, unknown> | null,
  // prices.list -> { data }
  priceListData: [] as Array<{
    id: string;
    recurring?: { interval?: string };
    unit_amount?: number;
  }>,
  priceCreateArgs: null as Record<string, unknown> | null,
  customerCreateArgs: null as Record<string, unknown> | null,
  sessionCreateArgs: null as Record<string, unknown> | null,
  // subscriptions.list -> { data }
  subscriptionListData: [] as Array<{ id: string }>,
  subscriptionUpdateCalls: [] as Array<{ id: string; args: unknown }>,
  // checkout.sessions.retrieve keyed by session id -> payment_status
  sessionPaymentStatusById: {} as Record<string, string>,
  retrievedSessionIds: [] as string[],
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: authState.userId }),
  clerkClient: {
    users: {
      getUser: async (id: string) => ({
        id,
        firstName: "Test",
        lastName: "Berater",
        primaryEmailAddress: { emailAddress: "berater@example.com" },
      }),
    },
  },
  clerkMiddleware:
    () =>
    (_req: unknown, _res: unknown, next: () => void): void =>
      next(),
}));

vi.mock("../lib/stripeClient", () => ({
  STRIPE_CONFIG: {
    premiumPriceEur: 89,
    premiumProductName: "Klard Premium (Berater)",
    currency: "eur",
  },
  premiumConfigForWorld: (worldId: "pro" | "alltag" | null | undefined) =>
    worldId === "alltag"
      ? { priceEur: 69, productName: "Klard Premium (Alltag & Handwerk)" }
      : { priceEur: 89, productName: "Klard Premium (Berater)" },
  isStripeConfigured: async () => true,
  getUncachableStripeClient: async () => ({
    products: {
      search: async () => ({ data: stripeState.productSearchData }),
      create: async (args: Record<string, unknown>) => {
        stripeState.productCreateArgs = args;
        return { id: "prod_test_created" };
      },
    },
    prices: {
      list: async () => ({ data: stripeState.priceListData }),
      create: async (args: Record<string, unknown>) => {
        stripeState.priceCreateArgs = args;
        return { id: "price_test_created" };
      },
    },
    customers: {
      create: async (args: Record<string, unknown>) => {
        stripeState.customerCreateArgs = args;
        return { id: "cus_test_created" };
      },
    },
    checkout: {
      sessions: {
        create: async (args: Record<string, unknown>) => {
          stripeState.sessionCreateArgs = args;
          return { id: "cs_test_sub_123", url: "https://stripe.test/subscribe" };
        },
        retrieve: async (id: string) => {
          stripeState.retrievedSessionIds.push(id);
          return {
            id,
            payment_status: stripeState.sessionPaymentStatusById[id] ?? "unpaid",
          };
        },
      },
    },
    subscriptions: {
      list: async () => ({ data: stripeState.subscriptionListData }),
      update: async (id: string, args: unknown) => {
        stripeState.subscriptionUpdateCalls.push({ id, args });
        return { id, ...(args as object) };
      },
    },
  }),
}));

import express, { type Express } from "express";
import billingRouter from "./billing";
import {
  db,
  providersTable,
  servicesTable,
  timeSlotsTable,
  bookingsTable,
  categoriesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

function makeApp(): Express {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: Record<string, () => void> }).log = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    next();
  });
  app.use(express.json());
  app.use("/api", billingRouter);
  return app;
}

const sfx = `bitest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const basicUser = `${sfx}_basic`;
const premiumUser = `${sfx}_premium`;
const reconcileUser = `${sfx}_reconcile`;
const customerId = `${sfx}_customer`;
const categorySlug = `${sfx}_cat`;

let server: Server;
let baseUrl: string;
let reconcileServiceId: number;

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

async function getProviderByUser(
  clerkUserId: string,
): Promise<typeof providersTable.$inferSelect | undefined> {
  const [p] = await db
    .select()
    .from(providersTable)
    .where(eq(providersTable.clerkUserId, clerkUserId))
    .limit(1);
  return p;
}

beforeAll(async () => {
  server = makeApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;

  await db.insert(categoriesTable).values({
    name: "Billing Test Kategorie",
    slug: categorySlug,
    requiresDirectBilling: false,
  });

  const inserted = await db.insert(providersTable).values([
    {
      clerkUserId: basicUser,
      approvalStatus: "approved",
      displayName: "Basic Berater (bitest)",
      email: "basic@example.com",
      category: "Billing Test Kategorie",
      categorySlug,
      city: "Berlin",
      zip: "10115",
      subscriptionTier: "basic",
    },
    {
      clerkUserId: premiumUser,
      approvalStatus: "approved",
      displayName: "Premium Berater (bitest)",
      email: "premium@example.com",
      category: "Billing Test Kategorie",
      categorySlug,
      city: "München",
      zip: "80331",
      subscriptionTier: "premium",
    },
    {
      clerkUserId: reconcileUser,
      approvalStatus: "approved",
      displayName: "Reconcile Berater (bitest)",
      email: "reconcile@example.com",
      category: "Billing Test Kategorie",
      categorySlug,
      city: "Hamburg",
      zip: "20095",
      subscriptionTier: "basic",
      // Already has a Stripe customer so reconcile lists subs against it.
      stripeCustomerId: "cus_reconcile_test",
    },
  ]).returning();

  const reconcileProvider = inserted.find(
    (p) => p.clerkUserId === reconcileUser,
  )!;
  const [svc] = await db
    .insert(servicesTable)
    .values({
      providerId: reconcileProvider.id,
      name: "Beratung",
      price: 120,
      durationMinutes: 60,
    })
    .returning();
  reconcileServiceId = svc!.id;
});

afterAll(async () => {
  const users = [basicUser, premiumUser, reconcileUser];
  await db
    .delete(bookingsTable)
    .where(inArray(bookingsTable.customerId, [customerId]));
  await db
    .delete(providersTable)
    .where(inArray(providersTable.clerkUserId, users));
  await db.delete(categoriesTable).where(eq(categoriesTable.slug, categorySlug));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  authState.userId = null;
  stripeState.productSearchData = [];
  stripeState.productCreateArgs = null;
  stripeState.priceListData = [];
  stripeState.priceCreateArgs = null;
  stripeState.customerCreateArgs = null;
  stripeState.sessionCreateArgs = null;
  stripeState.subscriptionListData = [];
  stripeState.subscriptionUpdateCalls = [];
  stripeState.sessionPaymentStatusById = {};
  stripeState.retrievedSessionIds = [];
});

describe("POST /api/providers/me/subscription/checkout", () => {
  it("rejects unauthenticated requests with 401", async () => {
    authState.userId = null;
    const res = await api("POST", "/api/providers/me/subscription/checkout");
    expect(res.status).toBe(401);
  });

  it("creates product, price and customer when none exist, then returns a session url", async () => {
    authState.userId = basicUser;
    // No existing product/price → billing.ts must create both.
    stripeState.productSearchData = [];
    stripeState.priceListData = [];

    const res = await api("POST", "/api/providers/me/subscription/checkout");
    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://stripe.test/subscribe");
    expect(res.body.sessionId).toBe("cs_test_sub_123");

    // Product + price were created (none pre-existed).
    expect(stripeState.productCreateArgs).toMatchObject({
      name: "Klard Premium (Berater)",
    });
    expect(stripeState.priceCreateArgs).toMatchObject({
      unit_amount: 89 * 100,
      currency: "eur",
      recurring: { interval: "month" },
    });

    // A Stripe customer was created and persisted on the provider row.
    expect(stripeState.customerCreateArgs).toMatchObject({
      email: "basic@example.com",
    });
    const provider = await getProviderByUser(basicUser);
    expect(provider?.stripeCustomerId).toBe("cus_test_created");

    // The Checkout session was a subscription-mode session for the new price.
    const args = stripeState.sessionCreateArgs!;
    expect(args.mode).toBe("subscription");
    expect(args.customer).toBe("cus_test_created");
    expect(args.line_items).toEqual([
      { price: "price_test_created", quantity: 1 },
    ]);
    expect(args.metadata).toMatchObject({ kind: "subscription" });
  });

  it("reuses an existing product + matching monthly price (no create calls)", async () => {
    authState.userId = basicUser;
    stripeState.productSearchData = [{ id: "prod_existing" }];
    stripeState.priceListData = [
      {
        id: "price_existing_monthly",
        recurring: { interval: "month" },
        unit_amount: 89 * 100,
      },
    ];

    const res = await api("POST", "/api/providers/me/subscription/checkout");
    expect(res.status).toBe(200);

    // Neither a product nor a price should be created when both already exist.
    expect(stripeState.productCreateArgs).toBeNull();
    expect(stripeState.priceCreateArgs).toBeNull();

    const args = stripeState.sessionCreateArgs!;
    expect(args.line_items).toEqual([
      { price: "price_existing_monthly", quantity: 1 },
    ]);
  });

  it("rejects when the provider is already premium (400)", async () => {
    authState.userId = premiumUser;
    const res = await api("POST", "/api/providers/me/subscription/checkout");
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("premium");
    // No Stripe Checkout session should have been created.
    expect(stripeState.sessionCreateArgs).toBeNull();
  });
});

describe("DELETE /api/providers/me/subscription", () => {
  it("returns 404 when the provider has no active subscription", async () => {
    authState.userId = basicUser;
    const res = await api("DELETE", "/api/providers/me/subscription");
    expect(res.status).toBe(404);
  });

  it("cancels at period end when a subscription exists", async () => {
    authState.userId = premiumUser;
    // Give the premium provider a subscription id to cancel.
    await db
      .update(providersTable)
      .set({ stripeSubscriptionId: "sub_cancel_test" })
      .where(eq(providersTable.clerkUserId, premiumUser));

    const res = await api("DELETE", "/api/providers/me/subscription");
    expect(res.status).toBe(200);
    expect(res.body.cancelAtPeriodEnd).toBe(true);

    expect(stripeState.subscriptionUpdateCalls).toEqual([
      { id: "sub_cancel_test", args: { cancel_at_period_end: true } },
    ]);
  });
});

describe("POST /api/billing/reconcile", () => {
  it("flips subscriptionTier to premium when Stripe reports an active sub", async () => {
    authState.userId = reconcileUser;
    stripeState.subscriptionListData = [{ id: "sub_active_test" }];

    const res = await api("POST", "/api/billing/reconcile");
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);

    const provider = await getProviderByUser(reconcileUser);
    expect(provider?.subscriptionTier).toBe("premium");
    expect(provider?.stripeSubscriptionId).toBe("sub_active_test");
    expect(provider?.premiumSince).toBeInstanceOf(Date);

    // Reset back to basic so this test is independent of ordering.
    await db
      .update(providersTable)
      .set({
        subscriptionTier: "basic",
        stripeSubscriptionId: null,
        premiumSince: null,
      })
      .where(eq(providersTable.clerkUserId, reconcileUser));
  });

  it("marks a booking paid when its Checkout session reports paid", async () => {
    authState.userId = reconcileUser;
    // No active sub for this run; only exercise the booking reconciliation.
    stripeState.subscriptionListData = [];

    const provider = await getProviderByUser(reconcileUser);
    const sessionId = "cs_booking_paid_test";
    const slotStart = new Date(Date.now() + 86_400_000);
    const [slot] = await db
      .insert(timeSlotsTable)
      .values({
        providerId: provider!.id,
        startTime: slotStart,
        endTime: new Date(slotStart.getTime() + 3600_000),
        isAvailable: false,
      })
      .returning();
    const [booking] = await db
      .insert(bookingsTable)
      .values({
        customerId: reconcileUser,
        customerName: "Self Booking",
        customerEmail: "reconcile@example.com",
        providerId: provider!.id,
        providerName: provider!.displayName,
        serviceId: reconcileServiceId,
        serviceName: "Beratung",
        slotId: slot!.id,
        status: "confirmed",
        totalPrice: 120,
        scheduledAt: slotStart,
        paymentRequired: true,
        paymentStatus: "pending",
        stripeCheckoutSessionId: sessionId,
      })
      .returning();

    stripeState.sessionPaymentStatusById[sessionId] = "paid";

    const res = await api("POST", "/api/billing/reconcile");
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
    expect(stripeState.retrievedSessionIds).toContain(sessionId);

    const [persisted] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, booking!.id));
    expect(persisted?.paymentStatus).toBe("paid");

    await db.delete(bookingsTable).where(eq(bookingsTable.id, booking!.id));
  });

  it("leaves a booking pending when its session is still unpaid", async () => {
    authState.userId = reconcileUser;
    stripeState.subscriptionListData = [];

    const provider = await getProviderByUser(reconcileUser);
    const sessionId = "cs_booking_unpaid_test";
    const slotStart = new Date(Date.now() + 90_000_000);
    const [slot] = await db
      .insert(timeSlotsTable)
      .values({
        providerId: provider!.id,
        startTime: slotStart,
        endTime: new Date(slotStart.getTime() + 3600_000),
        isAvailable: false,
      })
      .returning();
    const [booking] = await db
      .insert(bookingsTable)
      .values({
        customerId: reconcileUser,
        customerName: "Self Booking",
        customerEmail: "reconcile@example.com",
        providerId: provider!.id,
        providerName: provider!.displayName,
        serviceId: reconcileServiceId,
        serviceName: "Beratung",
        slotId: slot!.id,
        status: "confirmed",
        totalPrice: 120,
        scheduledAt: slotStart,
        paymentRequired: true,
        paymentStatus: "pending",
        stripeCheckoutSessionId: sessionId,
      })
      .returning();

    stripeState.sessionPaymentStatusById[sessionId] = "unpaid";

    const res = await api("POST", "/api/billing/reconcile");
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(false);

    const [persisted] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, booking!.id));
    expect(persisted?.paymentStatus).toBe("pending");

    await db.delete(bookingsTable).where(eq(bookingsTable.id, booking!.id));
  });
});
