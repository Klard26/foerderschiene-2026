import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Integration tests for the account-deletion handler (DELETE /api/account/me).
//
// This is the single most destructive self-service surface: it permanently
// wipes EVERY user-keyed table across both roles (provider + customer +
// Förderschiene + Energiewechsel) in one DB transaction, then deletes the
// Clerk login. A regression that misses a user-keyed table silently leaks
// orphaned rows; a non-idempotent Clerk failure makes the whole flow
// non-retryable. These tests run the real handler + real DB transaction.
//
// Only the external edges are mocked:
//   - Clerk auth (getAuth → the authenticated user; clerkClient.users.deleteUser
//     → controllable success / 404-already-gone / hard-failure),
//   - the Stripe client (subscription cancel is best-effort and must never
//     block deletion).
// ---------------------------------------------------------------------------

const authState = vi.hoisted(() => ({ userId: null as string | null }));
const clerkState = vi.hoisted(() => ({
  // "ok" → user deleted; "notfound" → 404 (already gone); "fail" → 500-style error.
  deleteUser: "ok" as "ok" | "notfound" | "fail",
}));
const clerkState2 = vi.hoisted(() => ({ primaryEmail: null as string | null }));
const clerkSpies = vi.hoisted(() => ({
  deleteUser: vi.fn(async (_id: string) => {
    if (clerkState.deleteUser === "notfound") {
      const err = new Error("Not Found") as Error & { status?: number };
      err.status = 404;
      throw err;
    }
    if (clerkState.deleteUser === "fail") {
      const err = new Error("Clerk unavailable") as Error & { status?: number };
      err.status = 500;
      throw err;
    }
    return { id: _id };
  }),
  getUser: vi.fn(async (_id: string) => ({
    id: _id,
    emailAddresses: clerkState2.primaryEmail
      ? [{ emailAddress: clerkState2.primaryEmail }]
      : [],
  })),
}));
const stripeState = vi.hoisted(() => ({ cancelCalledWith: null as string | null }));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: authState.userId }),
  clerkClient: {
    users: {
      deleteUser: clerkSpies.deleteUser,
      getUser: clerkSpies.getUser,
    },
  },
  clerkMiddleware:
    () =>
    (_req: unknown, _res: unknown, next: () => void): void =>
      next(),
}));

vi.mock("../lib/stripeClient", () => ({
  getUncachableStripeClient: async () => ({
    subscriptions: {
      cancel: async (id: string) => {
        stripeState.cancelCalledWith = id;
        return { id, status: "canceled" };
      },
    },
  }),
}));

import express, { type Express } from "express";
import accountRouter from "./account";
import {
  db,
  providersTable,
  servicesTable,
  timeSlotsTable,
  bookingsTable,
  reviewsTable,
  invoicesTable,
  blockedSlotsTable,
  immobilienKundeTable,
  assessmentsTable,
  offerAcceptancesTable,
  gebaeudecheckCreditsTable,
  gebaeudecheckOrdersTable,
  foerderschieneReportsTable,
  energieausweisOrdersTable,
  userRolesTable,
  emailLogTable,
  verwalterTable,
  objektTable,
  zaehlpunktTable,
  vertragTable,
  vollmachtTable,
  wechselvorgangTable,
  auditLogTable,
} from "@workspace/db";
import { eq, or, inArray } from "drizzle-orm";

// Minimal app: only the account router, mirroring the real `/api` mount.
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
  app.use("/api", accountRouter);
  return app;
}

let server: Server;
let baseUrl: string;

function uid(): string {
  return `acctdel_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

async function deleteAccount(): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/api/account/me`, { method: "DELETE" });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

/**
 * Seed ONE row in every user-keyed table for `userId`. The single test user
 * plays BOTH roles (provider clerkUserId === customerId === userId) so a single
 * deletion must clear every table. Returns the created provider id.
 */
