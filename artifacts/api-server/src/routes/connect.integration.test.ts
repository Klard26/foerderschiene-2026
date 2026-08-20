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
// Integration tests for the Stripe Connect (Express) onboarding routes in
// connect.ts:
//   - POST /providers/me/connect/onboard — creates a Stripe Express account
//     when none exists, persists stripeAccountId on the providers row, and
//     returns an account-link onboarding URL (reuses an existing account id on
//     repeat calls).
//   - GET  /providers/me/connect — reports payout/onboarding status and keeps
//     the cached stripeOnboardedAt timestamp in sync with the live Stripe
//     account (sets it when charges are enabled + details submitted, clears it
//     when the account can no longer charge). stripeOnboardedAt is the field
//     isConnectSplitEligible() depends on for marketplace payout splits.
//
// As with billing.integration.test.ts, only the external edges are mocked
// (Clerk auth + Stripe accounts / accountLinks). Everything else — the provider
// query layer and DB writes — runs for real against the development Postgres
// DB, and assertions verify the persisted providers row changed.
// ---------------------------------------------------------------------------

const authState = vi.hoisted(() => ({ userId: null as string | null }));

// Configurable Stripe test double. Tests set the `*Return` / map fields to drive
// the mocked Stripe responses and read the `*Args` fields to assert what
// connect.ts asked Stripe to do.
const stripeState = vi.hoisted(() => ({
  // "configured" → return a fake client; "null" → simulate Stripe not set up.
  client: "configured" as "configured" | "null",
  accountCreateArgs: null as Record<string, unknown> | null,
  createdAccountId: "acct_test_created",
  accountLinkCreateArgs: null as Record<string, unknown> | null,
  accountLinkUrl: "https://stripe.test/connect/onboard",
  // accounts.retrieve keyed by account id -> live capability flags.
  accountById: {} as Record<
    string,
    {
      charges_enabled?: boolean;
      details_submitted?: boolean;
      payouts_enabled?: boolean;
    }
  >,
  retrievedAccountIds: [] as string[],
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
  isStripeConfigured: async () => stripeState.client === "configured",
  getUncachableStripeClient: async () => {
    if (stripeState.client === "null") return null;
    return {
      accounts: {
        create: async (args: Record<string, unknown>) => {
          stripeState.accountCreateArgs = args;
          return { id: stripeState.createdAccountId };
        },
        retrieve: async (id: string) => {
          stripeState.retrievedAccountIds.push(id);
          const flags = stripeState.accountById[id] ?? {};
          return {
            id,
            charges_enabled: !!flags.charges_enabled,
            details_submitted: !!flags.details_submitted,
            payouts_enabled: !!flags.payouts_enabled,
          };
        },
      },
      accountLinks: {
        create: async (args: Record<string, unknown>) => {
          stripeState.accountLinkCreateArgs = args;
          return { url: stripeState.accountLinkUrl };
        },
      },
    };
  },
}));

import express, { type Express } from "express";
import connectRouter from "./connect";
import { db, providersTable, categoriesTable } from "@workspace/db";
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
  app.use("/api", connectRouter);
  return app;
}

