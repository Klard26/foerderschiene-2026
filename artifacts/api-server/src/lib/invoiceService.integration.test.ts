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
// Integration tests for the invoice service (issueInvoiceForBooking,
// issueStornoForBooking, sendInvoiceEmail).
//
// This is the money-sensitive bookkeeping surface that the Stripe webhook
// fires after a booking is paid. A regression in sequential invoice
// numbering, net/tax totals, or idempotency would silently produce duplicate
// or malformed invoices, so we exercise the real numbering + DB logic against
// the live (development) Postgres database.
//
// Only the external edges are mocked:
//   - the PDF renderer (`invoicePdf`), so no real PDF is produced,
//   - object storage (`objectStorage` + `objectAcl`), backed by an in-memory
//     map so save → download round-trips like the real bucket,
//   - the Resend email send (`email`), so no real mail leaves the box.
//
// The numbering, totals split, idempotency guards (booking+kind unique index),
// and the storno path all run for real and are asserted directly from the DB.
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
}));
vi.mock("../lib/email", () => ({
  sendInvoiceWithAttachment: emailSpy.sendInvoiceWithAttachment,
}));

import {
  issueInvoiceForBooking,
  issueStornoForBooking,
  sendInvoiceEmail,
} from "./invoiceService";
import {
  db,
  providersTable,
  servicesTable,
  timeSlotsTable,
  categoriesTable,
  bookingsTable,
  invoicesTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

const sfx = `invtest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const customerId = `${sfx}_customer`;
const providerUser = `${sfx}_provider`;
const categorySlug = `${sfx}_cat`;
const directCategorySlug = `${sfx}_direct`;
const INVOICE_PREFIX = "TST";

let provider: typeof providersTable.$inferSelect;
let directProvider: typeof providersTable.$inferSelect;
let service: typeof servicesTable.$inferSelect;
let directService: typeof servicesTable.$inferSelect;

const YEAR = new Date().getFullYear();

function hourFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 3600_000);
}

async function createSlot(
  forProvider: typeof providersTable.$inferSelect,
  start: Date,
): Promise<typeof timeSlotsTable.$inferSelect> {
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

async function insertBooking(opts: {
  forProvider?: typeof providersTable.$inferSelect;
  forService?: typeof servicesTable.$inferSelect;
  paymentStatus?: "pending" | "paid" | "failed";
  totalPrice?: number;
  customerName?: string;
  customerEmail?: string | null;
} = {}): Promise<number> {
  const p = opts.forProvider ?? provider;
  const s = opts.forService ?? service;
  const slot = await createSlot(p, hourFromNow(100 + Math.random() * 5000));
  const [booking] = await db
    .insert(bookingsTable)
    .values({
      customerId,
      customerName: opts.customerName ?? "Erika Mustermann",
      customerEmail:
        opts.customerEmail === undefined ? "erika@example.com" : opts.customerEmail,
      providerId: p.id,
      providerName: p.displayName,
      serviceId: s.id,
      serviceName: s.name,
      slotId: slot.id,
      status: "confirmed",
      totalPrice: opts.totalPrice ?? 120,
      scheduledAt: slot.startTime,
      paymentRequired: true,
      paymentStatus: opts.paymentStatus ?? "paid",
    })
    .returning();
  return booking!.id;
}

beforeAll(async () => {
  await db.insert(categoriesTable).values([
    { name: "Invoice Test Kategorie", slug: categorySlug, requiresDirectBilling: false },
    { name: "Invoice Direkt Kategorie", slug: directCategorySlug, requiresDirectBilling: true },
  ]);

  const [p] = await db
    .insert(providersTable)
    .values({
      clerkUserId: providerUser,
      approvalStatus: "approved",
      displayName: "Invoice Berater (test)",
      email: "invoice-berater@example.com",
      category: "Invoice Test Kategorie",
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
      email: "direkt-berater@example.com",
      category: "Invoice Direkt Kategorie",
      categorySlug: directCategorySlug,
      city: "Hamburg",
      zip: "20095",
      vatRate: "19.00",
      invoicePrefix: "DIR",
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

describe("issueInvoiceForBooking — a fresh paid booking", () => {
  it("issues exactly one invoice with correct number, totals, and party data", async () => {
    const bookingId = await insertBooking({ totalPrice: 120 });

    const result = await issueInvoiceForBooking({ bookingId });
    expect(result).not.toBeNull();
    expect(result!.created).toBe(true);

    const inv = result!.invoice;
    // Number format: <prefix>-<year>-<4 digits>, first reserved number is 0001.
    expect(inv.invoiceNumber).toBe(`${INVOICE_PREFIX}-${YEAR}-0001`);
    expect(inv.kind).toBe("invoice");
    expect(inv.status).toBe("issued");

    // 120 EUR gross @ 19% → net 10084, tax 1916, total 12000 (cents).
    expect(inv.totalCents).toBe(12000);
    expect(inv.netCents).toBe(10084);
    expect(inv.taxCents).toBe(1916);
    expect(inv.netCents + inv.taxCents).toBe(inv.totalCents);
    expect(inv.taxRate).toBe("19.00");
    expect(inv.currency).toBe("EUR");

    // Customer + service + provider snapshot copied onto the invoice.
    expect(inv.customerName).toBe("Erika Mustermann");
    expect(inv.customerEmail).toBe("erika@example.com");
    expect(inv.serviceName).toBe("Erstberatung");
    const snap = inv.providerSnapshot as Record<string, unknown>;
    expect(snap.displayName).toBe("Invoice Berater (test)");
    expect(snap.companyLegalName).toBe("Berater GmbH");
    expect(snap.taxId).toBe("DE123456789");

    // A PDF was rendered, uploaded, and the key persisted.
    expect(inv.pdfObjectKey).toBeTruthy();

    // Exactly one invoice row exists for this booking.
    const rows = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.bookingId, bookingId));
    expect(rows.length).toBe(1);
  });

  it("assigns sequential invoice numbers per provider", async () => {
    const bookingId = await insertBooking({ totalPrice: 120 });
    const result = await issueInvoiceForBooking({ bookingId });
    expect(result).not.toBeNull();
    // Second invoice for the provider → 0002.
    expect(result!.invoice.invoiceNumber).toBe(`${INVOICE_PREFIX}-${YEAR}-0002`);
  });

  it("applies kleinunternehmer (0% VAT) so net equals gross", async () => {
    await db
      .update(providersTable)
      .set({ kleinunternehmer: true })
      .where(eq(providersTable.id, provider.id));
    try {
      const bookingId = await insertBooking({ totalPrice: 100 });
      const result = await issueInvoiceForBooking({ bookingId });
      expect(result).not.toBeNull();
      const inv = result!.invoice;
      expect(inv.totalCents).toBe(10000);
      expect(inv.netCents).toBe(10000);
      expect(inv.taxCents).toBe(0);
      expect(inv.taxRate).toBe("0.00");
    } finally {
      await db
        .update(providersTable)
        .set({ kleinunternehmer: false })
        .where(eq(providersTable.id, provider.id));
    }
  });
});

describe("issueInvoiceForBooking — concurrent contention (no duplicate numbers)", () => {
  it("assigns unique, contiguous invoice numbers to N simultaneous issuances", async () => {
    const N = 8;
    // N distinct paid bookings, all for the SAME provider — so they all race
    // for that provider's invoice-number counter.
    const bookingIds = await Promise.all(
      Array.from({ length: N }, () => insertBooking({ totalPrice: 120 })),
    );

    // Capture the provider's next number BEFORE the race, so we know the exact
    // contiguous block these issuances must occupy (earlier tests already
    // consumed some numbers, so we can't assume it starts at 0001).
    const [before] = await db
      .select({ next: providersTable.nextInvoiceNumber })
      .from(providersTable)
      .where(eq(providersTable.id, provider.id));
    const startNum = before!.next;

    // Fire all N issuances truly simultaneously. reserveInvoiceNumber's single
    // atomic `UPDATE ... RETURNING` must serialize the increments so no two
    // handlers ever read back the same number (the real-contention pattern from
    // the slot row-lock test in bookingsBilling.integration.test.ts).
    const results = await Promise.all(
      bookingIds.map((bookingId) => issueInvoiceForBooking({ bookingId })),
    );

    // Every call created a fresh invoice (none skipped or idempotent-hit).
    for (const r of results) {
      expect(r).not.toBeNull();
      expect(r!.created).toBe(true);
    }

    // Extract the numeric component of each assigned invoice number.
    const nums = results
      .map((r) => r!.invoice.invoiceNumber)
      .map((s) => {
        const m = s.match(/-(\d+)$/);
        return Number(m![1]);
      })
      .sort((a, b) => a - b);

    // No two issuances grabbed the same number.
    expect(new Set(nums).size).toBe(N);

    // The numbers form a gap-free, contiguous block: startNum .. startNum+N-1.
    const expected = Array.from({ length: N }, (_, i) => startNum + i);
    expect(nums).toEqual(expected);

    // The provider's counter advanced by exactly N — no lost or double increments.
    const [after] = await db
      .select({ next: providersTable.nextInvoiceNumber })
      .from(providersTable)
      .where(eq(providersTable.id, provider.id));
    expect(after!.next).toBe(startNum + N);

    // The DB holds exactly N invoice rows for these bookings, all with distinct
    // numbers — proving the uniqueness survives the round-trip to Postgres.
    const persisted = await db
      .select({ invoiceNumber: invoicesTable.invoiceNumber })
      .from(invoicesTable)
      .where(inArray(invoicesTable.bookingId, bookingIds));
    expect(persisted.length).toBe(N);
    expect(new Set(persisted.map((p) => p.invoiceNumber)).size).toBe(N);
  });
});

describe("issueStornoForBooking — concurrent contention (no duplicate numbers)", () => {
  it("assigns unique, contiguous storno numbers to N simultaneous cancellations", async () => {
    const N = 8;
    // N distinct paid bookings, each already carrying its own original invoice,
    // all for the SAME provider — so the cancellations race for that provider's
    // invoice-number counter exactly like fresh payments do.
    const bookingIds = await Promise.all(
      Array.from({ length: N }, () => insertBooking({ totalPrice: 120 })),
    );
    // Issue the originals sequentially first so each booking has an invoice to
    // cancel. (These consume their own numbers; we only race the stornos.)
    for (const bookingId of bookingIds) {
      const issued = await issueInvoiceForBooking({ bookingId });
      expect(issued).not.toBeNull();
    }

    // Capture the provider's next number BEFORE the storno race, so we know the
    // exact contiguous block these stornos must occupy.
    const [before] = await db
      .select({ next: providersTable.nextInvoiceNumber })
      .from(providersTable)
      .where(eq(providersTable.id, provider.id));
    const startNum = before!.next;

    // Fire all N stornos truly simultaneously. They draw from the SAME
    // reserveInvoiceNumber as payments, so the single atomic UPDATE … RETURNING
    // must serialize the increments — no two stornos may share a number.
    const stornos = await Promise.all(
      bookingIds.map((bookingId) => issueStornoForBooking(bookingId)),
    );

    // Every cancellation produced a fresh storno (none null / idempotent-hit).
    for (const s of stornos) {
      expect(s).not.toBeNull();
      expect(s!.kind).toBe("storno");
    }

    const nums = stornos
      .map((s) => s!.invoiceNumber)
      .map((str) => {
        const m = str.match(/-(\d+)$/);
        return Number(m![1]);
      })
      .sort((a, b) => a - b);

    // No two stornos grabbed the same number.
    expect(new Set(nums).size).toBe(N);

    // The numbers form a gap-free, contiguous block: startNum .. startNum+N-1.
    const expected = Array.from({ length: N }, (_, i) => startNum + i);
    expect(nums).toEqual(expected);

    // The provider's counter advanced by exactly N — no lost or double increments.
    const [after] = await db
      .select({ next: providersTable.nextInvoiceNumber })
      .from(providersTable)
      .where(eq(providersTable.id, provider.id));
    expect(after!.next).toBe(startNum + N);

    // The DB holds exactly N storno rows for these bookings, all with distinct
    // numbers — proving the uniqueness survives the round-trip to Postgres.
    const persisted = await db
      .select({ invoiceNumber: invoicesTable.invoiceNumber })
      .from(invoicesTable)
      .where(
        and(inArray(invoicesTable.bookingId, bookingIds), eq(invoicesTable.kind, "storno")),
      );
    expect(persisted.length).toBe(N);
    expect(new Set(persisted.map((p) => p.invoiceNumber)).size).toBe(N);
  });
});

describe("issueInvoiceForBooking + issueStornoForBooking — mixed concurrent contention", () => {
  it("assigns a globally unique, gap-free set of numbers across both paths", async () => {
    const N = 6;
    // N fresh paid bookings to be invoiced concurrently …
    const freshBookingIds = await Promise.all(
      Array.from({ length: N }, () => insertBooking({ totalPrice: 120 })),
    );
    // … and N already-invoiced bookings to be cancelled concurrently. Both paths
    // belong to the SAME provider and share the SAME number counter.
    const stornoBookingIds = await Promise.all(
      Array.from({ length: N }, () => insertBooking({ totalPrice: 120 })),
    );
    for (const bookingId of stornoBookingIds) {
      const issued = await issueInvoiceForBooking({ bookingId });
      expect(issued).not.toBeNull();
    }

    // Capture the next number BEFORE the mixed race.
    const [before] = await db
      .select({ next: providersTable.nextInvoiceNumber })
      .from(providersTable)
      .where(eq(providersTable.id, provider.id));
    const startNum = before!.next;

    // Interleave fresh invoices and stornos, then fire EVERYTHING together so a
    // cancellation can race a fresh payment for the same provider.
    const invoiceOps = freshBookingIds.map(
      (bookingId) => () => issueInvoiceForBooking({ bookingId }),
    );
    const stornoOps = stornoBookingIds.map(
      (bookingId) => () => issueStornoForBooking(bookingId),
    );
    const ops: Array<() => Promise<unknown>> = [];
    for (let i = 0; i < N; i++) {
      ops.push(invoiceOps[i]!);
      ops.push(stornoOps[i]!);
    }
    const results = await Promise.all(ops.map((op) => op()));

    // Both return shapes differ: issueInvoiceForBooking → { invoice, created },
    // issueStornoForBooking → Invoice. Normalise to the invoice number.
    const nums = results
      .map((r) => {
        const inv =
          r && typeof r === "object" && "invoice" in r
            ? (r as { invoice: typeof invoicesTable.$inferSelect }).invoice
            : (r as typeof invoicesTable.$inferSelect);
        return inv.invoiceNumber;
      })
      .map((str) => {
        const m = str.match(/-(\d+)$/);
        return Number(m![1]);
      })
      .sort((a, b) => a - b);

    const total = N * 2;
    // The combined set across BOTH paths is unique with no gaps.
    expect(nums.length).toBe(total);
    expect(new Set(nums).size).toBe(total);
    const expected = Array.from({ length: total }, (_, i) => startNum + i);
    expect(nums).toEqual(expected);

    // The provider's counter advanced by exactly the combined count.
    const [after] = await db
      .select({ next: providersTable.nextInvoiceNumber })
      .from(providersTable)
      .where(eq(providersTable.id, provider.id));
    expect(after!.next).toBe(startNum + total);
  });
});

describe("issueInvoiceForBooking — idempotency", () => {
  it("does not create a second invoice when re-issued for the same booking", async () => {
    const bookingId = await insertBooking({ totalPrice: 120 });

    const first = await issueInvoiceForBooking({ bookingId });
    expect(first!.created).toBe(true);
    const firstNumber = first!.invoice.invoiceNumber;

    const second = await issueInvoiceForBooking({ bookingId });
    expect(second).not.toBeNull();
    expect(second!.created).toBe(false);
    expect(second!.invoice.id).toBe(first!.invoice.id);
    expect(second!.invoice.invoiceNumber).toBe(firstNumber);

    const rows = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.bookingId, bookingId));
    expect(rows.length).toBe(1);
  });
});

describe("issueInvoiceForBooking — skip conditions", () => {
  it("returns null for an unpaid booking", async () => {
    const bookingId = await insertBooking({ paymentStatus: "pending" });
    const result = await issueInvoiceForBooking({ bookingId });
    expect(result).toBeNull();
    const rows = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.bookingId, bookingId));
    expect(rows.length).toBe(0);
  });

  it("returns null for a direct-billing category (RVG/StBVV)", async () => {
    const bookingId = await insertBooking({
      forProvider: directProvider,
      forService: directService,
      totalPrice: 200,
    });
    const result = await issueInvoiceForBooking({ bookingId });
    expect(result).toBeNull();
  });

  it("returns null when autoIssueInvoices is off, but honours forceManual", async () => {
    await db
      .update(providersTable)
      .set({ autoIssueInvoices: false })
      .where(eq(providersTable.id, provider.id));
    try {
      const bookingId = await insertBooking({ totalPrice: 120 });

      const skipped = await issueInvoiceForBooking({ bookingId });
      expect(skipped).toBeNull();

      const forced = await issueInvoiceForBooking({ bookingId, forceManual: true });
      expect(forced).not.toBeNull();
      expect(forced!.created).toBe(true);
    } finally {
      await db
        .update(providersTable)
        .set({ autoIssueInvoices: true })
        .where(eq(providersTable.id, provider.id));
    }
  });
});

describe("issueStornoForBooking — cancellation path", () => {
  it("issues a storno mirroring the original invoice totals", async () => {
    const bookingId = await insertBooking({ totalPrice: 120 });
    const issued = await issueInvoiceForBooking({ bookingId });
    expect(issued).not.toBeNull();
    const original = issued!.invoice;

    const storno = await issueStornoForBooking(bookingId);
    expect(storno).not.toBeNull();
    expect(storno!.kind).toBe("storno");
    expect(storno!.originalInvoiceId).toBe(original.id);
    // Storno carries the same totals as the original.
    expect(storno!.totalCents).toBe(original.totalCents);
    expect(storno!.netCents).toBe(original.netCents);
    expect(storno!.taxCents).toBe(original.taxCents);
    // Storno gets its own distinct invoice number.
    expect(storno!.invoiceNumber).not.toBe(original.invoiceNumber);
    expect(storno!.pdfObjectKey).toBeTruthy();
  });

  it("is idempotent — re-storno returns the existing storno, no duplicate", async () => {
    const bookingId = await insertBooking({ totalPrice: 120 });
    await issueInvoiceForBooking({ bookingId });

    const first = await issueStornoForBooking(bookingId);
    const second = await issueStornoForBooking(bookingId);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.id).toBe(first!.id);

    const stornoRows = await db
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.bookingId, bookingId), eq(invoicesTable.kind, "storno")));
    expect(stornoRows.length).toBe(1);
  });

  it("returns null when there is no original invoice to cancel", async () => {
    const bookingId = await insertBooking({ paymentStatus: "pending" });
    const storno = await issueStornoForBooking(bookingId);
    expect(storno).toBeNull();
  });
});

describe("sendInvoiceEmail — CAS idempotency", () => {
  it("sends exactly once even when invoked concurrently", async () => {
    const bookingId = await insertBooking({ totalPrice: 120 });
    const issued = await issueInvoiceForBooking({ bookingId });
    const invoice = issued!.invoice;

    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId));

    await Promise.all([
      sendInvoiceEmail({ invoice, provider, booking: booking! }),
      sendInvoiceEmail({ invoice, provider, booking: booking! }),
    ]);

    expect(emailSpy.sendInvoiceWithAttachment).toHaveBeenCalledTimes(1);

    const [row] = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.id, invoice.id));
    expect(row?.emailSentAt).toBeTruthy();

    // A later call after the send has been recorded does nothing.
    const [fresh] = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.id, invoice.id));
    await sendInvoiceEmail({ invoice: fresh!, provider, booking: booking! });
    expect(emailSpy.sendInvoiceWithAttachment).toHaveBeenCalledTimes(1);
  });

  it("does not send when the booking has no customer email", async () => {
    const bookingId = await insertBooking({ totalPrice: 120, customerEmail: null });
    const issued = await issueInvoiceForBooking({ bookingId });
    const invoice = issued!.invoice;
    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId));

    await sendInvoiceEmail({ invoice, provider, booking: booking! });
    expect(emailSpy.sendInvoiceWithAttachment).not.toHaveBeenCalled();
  });
});