async function seedFullAccount(userId: string): Promise<{ providerId: number }> {
  // --- Provider (Berater) side -------------------------------------------
  const [provider] = await db
    .insert(providersTable)
    .values({
      clerkUserId: userId,
      approvalStatus: "approved",
      displayName: "Lösch Berater",
      email: "loesch-berater@example.com",
      category: "Steuerberater",
      categorySlug: `cat_${userId}`,
      city: "Berlin",
      zip: "10115",
      subscriptionTier: "premium",
      stripeSubscriptionId: `sub_${userId}`,
      icalToken: `tok_${userId}`,
    })
    .returning();
  const providerId = provider!.id;

  const [service] = await db
    .insert(servicesTable)
    .values({
      providerId,
      name: "Erstberatung",
      price: 120,
      durationMinutes: 60,
    })
    .returning();

  const [slot] = await db
    .insert(timeSlotsTable)
    .values({
      providerId,
      startTime: new Date(Date.now() + 86_400_000),
      endTime: new Date(Date.now() + 86_400_000 + 3_600_000),
      isAvailable: false,
    })
    .returning();

  await db.insert(blockedSlotsTable).values({
    providerId,
    startTime: new Date(Date.now() + 172_800_000),
    endTime: new Date(Date.now() + 172_800_000 + 3_600_000),
    source: "ical",
  });

  // --- Customer (Kunde) side — keyed by the same user id ------------------
  const [booking] = await db
    .insert(bookingsTable)
    .values({
      customerId: userId,
      customerName: "Lösch Kunde",
      customerEmail: "loesch-kunde@example.com",
      providerId,
      providerName: provider!.displayName,
      serviceId: service!.id,
      serviceName: service!.name,
      slotId: slot!.id,
      status: "confirmed",
      totalPrice: 120,
      scheduledAt: slot!.startTime,
      paymentRequired: true,
      paymentStatus: "paid",
    })
    .returning();

  await db.insert(reviewsTable).values({
    bookingId: booking!.id,
    customerId: userId,
    customerName: "Lösch Kunde",
    providerId,
    rating: 5,
    comment: "Top",
  });

  await db.insert(invoicesTable).values({
    providerId,
    bookingId: booking!.id,
    invoiceNumber: `RE-${userId}`,
    netCents: 10084,
    taxRate: "19.00",
    taxCents: 1916,
    totalCents: 12000,
    providerSnapshot: { name: provider!.displayName },
    serviceName: service!.name,
  });

  await db.insert(immobilienKundeTable).values({
    userId,
    typ: "hausverwaltung",
    firma: "Lösch Immobilien GmbH",
  });

  const [assessment] = await db
    .insert(assessmentsTable)
    .values({
      userId,
      label: "Mein Gebäude",
      inputJson: { a: 1 },
      resultJson: { b: 2 },
    })
    .returning();
  void assessment;

  await db.insert(offerAcceptancesTable).values({
    userId,
    providerId,
    itemsJson: [{ id: 1 }],
    totalNet: 100,
    totalGross: 119,
    agbVersion: "v1",
  });

  await db.insert(gebaeudecheckCreditsTable).values({ userId, balance: 3 });
  await db.insert(gebaeudecheckOrdersTable).values({
    sessionId: `cs_${userId}`,
    userId,
    packageId: "single",
    credits: 1,
    amountCents: 4900,
  });

  // --- Förderschiene (Gebäudereport + Energieausweis) --------------------
  await db.insert(foerderschieneReportsTable).values({
    userId,
    amountCents: 4900,
    profil: { adresse: "Teststr. 1" },
  });
  await db.insert(energieausweisOrdersTable).values({
    userId,
    ausweisTyp: "bedarf",
    amountCents: 7900,
    kontaktName: "Lösch Kunde",
    kontaktEmail: "loesch-kunde@example.com",
    intake: { x: 1 },
  });

  // --- Energiewechsel (enerwatt24) portfolio (cascades off verwalter) ----
  const [verwalter] = await db
    .insert(verwalterTable)
    .values({ clerkUserId: userId, firma: "Lösch Hausverwaltung" })
    .returning();
  const [objekt] = await db
    .insert(objektTable)
    .values({
      verwalterId: verwalter!.id,
      bezeichnung: "Haus A",
      strasse: "Teststr. 1",
      plz: "10115",
      ort: "Berlin",
    })
    .returning();
  const [zaehlpunkt] = await db
    .insert(zaehlpunktTable)
    .values({ objektId: objekt!.id, sparte: "strom" })
    .returning();
  const [vertrag] = await db
    .insert(vertragTable)
    .values({ zaehlpunktId: zaehlpunkt!.id, versorger: "Stadtwerke" })
    .returning();
  const [vollmacht] = await db
    .insert(vollmachtTable)
    .values({ verwalterId: verwalter!.id, objektId: objekt!.id })
    .returning();
  await db.insert(wechselvorgangTable).values({
    zaehlpunktId: zaehlpunkt!.id,
    vollmachtId: vollmacht!.id,
    altVertragId: vertrag!.id,
  });
  await db.insert(auditLogTable).values({
    verwalterId: verwalter!.id,
    akteur: "system",
    aktion: "test_seed",
  });

  // --- Strict role separation record -------------------------------------
  await db.insert(userRolesTable).values({ clerkUserId: userId, role: "provider" });

  // --- email_log audit rows holding this user's personal data ------------
  // email_log is keyed by recipient address + relatedId (booking id / invoice
  // number / recipient email), NOT the Clerk user id. Seed one row per shape
  // the deletion purge must reach: provider-email recipient, customer-email
  // recipient, clerk-primary-email recipient (welcome_customer), booking-id
  // relatedId, and invoice-number relatedId.
  await db.insert(emailLogTable).values([
    {
      templateId: "welcome_provider",
      recipient: "loesch-berater@example.com",
      relatedId: "loesch-berater@example.com",
      subject: "Willkommen bei Klard",
      status: "sent",
    },
    {
      templateId: "welcome_customer",
      recipient: `${userId}@clerk.example.com`,
      relatedId: `${userId}@clerk.example.com`,
      subject: "Willkommen bei Klard",
      status: "sent",
    },
    {
      templateId: "booking_confirmation_customer",
      recipient: "loesch-kunde@example.com",
      relatedId: String(booking!.id),
      subject: "Buchung bestätigt",
      status: "sent",
    },
    {
      templateId: "invoice_ready",
      recipient: "loesch-kunde@example.com",
      relatedId: `RE-${userId}`,
      subject: "Ihre Rechnung",
      status: "sent",
    },
  ]);

  return { providerId };
}