const sfx = `cntest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const onboardUser = `${sfx}_onboard`;
const existingAcctUser = `${sfx}_existing`;
const statusUser = `${sfx}_status`;
const categorySlug = `${sfx}_cat`;

let server: Server;
let baseUrl: string;

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
    name: "Connect Test Kategorie",
    slug: categorySlug,
    requiresDirectBilling: false,
  });

  await db.insert(providersTable).values([
    {
      clerkUserId: onboardUser,
      approvalStatus: "approved",
      displayName: "Onboard Berater (cntest)",
      email: "onboard@example.com",
      category: "Connect Test Kategorie",
      categorySlug,
      city: "Berlin",
      zip: "10115",
      subscriptionTier: "basic",
    },
    {
      clerkUserId: existingAcctUser,
      approvalStatus: "approved",
      displayName: "Existing Acct Berater (cntest)",
      email: "existing@example.com",
      category: "Connect Test Kategorie",
      categorySlug,
      city: "München",
      zip: "80331",
      subscriptionTier: "basic",
      stripeAccountId: "acct_existing_test",
    },
    {
      clerkUserId: statusUser,
      approvalStatus: "approved",
      displayName: "Status Berater (cntest)",
      email: "status@example.com",
      category: "Connect Test Kategorie",
      categorySlug,
      city: "Hamburg",
      zip: "20095",
      subscriptionTier: "basic",
      stripeAccountId: "acct_status_test",
    },
  ]);
});

afterAll(async () => {
  const users = [onboardUser, existingAcctUser, statusUser];
  await db
    .delete(providersTable)
    .where(inArray(providersTable.clerkUserId, users));
  await db.delete(categoriesTable).where(eq(categoriesTable.slug, categorySlug));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  authState.userId = null;
  stripeState.client = "configured";
  stripeState.accountCreateArgs = null;
  stripeState.createdAccountId = "acct_test_created";
  stripeState.accountLinkCreateArgs = null;
  stripeState.accountLinkUrl = "https://stripe.test/connect/onboard";
  stripeState.accountById = {};
  stripeState.retrievedAccountIds = [];
});

describe("POST /api/providers/me/connect/onboard", () => {
  it("rejects unauthenticated requests with 401", async () => {
    authState.userId = null;
    const res = await api("POST", "/api/providers/me/connect/onboard");
    expect(res.status).toBe(401);
    expect(stripeState.accountCreateArgs).toBeNull();
  });

  it("returns 503 when Stripe is not configured", async () => {
    authState.userId = onboardUser;
    stripeState.client = "null";
    const res = await api("POST", "/api/providers/me/connect/onboard");
    expect(res.status).toBe(503);
  });

  it("returns 404 when the signed-in user has no provider profile", async () => {
    authState.userId = `${sfx}_nobody`;
    const res = await api("POST", "/api/providers/me/connect/onboard");
    expect(res.status).toBe(404);
    expect(stripeState.accountCreateArgs).toBeNull();
  });

  it("creates an Express account, persists stripeAccountId, and returns an onboarding link", async () => {
    authState.userId = onboardUser;
    stripeState.createdAccountId = "acct_onboard_new";

    const res = await api("POST", "/api/providers/me/connect/onboard");
    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://stripe.test/connect/onboard");

    // An Express account was created for the provider.
    expect(stripeState.accountCreateArgs).toMatchObject({
      type: "express",
      country: "DE",
      email: "onboard@example.com",
    });
    expect(stripeState.accountCreateArgs?.metadata).toMatchObject({
      clerkUserId: onboardUser,
    });

    // The new account id was persisted on the providers row.
    const provider = await getProviderByUser(onboardUser);
    expect(provider?.stripeAccountId).toBe("acct_onboard_new");

    // The account link was created for that account, with onboarding type.
    expect(stripeState.accountLinkCreateArgs).toMatchObject({
      account: "acct_onboard_new",
      type: "account_onboarding",
    });
  });

  it("reuses an existing stripeAccountId without creating a new account", async () => {
    authState.userId = existingAcctUser;

    const res = await api("POST", "/api/providers/me/connect/onboard");
    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://stripe.test/connect/onboard");

    // No new account should be created when one already exists.
    expect(stripeState.accountCreateArgs).toBeNull();

    // The link was created for the pre-existing account id, and the DB is
    // unchanged.
    expect(stripeState.accountLinkCreateArgs).toMatchObject({
      account: "acct_existing_test",
      type: "account_onboarding",
    });
    const provider = await getProviderByUser(existingAcctUser);
    expect(provider?.stripeAccountId).toBe("acct_existing_test");
  });
});

describe("GET /api/providers/me/connect", () => {
  it("rejects unauthenticated requests with 401", async () => {
    authState.userId = null;
    const res = await api("GET", "/api/providers/me/connect");
    expect(res.status).toBe(401);
  });

  it("reports no account when the provider has no stripeAccountId", async () => {
    authState.userId = onboardUser;
    // Ensure this provider has no account id for this assertion.
    await db
      .update(providersTable)
      .set({ stripeAccountId: null, stripeOnboardedAt: null })
      .where(eq(providersTable.clerkUserId, onboardUser));

    const res = await api("GET", "/api/providers/me/connect");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      hasAccount: false,
      onboarded: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    });
    // No Stripe account should have been retrieved.
    expect(stripeState.retrievedAccountIds).toHaveLength(0);
  });

  it("sets stripeOnboardedAt when Stripe reports charges enabled + details submitted", async () => {
    authState.userId = statusUser;
    // Start with no cached onboarding timestamp.
    await db
      .update(providersTable)
      .set({ stripeOnboardedAt: null })
      .where(eq(providersTable.clerkUserId, statusUser));
    stripeState.accountById["acct_status_test"] = {
      charges_enabled: true,
      details_submitted: true,
      payouts_enabled: true,
    };

    const res = await api("GET", "/api/providers/me/connect");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      hasAccount: true,
      onboarded: true,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    expect(stripeState.retrievedAccountIds).toContain("acct_status_test");

    // The completion path must persist the onboarding timestamp that
    // isConnectSplitEligible() depends on.
    const provider = await getProviderByUser(statusUser);
    expect(provider?.stripeOnboardedAt).toBeInstanceOf(Date);
  });

  it("clears stripeOnboardedAt when the account can no longer charge", async () => {
    authState.userId = statusUser;
    // Pretend onboarding was previously completed.
    await db
      .update(providersTable)
      .set({ stripeOnboardedAt: new Date() })
      .where(eq(providersTable.clerkUserId, statusUser));
    stripeState.accountById["acct_status_test"] = {
      charges_enabled: false,
      details_submitted: false,
      payouts_enabled: false,
    };

    const res = await api("GET", "/api/providers/me/connect");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      hasAccount: true,
      onboarded: false,
      chargesEnabled: false,
    });

    const provider = await getProviderByUser(statusUser);
    expect(provider?.stripeOnboardedAt).toBeNull();
  });
});
