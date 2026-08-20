import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// ---------------------------------------------------------------------------
// Integration tests for reconcileProviderIcalBlocks conflict surfacing
// (icalSync.ts).
//
// When an imported external busy interval overlaps an active (non-cancelled)
// Klard booking, the Klard booking wins: the interval is NOT stored in
// blocked_slots, and the conflict is persisted in ical_booking_conflicts so the
// provider can see and fix the clash. This is a full-refresh table — a resolved
// conflict (event or booking gone) disappears on the next sync.
//
// We run the real reconcile against the live (development) Postgres. The only
// external edge is the email nudge, which we stub so no mail is attempted.
// ---------------------------------------------------------------------------

vi.mock("./email", () => ({
  notifyProviderIcalConflict: vi.fn(async () => {}),
  wasEmailSent: vi.fn(async () => false),
}));

import { reconcileProviderIcalBlocks } from "./icalSync";
import {
  db,
  providersTable,
  bookingsTable,
  timeSlotsTable,
  blockedSlotsTable,
  icalBookingConflictsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const sfx = `icalconf_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

let providerId: number;
let slotId: number;
let bookingId: number;

const BOOK_START = new Date("2099-03-10T10:00:00.000Z");
const BOOK_END = new Date("2099-03-10T11:00:00.000Z");

async function seed(): Promise<void> {
  const [provider] = await db
    .insert(providersTable)
    .values({
      clerkUserId: `${sfx}_user`,
      approvalStatus: "approved",
      displayName: "Test Berater",
      email: `${sfx}@example.com`,
      category: "Architektur",
      categorySlug: "architektur",
      city: "Berlin",
      zip: "10115",
    })
    .returning({ id: providersTable.id });
  providerId = provider!.id;

  const [slot] = await db
    .insert(timeSlotsTable)
    .values({
      providerId,
      startTime: BOOK_START,
      endTime: BOOK_END,
      isAvailable: false,
    })
    .returning({ id: timeSlotsTable.id });
  slotId = slot!.id;

  const [booking] = await db
    .insert(bookingsTable)
    .values({
      customerId: `${sfx}_customer`,
      customerName: "Max Mustermann",
      providerId,
      providerName: "Test Berater",
      serviceId: 1,
      serviceName: "Erstberatung",
      slotId,
      status: "confirmed",
      totalPrice: 100,
      scheduledAt: BOOK_START,
    })
    .returning({ id: bookingsTable.id });
  bookingId = booking!.id;
}

async function cleanup(): Promise<void> {
  if (!providerId) return;
  await db.delete(icalBookingConflictsTable).where(eq(icalBookingConflictsTable.providerId, providerId));
  await db.delete(blockedSlotsTable).where(eq(blockedSlotsTable.providerId, providerId));
  await db.delete(bookingsTable).where(eq(bookingsTable.providerId, providerId));
  await db.delete(timeSlotsTable).where(eq(timeSlotsTable.providerId, providerId));
  await db.delete(providersTable).where(eq(providersTable.id, providerId));
}

beforeEach(async () => {
  await cleanup();
  await seed();
});

afterAll(async () => {
  await cleanup();
});

describe("reconcileProviderIcalBlocks — surfaces conflicts with Klard bookings", () => {
  it("persists a conflict and skips the blocked slot when an interval overlaps a booking", async () => {
    const stored = await reconcileProviderIcalBlocks(providerId, [
      { start: new Date("2099-03-10T10:30:00.000Z"), end: new Date("2099-03-10T11:30:00.000Z"), uid: "ext-1", summary: "Zahnarzt" },
    ]);

    // Overlapping interval is NOT stored as a blocked slot.
    expect(stored).toBe(0);
    const blocks = await db.select().from(blockedSlotsTable).where(eq(blockedSlotsTable.providerId, providerId));
    expect(blocks.length).toBe(0);

    // The conflict is persisted with the booking + external snapshots.
    const conflicts = await db
      .select()
      .from(icalBookingConflictsTable)
      .where(eq(icalBookingConflictsTable.providerId, providerId));
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.bookingId).toBe(bookingId);
    expect(conflicts[0]!.bookingCustomerName).toBe("Max Mustermann");
    expect(conflicts[0]!.bookingServiceName).toBe("Erstberatung");
    expect(conflicts[0]!.externalSummary).toBe("Zahnarzt");
  });

  it("stores non-overlapping intervals and records no conflict", async () => {
    const stored = await reconcileProviderIcalBlocks(providerId, [
      { start: new Date("2099-03-11T10:00:00.000Z"), end: new Date("2099-03-11T11:00:00.000Z"), uid: "ext-2", summary: "Frei" },
    ]);

    expect(stored).toBe(1);
    const conflicts = await db
      .select()
      .from(icalBookingConflictsTable)
      .where(eq(icalBookingConflictsTable.providerId, providerId));
    expect(conflicts.length).toBe(0);
  });

  it("full-refreshes conflicts — a resolved clash disappears on the next sync", async () => {
    await reconcileProviderIcalBlocks(providerId, [
      { start: new Date("2099-03-10T10:30:00.000Z"), end: new Date("2099-03-10T11:30:00.000Z"), uid: "ext-1", summary: "Zahnarzt" },
    ]);
    let conflicts = await db
      .select()
      .from(icalBookingConflictsTable)
      .where(eq(icalBookingConflictsTable.providerId, providerId));
    expect(conflicts.length).toBe(1);

    // The provider removed the clashing external event; next sync has no overlap.
    await reconcileProviderIcalBlocks(providerId, [
      { start: new Date("2099-03-12T10:00:00.000Z"), end: new Date("2099-03-12T11:00:00.000Z"), uid: "ext-3", summary: "Frei" },
    ]);
    conflicts = await db
      .select()
      .from(icalBookingConflictsTable)
      .where(eq(icalBookingConflictsTable.providerId, providerId));
    expect(conflicts.length).toBe(0);
  });
});