/** Count every persisted row for `userId` across all user-keyed tables. */
async function countAllRows(userId: string, providerId: number): Promise<number> {
  const checks = await Promise.all([
    db.select().from(providersTable).where(eq(providersTable.clerkUserId, userId)),
    db.select().from(servicesTable).where(eq(servicesTable.providerId, providerId)),
    db.select().from(timeSlotsTable).where(eq(timeSlotsTable.providerId, providerId)),
    db.select().from(blockedSlotsTable).where(eq(blockedSlotsTable.providerId, providerId)),
    db.select().from(bookingsTable).where(eq(bookingsTable.customerId, userId)),
    db.select().from(bookingsTable).where(eq(bookingsTable.providerId, providerId)),
    db.select().from(reviewsTable).where(eq(reviewsTable.customerId, userId)),
    db.select().from(reviewsTable).where(eq(reviewsTable.providerId, providerId)),
    db.select().from(invoicesTable).where(eq(invoicesTable.providerId, providerId)),
    db.select().from(immobilienKundeTable).where(eq(immobilienKundeTable.userId, userId)),
    db.select().from(assessmentsTable).where(eq(assessmentsTable.userId, userId)),
    db.select().from(offerAcceptancesTable).where(eq(offerAcceptancesTable.userId, userId)),
    db.select().from(gebaeudecheckCreditsTable).where(eq(gebaeudecheckCreditsTable.userId, userId)),
    db.select().from(gebaeudecheckOrdersTable).where(eq(gebaeudecheckOrdersTable.userId, userId)),
    db.select().from(foerderschieneReportsTable).where(eq(foerderschieneReportsTable.userId, userId)),
    db.select().from(energieausweisOrdersTable).where(eq(energieausweisOrdersTable.userId, userId)),
    db.select().from(verwalterTable).where(eq(verwalterTable.clerkUserId, userId)),
    db.select().from(userRolesTable).where(eq(userRolesTable.clerkUserId, userId)),
  ]);
  return checks.reduce((sum, rows) => sum + rows.length, 0);
}

/** Count email_log rows tied to this user (recipient address or relatedId). */
async function countEmailLogRows(userId: string): Promise<number> {
  const ids = [
    "loesch-berater@example.com",
    "loesch-kunde@example.com",
    `${userId}@clerk.example.com`,
    `RE-${userId}`,
  ];
  const rows = await db
    .select({ id: emailLogTable.id })
    .from(emailLogTable)
    .where(or(inArray(emailLogTable.recipient, ids), inArray(emailLogTable.relatedId, ids)));
  return rows.length;
}

/** Best-effort cleanup so a failed assertion never leaves test rows behind. */
async function purge(userId: string, providerId: number | null): Promise<void> {
  if (providerId != null) {
    await db.delete(invoicesTable).where(eq(invoicesTable.providerId, providerId));
    await db.delete(blockedSlotsTable).where(eq(blockedSlotsTable.providerId, providerId));
    await db.delete(reviewsTable).where(eq(reviewsTable.providerId, providerId));
    await db.delete(bookingsTable).where(eq(bookingsTable.providerId, providerId));
    await db.delete(servicesTable).where(eq(servicesTable.providerId, providerId));
    await db.delete(timeSlotsTable).where(eq(timeSlotsTable.providerId, providerId));
    await db.delete(providersTable).where(eq(providersTable.id, providerId));
  }
  await db.delete(reviewsTable).where(eq(reviewsTable.customerId, userId));
  await db.delete(bookingsTable).where(eq(bookingsTable.customerId, userId));
  await db.delete(immobilienKundeTable).where(eq(immobilienKundeTable.userId, userId));
  await db.delete(offerAcceptancesTable).where(eq(offerAcceptancesTable.userId, userId));
  await db.delete(assessmentsTable).where(eq(assessmentsTable.userId, userId));
  await db.delete(gebaeudecheckOrdersTable).where(eq(gebaeudecheckOrdersTable.userId, userId));
  await db.delete(gebaeudecheckCreditsTable).where(eq(gebaeudecheckCreditsTable.userId, userId));
  await db.delete(foerderschieneReportsTable).where(eq(foerderschieneReportsTable.userId, userId));
  await db.delete(energieausweisOrdersTable).where(eq(energieausweisOrdersTable.userId, userId));
  await db.delete(verwalterTable).where(eq(verwalterTable.clerkUserId, userId));
  await db.delete(userRolesTable).where(eq(userRolesTable.clerkUserId, userId));
  const emailIds = [
    "loesch-berater@example.com",
    "loesch-kunde@example.com",
    `${userId}@clerk.example.com`,
    `RE-${userId}`,
  ];
  await db
    .delete(emailLogTable)
    .where(or(inArray(emailLogTable.recipient, emailIds), inArray(emailLogTable.relatedId, emailIds)));
}

