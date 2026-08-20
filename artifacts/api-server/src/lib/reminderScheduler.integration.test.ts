import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";

// ---------------------------------------------------------------------------
// Integration tests for the auto-complete cleanup job's "invoice safety-net"
// (`autoCompleteBookings` in reminderScheduler.ts).
//
// Invoices are normally issued at payment time by the Stripe webhook. If that
// webhook is missed mid-flight, a paid customer would never receive an invoice.
// The scheduler's auto-complete pass is the safety-net: when it flips a past
// booking to `completed`, it back-fills the missing invoice for paid,
// platform-billed bookings. This path is separate from (and untested by) the
// webhook-fired coverage in invoiceService.integration.test.ts.
//
// We run the real numbering + DB logic against the live (development) Postgres,
// mocking only the external edges:
//   - the PDF renderer (`invoicePdf`),
//   - object storage (`objectStorage` + `objectAcl`), in-memory backed,
//   - the Resend email send (`email`), so no real mail leaves the box.
// ---------------------------------------------------------------------------

const storageState = vi.hoisted(() => ({ files: new Map<string, Buffer>() }));

vi.mock("../lib/invoicePdf", () => ({
  renderInvoicePdf: vi.fn(async () => Buffer.from("%PDF-1.4 fake invoice")),
}));

vi.mock("../lib/objectStorage", () => {
  class ObjectStorageService {
    getPrivateObjectDir() {
      return "/test-bucket";
    }
  }
  return {
    ObjectStorageService,
    objectStorageClient: {
      bucket: (_bucketName: string) => ({
        file: (objectName: string) => ({
          save: async (buf: Buffer) => {
            storageState.files.set(objectName, buf);
          },
          exists: async () => [storageState.files.has(objectName)],
          download: async () => [storageState.files.get(objectName)],
        }),
      }),
    },
  };
});

vi.mock("../lib/objectAcl", () => ({
  setObjectAclPolicy: async () => {},
  ObjectPermission: { READ: "read", WRITE: "write" },
}));

const emailSpy = vi.hoisted(() => ({
  sendInvoiceWithAttachment: vi.fn(async () => undefined),
  sendBookingReminder: vi.fn(async () => undefined),
  sendBookingReminder1h: vi.fn(async () => undefined),
  wasEmailSent: vi.fn(async () => false),
}));
vi.mock("../lib/email", () => ({
  sendInvoiceWithAttachment: emailSpy.sendInvoiceWithAttachment,
  sendBookingReminder: emailSpy.sendBookingReminder,
  sendBookingReminder1h: emailSpy.sendBookingReminder1h,
  wasEmailSent: emailSpy.wasEmailSent,
}));

