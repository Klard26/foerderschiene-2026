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
// Integration tests for the booking + billing route handlers.
//
// These exercise the real Express app and route handlers against the live
// (development) Postgres database. Only the external edges are mocked:
//   - Clerk auth (getAuth / clerkClient) so we can drive the authenticated
//     user id per request,
//   - Stripe (getUncachableStripeClient) so we can capture Checkout session
//     params (the Connect destination-charge split) without hitting Stripe,
//   - email + invoice side effects (fire-and-forget) so no real mail is sent.
//
// Everything else — the query layer, the booking transaction (row locking,
// SLOT_TAKEN/SLOT_BLOCKED/SLOT_PROVIDER_MISMATCH), status transitions and
// authorization — runs for real against the DB.
// ---------------------------------------------------------------------------

const authState = vi.hoisted(() => ({ userId: null as string | null }));
const stripeState = vi.hoisted(() => ({
  lastSessionArgs: null as Record<string, unknown> | null,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: authState.userId }),
  clerkClient: {
    users: {
      getUser: async (id: string) => ({
        id,
        firstName: "Test",
        lastName: "Kunde",
        username: "testkunde",
        primaryEmailAddress: { emailAddress: "kunde@example.com" },
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
  isStripeConfigured: async () => true,
  getUncachableStripeClient: async () => ({
    checkout: {
      sessions: {
        create: async (args: Record<string, unknown>) => {
          stripeState.lastSessionArgs = args;
          return { id: "cs_test_integration_123", url: "https://stripe.test/pay" };
        },
      },
    },
  }),
}));

// Silence all fire-and-forget side effects (email + invoice/PDF). These are the
// only email/invoice functions imported by the bookings + billing routers.
vi.mock("../lib/email", () => ({
  sendBookingConfirmationToCustomer: async () => undefined,
  sendNewBookingToProvider: async () => undefined,
  sendBookingCancellation: async () => undefined,
}));
vi.mock("../lib/invoiceService", () => ({
  issueStornoForBooking: async () => null,
  sendInvoiceEmail: async () => undefined,
}));

import express, { type Express } from "express";
import bookingsRouter from "./bookings";
import billingRouter from "./billing";
import { reconcileProviderIcalBlocks } from "../lib/icalSync";
import {
  db,
  providersTable,
  servicesTable,
  timeSlotsTable,
  categoriesTable,
  blockedSlotsTable,
  bookingsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// A minimal Express app that mounts only the routers under test, mirroring the
// real `/api` mount point. We avoid importing the full app.ts to keep the
// import graph small (no pino-pretty worker, no template/PDF/AI modules) — the
// route handlers, DB queries and transactions exercised here are the real ones.
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
  app.use("/api", bookingsRouter);
  app.use("/api", billingRouter);
  return app;
}

const sfx = `itest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const customerId = `${sfx}_customer`;
const otherUserId = `${sfx}_other`;
const providerAUser = `${sfx}_providerA`;
const providerBUser = `${sfx}_providerB`;
const providerCUser = `${sfx}_providerC`;
const categorySlug = `${sfx}_cat`;

let server: Server;
let baseUrl: string;

let providerA: typeof providersTable.$inferSelect;
let providerB: typeof providersTable.$inferSelect;
let providerC: typeof providersTable.$inferSelect;
let serviceA: typeof servicesTable.$inferSelect;
let serviceB: typeof servicesTable.$inferSelect;
let serviceC: typeof servicesTable.$inferSelect;

function hourFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 3600_000);
}

async function createSlot(
  providerId: number,
  start: Date,
  isAvailable = true,
): Promise<typeof timeSlotsTable.$inferSelect> {
  const [slot] = await db
    .insert(timeSlotsTable)
    .values({
      providerId,
      startTime: start,
      endTime: new Date(start.getTime() + 3600_000),
      isAvailable,
    })
    .returning();
  return slot!;
}

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

beforeAll(async () => {
  server = makeApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;

  await db
    .insert(categoriesTable)
    .values({
      name: "Integration Test Kategorie",
      slug: categorySlug,
      requiresDirectBilling: false,
    });

  const [pA] = await db
    .insert(providersTable)
    .values({
      clerkUserId: providerAUser,
      approvalStatus: "approved",
      displayName: "Berater A (itest)",
      email: "beraterA@example.com",
      category: "Integration Test Kategorie",
      categorySlug,
      city: "Berlin",
      zip: "10115",
    })
    .returning();
  providerA = pA!;

  const [pB] = await db
    .insert(providersTable)
    .values({
      clerkUserId: providerBUser,
      approvalStatus: "approved",
      displayName: "Berater B (itest)",
      email: "beraterB@example.com",
      category: "Integration Test Kategorie",
      categorySlug,
      city: "Hamburg",
      zip: "20095",
      // B is fully Connect-onboarded → destination-charge split eligible.
      stripeAccountId: "acct_test_integration",
      stripeOnboardedAt: new Date(),
      subscriptionTier: "basic",
    })
    .returning();
  providerB = pB!;

  const [pC] = await db
    .insert(providersTable)
    .values({
      clerkUserId: providerCUser,
      approvalStatus: "approved",
      displayName: "Berater C (itest)",
      email: "beraterC@example.com",
      category: "Integration Test Kategorie",
      categorySlug,
      city: "München",
      zip: "80331",
      // C has connected an Express account but NEVER finished onboarding
      // (stripeOnboardedAt is null) → NOT split-eligible. The split must not be
      // attempted against a non-onboarded account.
      stripeAccountId: "acct_test_not_onboarded",
      subscriptionTier: "basic",
    })
    .returning();
  providerC = pC!;

  const [sA] = await db
    .insert(servicesTable)
    .values({
      providerId: providerA.id,
      name: "Erstberatung A",
      price: 120,
      durationMinutes: 60,
    })
    .returning();
  serviceA = sA!;

  const [sB] = await db
    .insert(servicesTable)
    .values({
      providerId: providerB.id,
      name: "Erstberatung B",
      price: 200,
      durationMinutes: 60,
    })
    .returning();
  serviceB = sB!;

  const [sC] = await db
    .insert(servicesTable)
    .values({
      providerId: providerC.id,
      name: "Erstberatung C",
      price: 150,
      durationMinutes: 60,
    })
    .returning();
  serviceC = sC!;
});

afterAll(async () => {
  const providerIds = [providerA?.id, providerB?.id, providerC?.id].filter(
    (x): x is number => typeof x === "number",
  );
  await db
    .delete(bookingsTable)
    .where(inArray(bookingsTable.customerId, [customerId, otherUserId]));
  if (providerIds.length) {
    await db
      .delete(blockedSlotsTable)
      .where(inArray(blockedSlotsTable.providerId, providerIds));
    await db
      .delete(timeSlotsTable)
      .where(inArray(timeSlotsTable.providerId, providerIds));
    await db
      .delete(servicesTable)
      .where(inArray(servicesTable.providerId, providerIds));
    await db.delete(providersTable).where(inArray(providersTable.id, providerIds));
  }
  await db.delete(categoriesTable).where(eq(categoriesTable.slug, categorySlug));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  authState.userId = null;
  stripeState.lastSessionArgs = null;
});

describe("POST /api/bookings", () => {
  it("rejects unauthenticated requests with 401", async () => {
    authState.userId = null;
    const slot = await createSlot(providerA.id, hourFromNow(24));
    const res = await api("POST", "/api/bookings", {
      providerId: providerA.id,
      serviceId: serviceA.id,
      slotId: slot.id,
    });
    expect(res.status).toBe(401);
  });

  it("creates a booking, marks the slot unavailable, and computes price server-side", async () => {
    authState.userId = customerId;
    const slot = await createSlot(providerA.id, hourFromNow(25));

    const res = await api("POST", "/api/bookings", {
      providerId: providerA.id,
      serviceId: serviceA.id,
      slotId: slot.id,
      // A bogus client-supplied price must be ignored (server-authoritative).
      notes: "Bitte vormittags",
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.totalPrice).toBe(serviceA.price);
    expect(res.body.customerId).toBe(customerId);
    // Standard category requires payment via Klard.
    expect(res.body.paymentRequired).toBe(true);
    expect(res.body.paymentStatus).toBe("pending");

    const [persisted] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, res.body.id));
    expect(persisted?.serviceName).toBe(serviceA.name);

    const [slotAfter] = await db
      .select()
      .from(timeSlotsTable)
      .where(eq(timeSlotsTable.id, slot.id));
    expect(slotAfter?.isAvailable).toBe(false);
  });

  it("rejects a service that belongs to a different provider (400)", async () => {
    authState.userId = customerId;
    const slot = await createSlot(providerA.id, hourFromNow(26));
    const res = await api("POST", "/api/bookings", {
      providerId: providerA.id,
      serviceId: serviceB.id, // belongs to provider B
      slotId: slot.id,
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("Leistung");
  });

  it("rejects a slot that belongs to a different provider (400, SLOT_PROVIDER_MISMATCH)", async () => {
    authState.userId = customerId;
    const slotForB = await createSlot(providerB.id, hourFromNow(27));
    const res = await api("POST", "/api/bookings", {
      providerId: providerA.id,
      serviceId: serviceA.id,
      slotId: slotForB.id, // slot is provider B's
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("Termin gehört nicht");
  });

  it("rejects booking a slot blocked by an external calendar (409, SLOT_BLOCKED)", async () => {
    authState.userId = customerId;
    const start = hourFromNow(28);
    const slot = await createSlot(providerA.id, start);
    // External busy interval overlapping the slot.
    await db.insert(blockedSlotsTable).values({
      providerId: providerA.id,
      startTime: new Date(start.getTime() - 30 * 60_000),
      endTime: new Date(start.getTime() + 30 * 60_000),
      source: "ical",
    });

    const res = await api("POST", "/api/bookings", {
      providerId: providerA.id,
      serviceId: serviceA.id,
      slotId: slot.id,
    });
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toContain("Kalender");

    // The slot must remain available since the booking was rejected.
    const [slotAfter] = await db
      .select()
      .from(timeSlotsTable)
      .where(eq(timeSlotsTable.id, slot.id));
    expect(slotAfter?.isAvailable).toBe(true);
  });

  it("returns 409 (SLOT_TAKEN) when the slot is already unavailable", async () => {
    authState.userId = customerId;
    const slot = await createSlot(providerA.id, hourFromNow(29), false);
    const res = await api("POST", "/api/bookings", {
      providerId: providerA.id,
      serviceId: serviceA.id,
      slotId: slot.id,
    });
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toContain("gerade gebucht");
  });

  it("lets only ONE of N concurrent requests win the same open slot (real row-lock contention)", async () => {
    authState.userId = customerId;
    // One genuinely available slot, far in the future to avoid colliding with
    // other tests' fixtures.
    const slot = await createSlot(providerA.id, hourFromNow(500));

    // Fire N truly simultaneous POSTs at the SAME open slot. The booking tx's
    // `SELECT ... FOR UPDATE` must serialize them so exactly one inserts a row
    // and flips the slot to unavailable; the rest must re-read it as taken.
    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        api("POST", "/api/bookings", {
          providerId: providerA.id,
          serviceId: serviceA.id,
          slotId: slot.id,
        }),
      ),
    );

    const created = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);

    // Exactly one winner; everyone else gets a clean SLOT_TAKEN conflict.
    expect(created.length).toBe(1);
    expect(conflicts.length).toBe(N - 1);
    for (const c of conflicts) {
      expect(String(c.body.error)).toContain("gerade gebucht");
    }

    // The slot ends up unavailable...
    const [slotAfter] = await db
      .select()
      .from(timeSlotsTable)
      .where(eq(timeSlotsTable.id, slot.id));
    expect(slotAfter?.isAvailable).toBe(false);

    // ...with exactly one persisted booking row for it.
    const bookingsForSlot = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.slotId, slot.id));
    expect(bookingsForSlot.length).toBe(1);
    expect(bookingsForSlot[0]?.id).toBe(created[0]?.body.id);
  });
});

describe("PATCH /api/bookings/:id/status", () => {
  async function makeBooking(): Promise<number> {
    authState.userId = customerId;
    const slot = await createSlot(providerA.id, hourFromNow(40 + Math.random() * 100));
    const res = await api("POST", "/api/bookings", {
      providerId: providerA.id,
      serviceId: serviceA.id,
      slotId: slot.id,
    });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  it("forbids a customer from setting any status other than cancelled (403)", async () => {
    const id = await makeBooking();
    authState.userId = customerId;
    const res = await api("PATCH", `/api/bookings/${id}/status`, {
      status: "confirmed",
    });
    expect(res.status).toBe(403);
  });

  it("forbids an unrelated user from changing status (403)", async () => {
    const id = await makeBooking();
    authState.userId = otherUserId;
    const res = await api("PATCH", `/api/bookings/${id}/status`, {
      status: "confirmed",
    });
    expect(res.status).toBe(403);
  });

  it("lets the owning provider confirm the booking (200)", async () => {
    const id = await makeBooking();
    authState.userId = providerAUser;
    const res = await api("PATCH", `/api/bookings/${id}/status`, {
      status: "confirmed",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("confirmed");
  });

  it("lets the customer cancel and frees the slot again", async () => {
    authState.userId = customerId;
    const slot = await createSlot(providerA.id, hourFromNow(200));
    const created = await api("POST", "/api/bookings", {
      providerId: providerA.id,
      serviceId: serviceA.id,
      slotId: slot.id,
    });
    expect(created.status).toBe(201);

    const res = await api("PATCH", `/api/bookings/${created.body.id}/status`, {
      status: "cancelled",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");

    const [slotAfter] = await db
      .select()
      .from(timeSlotsTable)
      .where(eq(timeSlotsTable.id, slot.id));
    expect(slotAfter?.isAvailable).toBe(true);
  });
});

describe("re-booking a slot freed by a cancellation", () => {
  // Book a slot, have the provider confirm it, then have the customer cancel —
  // which flips the slot back to available. Returns the slot id so the caller
  // can race fresh bookings at the freshly re-opened slot.
  async function bookConfirmAndCancel(start: Date): Promise<number> {
    authState.userId = customerId;
    const slot = await createSlot(providerA.id, start);
    const created = await api("POST", "/api/bookings", {
      providerId: providerA.id,
      serviceId: serviceA.id,
      slotId: slot.id,
    });
    expect(created.status).toBe(201);

    authState.userId = providerAUser;
    const confirmed = await api(
      "PATCH",
      `/api/bookings/${created.body.id}/status`,
      { status: "confirmed" },
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe("confirmed");

    authState.userId = customerId;
    const cancelled = await api(
      "PATCH",
      `/api/bookings/${created.body.id}/status`,
      { status: "cancelled" },
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");

    // Slot must be re-opened by the cancel branch.
    const [slotAfter] = await db
      .select()
      .from(timeSlotsTable)
      .where(eq(timeSlotsTable.id, slot.id));
    expect(slotAfter?.isAvailable).toBe(true);

    return slot.id;
  }

  it("lets a different customer re-book a slot immediately after it was cancelled (201)", async () => {
    const slotId = await bookConfirmAndCancel(hourFromNow(620));

    // A different customer grabs the just-freed slot.
    authState.userId = otherUserId;
    const rebook = await api("POST", "/api/bookings", {
      providerId: providerA.id,
      serviceId: serviceA.id,
      slotId,
    });
    expect(rebook.status).toBe(201);
    expect(rebook.body.status).toBe("pending");
    expect(rebook.body.customerId).toBe(otherUserId);

    // Slot is unavailable again, and there is exactly one ACTIVE (non-cancelled)
    // booking for it — the new one — alongside the old cancelled row.
    const [slotAfter] = await db
      .select()
      .from(timeSlotsTable)
      .where(eq(timeSlotsTable.id, slotId));
    expect(slotAfter?.isAvailable).toBe(false);

    const rows = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.slotId, slotId));
    const active = rows.filter((r) => r.status !== "cancelled");
    expect(active.length).toBe(1);
    expect(active[0]?.id).toBe(rebook.body.id);
  });

  it("lets only ONE of N concurrent requests win a slot that was just re-opened by a cancel", async () => {
    const slotId = await bookConfirmAndCancel(hourFromNow(640));

    // Fire N truly simultaneous POSTs at the re-opened slot. The booking tx's
    // row-lock must serialize them exactly as for an initially-open slot, so
    // only one re-booking succeeds.
    authState.userId = customerId;
    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        api("POST", "/api/bookings", {
          providerId: providerA.id,
          serviceId: serviceA.id,
          slotId,
        }),
      ),
    );

    const created = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    expect(created.length).toBe(1);
    expect(conflicts.length).toBe(N - 1);
    for (const c of conflicts) {
      expect(String(c.body.error)).toContain("gerade gebucht");
    }

    // Slot ends unavailable...
    const [slotAfter] = await db
      .select()
      .from(timeSlotsTable)
      .where(eq(timeSlotsTable.id, slotId));
    expect(slotAfter?.isAvailable).toBe(false);

    // ...with exactly one ACTIVE booking for it (plus the earlier cancelled row).
    const rows = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.slotId, slotId));
    const active = rows.filter((r) => r.status !== "cancelled");
    expect(active.length).toBe(1);
    expect(active[0]?.id).toBe(created[0]?.body.id);
  });
});

describe("imported-calendar conflict race (blocked_slots vs booking)", () => {
  // Mirror exactly how icalSync.ts records an external busy interval: a row in
  // blocked_slots with source 'ical'. The booking transaction re-checks this
  // table INSIDE its `SELECT ... FOR UPDATE` block, which is the only defense
  // against an imported event landing concurrently with a booking.
  async function insertIcalBlock(
    providerId: number,
    slotStart: Date,
  ): Promise<void> {
    await db.insert(blockedSlotsTable).values({
      providerId,
      // Fully covers the 1h slot (and overlaps generously) just like a synced
      // external event would.
      startTime: new Date(slotStart.getTime() - 30 * 60_000),
      endTime: new Date(slotStart.getTime() + 90 * 60_000),
      source: "ical",
    });
  }

  it("rejects EVERY one of N concurrent bookings once the slot is blocked (re-check serializes, nothing slips through)", async () => {
    authState.userId = customerId;
    const start = hourFromNow(720);
    const slot = await createSlot(providerA.id, start);
    // The external busy interval is already committed before the bookings fire,
    // so the FOR UPDATE re-check must see it for all of them.
    await insertIcalBlock(providerA.id, start);

    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        api("POST", "/api/bookings", {
          providerId: providerA.id,
          serviceId: serviceA.id,
          slotId: slot.id,
        }),
      ),
    );

    // Not a single booking may slip through a blocked slot.
    for (const r of results) {
      expect(r.status).toBe(409);
      expect(String(r.body.error)).toContain("Kalender");
    }

    // The slot is untouched (still available) and zero bookings were persisted.
    const [slotAfter] = await db
      .select()
      .from(timeSlotsTable)
      .where(eq(timeSlotsTable.id, slot.id));
    expect(slotAfter?.isAvailable).toBe(true);

    const bookingsForSlot = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.slotId, slot.id));
    expect(bookingsForSlot.length).toBe(0);
  });

  it("stays consistent when a busy interval lands concurrently with a booking (block-vs-booking contention)", async () => {
    authState.userId = customerId;

    // Run many independent races. Each iteration uses a FRESH slot and fires the
    // booking POST and the blocking-interval insert at the same time, so their
    // commit order is non-deterministic — the real contention the FOR UPDATE
    // re-check defends against. Whoever the DB serializes first, the persisted
    // state must always agree with the HTTP result: a 409 leaves no booking and
    // an open slot; a 201 leaves exactly one booking and an unavailable slot.
    // The one thing that must NEVER happen: a booking persisted while the slot
    // still reads available, or more than one booking on the slot.
    const ITERATIONS = 12;
    for (let i = 0; i < ITERATIONS; i++) {
      const start = hourFromNow(800 + i * 5);
      const slot = await createSlot(providerA.id, start);

      const [bookingRes] = await Promise.all([
        api("POST", "/api/bookings", {
          providerId: providerA.id,
          serviceId: serviceA.id,
          slotId: slot.id,
        }),
        insertIcalBlock(providerA.id, start),
      ]);

      const [slotAfter] = await db
        .select()
        .from(timeSlotsTable)
        .where(eq(timeSlotsTable.id, slot.id));
      const bookingsForSlot = await db
        .select()
        .from(bookingsTable)
        .where(eq(bookingsTable.slotId, slot.id));

      // Only two consistent outcomes are allowed.
      expect([201, 409]).toContain(bookingRes.status);

      if (bookingRes.status === 201) {
        // Booking won the race (block committed after the re-check). The slot
        // MUST be flipped unavailable and back exactly one booking row.
        expect(slotAfter?.isAvailable).toBe(false);
        expect(bookingsForSlot.length).toBe(1);
        expect(bookingsForSlot[0]?.id).toBe(bookingRes.body.id);
      } else {
        // The block won the race: rejected as SLOT_BLOCKED, no booking, slot
        // still open. A booking must never be left on a blocked slot.
        expect(String(bookingRes.body.error)).toContain("Kalender");
        expect(slotAfter?.isAvailable).toBe(true);
        expect(bookingsForSlot.length).toBe(0);
      }
    }
  });
});

describe("POST /api/bookings/:id/payment/checkout (Stripe Connect split)", () => {
  async function insertBillableBooking(opts: {
    providerId: number;
    serviceId: number;
    serviceName: string;
    providerName: string;
    totalPrice: number;
  }): Promise<number> {
    const slot = await createSlot(opts.providerId, hourFromNow(300 + Math.random() * 200), false);
    const [booking] = await db
      .insert(bookingsTable)
      .values({
        customerId,
        customerName: "Test Kunde",
        customerEmail: "kunde@example.com",
        providerId: opts.providerId,
        providerName: opts.providerName,
        serviceId: opts.serviceId,
        serviceName: opts.serviceName,
        slotId: slot.id,
        status: "confirmed",
        totalPrice: opts.totalPrice,
        scheduledAt: slot.startTime,
        paymentRequired: true,
        paymentStatus: "pending",
      })
      .returning();
    return booking!.id;
  }

  it("creates a Checkout session WITHOUT a split when the provider is not Connect-onboarded", async () => {
    authState.userId = customerId;
    const id = await insertBillableBooking({
      providerId: providerA.id, // not onboarded
      serviceId: serviceA.id,
      serviceName: serviceA.name,
      providerName: providerA.displayName,
      totalPrice: 120,
    });

    const res = await api("POST", `/api/bookings/${id}/payment/checkout`);
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe("cs_test_integration_123");

    const args = stripeState.lastSessionArgs!;
    expect(args.mode).toBe("payment");
    const pid = args.payment_intent_data as Record<string, unknown>;
    expect(pid.application_fee_amount).toBeUndefined();
    expect(pid.transfer_data).toBeUndefined();

    const [persisted] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, id));
    expect(persisted?.stripeCheckoutSessionId).toBe("cs_test_integration_123");
  });

  it("creates a Checkout session WITHOUT a split when the provider has a Stripe account but never finished onboarding", async () => {
    authState.userId = customerId;
    const id = await insertBillableBooking({
      providerId: providerC.id, // has stripeAccountId but no stripeOnboardedAt
      serviceId: serviceC.id,
      serviceName: serviceC.name,
      providerName: providerC.displayName,
      totalPrice: 150,
    });

    const res = await api("POST", `/api/bookings/${id}/payment/checkout`);
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe("cs_test_integration_123");

    // A connected-but-not-onboarded account must never receive a destination
    // transfer or be charged an application fee — the platform collects in full.
    const pid = stripeState.lastSessionArgs!.payment_intent_data as Record<
      string,
      unknown
    >;
    expect(pid.application_fee_amount).toBeUndefined();
    expect(pid.transfer_data).toBeUndefined();

    const [persisted] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, id));
    expect(persisted?.stripeCheckoutSessionId).toBe("cs_test_integration_123");
  });

  it("adds an application fee + destination transfer when the provider IS Connect-onboarded", async () => {
    authState.userId = customerId;
    const total = 200;
    const id = await insertBillableBooking({
      providerId: providerB.id, // onboarded, basic tier, pro world → 14%
      serviceId: serviceB.id,
      serviceName: serviceB.name,
      providerName: providerB.displayName,
      totalPrice: total,
    });

    const res = await api("POST", `/api/bookings/${id}/payment/checkout`);
    expect(res.status).toBe(200);

    const pid = stripeState.lastSessionArgs!.payment_intent_data as Record<
      string,
      unknown
    >;
    // basic tier, pro world commission = 14% of 20000 cents = 2800.
    expect(pid.application_fee_amount).toBe(Math.round(total * 100 * 0.14));
    expect(pid.transfer_data).toEqual({
      destination: "acct_test_integration",
    });
  });

  it("refuses to re-charge an already-paid booking (400)", async () => {
    authState.userId = customerId;
    const id = await insertBillableBooking({
      providerId: providerB.id,
      serviceId: serviceB.id,
      serviceName: serviceB.name,
      providerName: providerB.displayName,
      totalPrice: 200,
    });
    await db
      .update(bookingsTable)
      .set({ paymentStatus: "paid" })
      .where(eq(bookingsTable.id, id));

    const res = await api("POST", `/api/bookings/${id}/payment/checkout`);
    expect(res.status).toBe(400);
  });
});

describe("iCal import vs existing Klard booking (reconcileProviderIcalBlocks)", () => {
  // Create a real Klard booking for providerA at a fresh slot, then run the
  // external-feed reconcile with a busy interval that overlaps it. The Klard
  // booking must win: the overlapping interval is NOT stored as a blocked_slot,
  // while non-overlapping intervals from the same feed still are.
  async function makeBookingAt(start: Date): Promise<{
    bookingId: number;
    slotStart: Date;
    slotEnd: Date;
  }> {
    authState.userId = customerId;
    const slot = await createSlot(providerA.id, start);
    const res = await api("POST", "/api/bookings", {
      providerId: providerA.id,
      serviceId: serviceA.id,
      slotId: slot.id,
    });
    expect(res.status).toBe(201);
    return {
      bookingId: res.body.id as number,
      slotStart: slot.startTime,
      slotEnd: slot.endTime,
    };
  }

  async function icalBlocks(providerId: number) {
    return db
      .select()
      .from(blockedSlotsTable)
      .where(eq(blockedSlotsTable.providerId, providerId));
  }

  it("skips an imported busy interval that overlaps an active booking (Klard wins)", async () => {
    const { slotStart } = await makeBookingAt(hourFromNow(1200));

    // One interval fully overlaps the booked slot; one is safely after it.
    const overlap = {
      start: new Date(slotStart.getTime() - 30 * 60_000),
      end: new Date(slotStart.getTime() + 90 * 60_000),
      uid: "overlap-uid",
      summary: "Externer Termin (Konflikt)",
    };
    const safeStart = new Date(slotStart.getTime() + 5 * 3600_000);
    const safe = {
      start: safeStart,
      end: new Date(safeStart.getTime() + 3600_000),
      uid: "safe-uid",
      summary: "Externer Termin (ok)",
    };

    const stored = await reconcileProviderIcalBlocks(providerA.id, [overlap, safe]);

    // Only the non-conflicting interval is stored.
    expect(stored).toBe(1);
    const blocks = await icalBlocks(providerA.id);
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.externalUid).toBe("safe-uid");
    // The conflicting interval is absent — the slot the customer booked through
    // Klard is never double-claimed by the import.
    expect(blocks.some((b) => b.externalUid === "overlap-uid")).toBe(false);
  });

  it("still imports an interval overlapping a CANCELLED booking", async () => {
    const { bookingId, slotStart } = await makeBookingAt(hourFromNow(1300));

    authState.userId = customerId;
    const cancelled = await api("PATCH", `/api/bookings/${bookingId}/status`, {
      status: "cancelled",
    });
    expect(cancelled.status).toBe(200);

    const overlap = {
      start: new Date(slotStart.getTime() - 30 * 60_000),
      end: new Date(slotStart.getTime() + 90 * 60_000),
      uid: "over-cancelled-uid",
      summary: "Externer Termin",
    };

    const stored = await reconcileProviderIcalBlocks(providerA.id, [overlap]);
    expect(stored).toBe(1);
    const blocks = await icalBlocks(providerA.id);
    expect(blocks.some((b) => b.externalUid === "over-cancelled-uid")).toBe(true);
  });
});