let server2: Server | undefined;

beforeEach(async () => {
  authState.userId = null;
  clerkState.deleteUser = "ok";
  clerkState2.primaryEmail = null;
  stripeState.cancelCalledWith = null;
  clerkSpies.deleteUser.mockClear();
  clerkSpies.getUser.mockClear();
  server = makeApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  void server2;
});

describe("DELETE /api/account/me — orphan protection", () => {
  it("rejects unauthenticated requests with 401 (and does not touch Clerk)", async () => {
    authState.userId = null;
    const res = await deleteAccount();
    expect(res.status).toBe(401);
    expect(clerkSpies.deleteUser).not.toHaveBeenCalled();
  });

  it("removes EVERY user-keyed row across both roles, then deletes the Clerk login", async () => {
    const userId = uid();
    // The Clerk account's primary email is the recipient of the customer
    // welcome mail and only discoverable via Clerk, so make it match the seed.
    clerkState2.primaryEmail = `${userId}@clerk.example.com`;
    const { providerId } = await seedFullAccount(userId);
    try {
      // Pre-condition: there is data to delete.
      expect(await countAllRows(userId, providerId)).toBeGreaterThan(0);
      // Pre-condition: email_log holds this user's personal data.
      expect(await countEmailLogRows(userId)).toBeGreaterThan(0);

      authState.userId = userId;
      const res = await deleteAccount();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deleted: true });

      // Every user-keyed table (incl. cascade-only invoices/blocked_slots and the
      // verwalter-cascaded enerwatt24 portfolio) is now empty for this user.
      expect(await countAllRows(userId, providerId)).toBe(0);

      // GDPR: every email_log row holding this user's email address (recipient)
      // or referencing their bookings/invoices (relatedId) is purged too —
      // including the Clerk-primary-email welcome row only reachable via Clerk.
      expect(await countEmailLogRows(userId)).toBe(0);
      expect(clerkSpies.getUser).toHaveBeenCalledWith(userId);

      // enerwatt24 portfolio rows cascaded away with the verwalter.
      const [verw] = await db
        .select()
        .from(verwalterTable)
        .where(eq(verwalterTable.clerkUserId, userId));
      expect(verw).toBeUndefined();

      // Best-effort Stripe subscription cancel happened, and Clerk login deleted.
      expect(stripeState.cancelCalledWith).toBe(`sub_${userId}`);
      expect(clerkSpies.deleteUser).toHaveBeenCalledWith(userId);
    } finally {
      await purge(userId, providerId);
    }
  });

  it("treats a Clerk 404 (already gone) as success — retry-safe", async () => {
    const userId = uid();
    const { providerId } = await seedFullAccount(userId);
    try {
      authState.userId = userId;
      clerkState.deleteUser = "notfound";

      const res = await deleteAccount();
      // A prior attempt already removed the login → still a success.
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deleted: true });
      expect(await countAllRows(userId, providerId)).toBe(0);
    } finally {
      await purge(userId, providerId);
    }
  });

  it("returns 500 on a hard Clerk failure but leaves DB deletes committed (retry succeeds)", async () => {
    const userId = uid();
    const { providerId } = await seedFullAccount(userId);
    try {
      authState.userId = userId;
      clerkState.deleteUser = "fail";

      const first = await deleteAccount();
      expect(first.status).toBe(500);
      // Critically: the DB transaction already committed, so no orphans remain
      // even though the Clerk delete failed.
      expect(await countAllRows(userId, providerId)).toBe(0);

      // The client retries; the second attempt finds the data already gone and
      // (Clerk now succeeds) completes cleanly.
      clerkState.deleteUser = "ok";
      const second = await deleteAccount();
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ deleted: true });
    } finally {
      await purge(userId, providerId);
    }
  });
});