import { autoCompleteBookings } from "./reminderScheduler";
import {
  db,
  providersTable,
  servicesTable,
  timeSlotsTable,
  categoriesTable,
  bookingsTable,
  invoicesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const sfx = `schedtest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const customerId = `${sfx}_customer`;
const providerUser = `${sfx}_provider`;
const categorySlug = `${sfx}_cat`;
const directCategorySlug = `${sfx}_direct`;
const INVOICE_PREFIX = "SCH";

let provider: typeof providersTable.$inferSelect;
let directProvider: typeof providersTable.$inferSelect;
let service: typeof servicesTable.$inferSelect;
let directService: typeof servicesTable.$inferSelect;

const YEAR = new Date().getFullYear();

// Creates a slot whose end time is already in the PAST, so the auto-complete
// pass will pick up any booking attached to it.
async function createPastSlot(
  forProvider: typeof providersTable.$inferSelect,
): Promise<typeof timeSlotsTable.$inferSelect> {
  // Spread start times so concurrently-created slots don't collide and each
  // booking maps to a unique past slot.
  const start = new Date(Date.now() - (2 + Math.random() * 1000) * 3600_000);
  const [slot] = await db
    .insert(timeSlotsTable)
    .values({
      providerId: forProvider.id,
      startTime: start,
      endTime: new Date(start.getTime() + 3600_000),
      isAvailable: false,
    })
    .returning();
  return slot!;
}

async function insertPastBooking(opts: {
  forProvider?: typeof providersTable.$inferSelect;
  forService?: typeof servicesTable.$inferSelect;
  paymentRequired?: boolean;
  paymentStatus?: "pending" | "paid" | "failed";
  status?: "pending" | "confirmed" | "completed";
  totalPrice?: number;
} = {}): Promise<number> {
  const p = opts.forProvider ?? provider;
  const s = opts.forService ?? service;
  const slot = await createPastSlot(p);
  const [booking] = await db
    .insert(bookingsTable)
    .values({
      customerId,
      customerName: "Erika Mustermann",
      customerEmail: "erika@example.com",
      providerId: p.id,
      providerName: p.displayName,
      serviceId: s.id,
      serviceName: s.name,
      slotId: slot.id,
      status: opts.status ?? "confirmed",
      totalPrice: opts.totalPrice ?? 120,
      scheduledAt: slot.startTime,
      paymentRequired: opts.paymentRequired ?? true,
      paymentStatus: opts.paymentStatus ?? "paid",
    })
    .returning();
  return booking!.id;
}

beforeAll(async () => {
  await db.insert(categoriesTable).values([
    { name: "Scheduler Test Kategorie", slug: categorySlug, requiresDirectBilling: false },
    { name: "Scheduler Direkt Kategorie", slug: directCategorySlug, requiresDirectBilling: true },
  ]);

  const [p] = await db
    .insert(providersTable)
    .values({
      clerkUserId: providerUser,
      approvalStatus: "approved",
      displayName: "Scheduler Berater (test)",
      email: "scheduler-berater@example.com",
      category: "Scheduler Test Kategorie",
      categorySlug,
      city: "Hamburg",
      zip: "20095",
      companyLegalName: "Berater GmbH",
      address: "Teststrasse 1",
      taxId: "DE123456789",
      iban: "DE00 0000 0000 0000 0000 00",
      vatRate: "19.00",
      kleinunternehmer: false,
      invoicePrefix: INVOICE_PREFIX,
      nextInvoiceNumber: 1,
      autoIssueInvoices: true,
    })
    .returning();
  provider = p!;

  const [dp] = await db
    .insert(providersTable)
    .values({
      clerkUserId: `${providerUser}_direct`,
      approvalStatus: "approved",
      displayName: "Direkt Berater (test)",
      email: "scheduler-direkt@example.com",
      category: "Scheduler Direkt Kategorie",
      categorySlug: directCategorySlug,
      city: "Hamburg",
      zip: "20095",
      vatRate: "19.00",
      invoicePrefix: "SDR",
      nextInvoiceNumber: 1,
      autoIssueInvoices: true,
    })
    .returning();
  directProvider = dp!;

  const [s] = await db
    .insert(servicesTable)
    .values({ providerId: provider.id, name: "Erstberatung", price: 120, durationMinutes: 60 })
    .returning();
  service = s!;

  const [ds] = await db
    .insert(servicesTable)
    .values({ providerId: directProvider.id, name: "Rechtsberatung", price: 200, durationMinutes: 60 })
    .returning();
  directService = ds!;
});

afterAll(async () => {
  const ids = [provider?.id, directProvider?.id].filter(Boolean) as number[];
  if (ids.length) {
    await db.delete(invoicesTable).where(inArray(invoicesTable.providerId, ids));
  }
  await db.delete(bookingsTable).where(eq(bookingsTable.customerId, customerId));
  for (const id of ids) {
    await db.delete(timeSlotsTable).where(eq(timeSlotsTable.providerId, id));
    await db.delete(servicesTable).where(eq(servicesTable.providerId, id));
  }
  if (ids.length) {
    await db.delete(providersTable).where(inArray(providersTable.id, ids));
  }
  await db
    .delete(categoriesTable)
    .where(inArray(categoriesTable.slug, [categorySlug, directCategorySlug]));
});

beforeEach(() => {
  emailSpy.sendInvoiceWithAttachment.mockClear();
});

describe("autoCompleteBookings — invoice safety-net back-fills paid bookings", () => {
  it("issues exactly one invoice for a past, paid, billable booking with no prior invoice", async () => {
    const bookingId = await insertPastBooking({ totalPrice: 120 });

    // Sanity: no invoice exists before the cleanup pass.
    const before = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.bookingId, bookingId));
    expect(before.length).toBe(0);

    await autoCompleteBookings(new Date());

    // The booking is now completed.
    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId));
    expect(booking?.status).toBe("completed");

    // Exactly one invoice was back-filled, with correct totals and number.
    const rows = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.bookingId, bookingId));
    expect(rows.length).toBe(1);

    const inv = rows[0]!;
    expect(inv.invoiceNumber).toBe(`${INVOICE_PREFIX}-${YEAR}-0001`);
    expect(inv.kind).toBe("invoice");
    expect(inv.status).toBe("issued");
    // 120 EUR gross @ 19% → net 10084, tax 1916, total 12000 (cents).
    expect(inv.totalCents).toBe(12000);
    expect(inv.netCents).toBe(10084);
    expect(inv.taxCents).toBe(1916);
    expect(inv.netCents + inv.taxCents).toBe(inv.totalCents);
    expect(inv.taxRate).toBe("19.00");
    expect(inv.pdfObjectKey).toBeTruthy();

    // The invoice email was sent exactly once for the newly created invoice.
    expect(emailSpy.sendInvoiceWithAttachment).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — a second pass over the same booking creates no duplicate invoice", async () => {
    const bookingId = await insertPastBooking({ totalPrice: 120 });

    await autoCompleteBookings(new Date());
    const afterFirst = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.bookingId, bookingId));
    expect(afterFirst.length).toBe(1);
    const firstNumber = afterFirst[0]!.invoiceNumber;

    // Re-run: booking is already completed, so it won't even be picked up, but
    // even if it were, issueInvoiceForBooking is idempotent.
    emailSpy.sendInvoiceWithAttachment.mockClear();
    await autoCompleteBookings(new Date());

    const afterSecond = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.bookingId, bookingId));
    expect(afterSecond.length).toBe(1);
    expect(afterSecond[0]!.invoiceNumber).toBe(firstNumber);
    // No second email for an already-invoiced booking.
    expect(emailSpy.sendInvoiceWithAttachment).not.toHaveBeenCalled();
  });
});

describe("autoCompleteBookings — completes but does NOT invoice ineligible bookings", () => {
  it("does not issue an invoice for an unpaid booking", async () => {
    const bookingId = await insertPastBooking({ paymentStatus: "pending" });

    await autoCompleteBookings(new Date());

    // Still gets completed by the cleanup job …
    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId));
    expect(booking?.status).toBe("completed");

    // … but no invoice is back-filled for an unpaid booking.
    const rows = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.bookingId, bookingId));
    expect(rows.length).toBe(0);
  });

  it("does not issue an invoice for a non-platform-billed (paymentRequired=false) booking", async () => {
    const bookingId = await insertPastBooking({
      paymentRequired: false,
      paymentStatus: "pending",
    });

    await autoCompleteBookings(new Date());

    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId));
    expect(booking?.status).toBe("completed");

    const rows = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.bookingId, bookingId));
    expect(rows.length).toBe(0);
  });

  it("does not issue an invoice for a paid direct-billing (RVG/StBVV) booking", async () => {
    const bookingId = await insertPastBooking({
      forProvider: directProvider,
      forService: directService,
      totalPrice: 200,
      paymentStatus: "paid",
    });

    await autoCompleteBookings(new Date());

    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId));
    expect(booking?.status).toBe("completed");

    const rows = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.bookingId, bookingId));
    expect(rows.length).toBe(0);
  });
});
