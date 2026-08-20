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
// Integration tests for the Stripe webhook handler (POST /api/billing/webhook).
//
// The webhook is the most money-sensitive surface: it must reject unverified
// events and correctly toggle subscription tier, booking payment status, and
// Connect onboarding state. These tests exercise the real route handler and
// its DB writes against the live (development) Postgres database.
//
// Only the external edges are mocked:
//   - the Stripe client, so `webhooks.constructEvent` is under our control
//     (we drive both the "valid signature → parsed event" and the
//     "invalid signature → throw" paths, and the "Stripe not configured" path),
//   - the email / invoice / gebaeudecheck side effects (fire-and-forget), so
//     no real mail/PDF is produced — we keep spies to assert routing.
//
// The DB writes (tier toggles, payment-status flips, onboarding timestamp)
// are awaited before the handler responds, so we assert them directly.
// ---------------------------------------------------------------------------

const stripeState = vi.hoisted(() => ({
  // "configured" → return a fake client; "null" → simulate Stripe not set up.
  client: "configured" as "configured" | "null",
  // "ok" → constructEvent parses the raw body; "throw" → signature failure.
  verify: "ok" as "ok" | "throw",
}));

const spies = vi.hoisted(() => ({
  sendStripeActivated: vi.fn(async () => undefined),
  sendPaymentConfirmation: vi.fn(async () => undefined),
  sendPaymentFailed: vi.fn(async () => undefined),
  sendPaymentRefunded: vi.fn(async () => "sent" as const),
  wasEmailSent: vi.fn(async () => false),
  fulfillOrder: vi.fn(async () => true),
  refundOrder: vi.fn(async () => null),
  issueInvoiceForBooking: vi.fn(async () => null),
  sendInvoiceEmail: vi.fn(async () => undefined),
  fulfillReport: vi.fn(async () => true),
  deliverReportReadyEmail: vi.fn(async () => "sent" as const),
  fulfillEnergieausweis: vi.fn(async () => true),
  refundReport: vi.fn(async () => null),
  refundEnergieausweis: vi.fn(async () => null),
  deliverEnergieausweisConfirmationEmail: vi.fn(async () => "sent" as const),
  createFinanceLeadsForPaidReport: vi.fn(async () => undefined),
  enqueueFinanceLeadCreation: vi.fn(async () => undefined),
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
      webhooks: {
        constructEvent: (body: Buffer | string, _sig: string, _secret: string) => {
          if (stripeState.verify === "throw") {
            throw new Error("Webhook signature verification failed");
          }
          const raw = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
          return JSON.parse(raw);
        },
      },
    };
  },
}));

vi.mock("../lib/email", () => ({
  sendStripeActivated: spies.sendStripeActivated,
  sendPaymentConfirmation: spies.sendPaymentConfirmation,
  sendPaymentFailed: spies.sendPaymentFailed,
  sendPaymentRefunded: spies.sendPaymentRefunded,
  wasEmailSent: spies.wasEmailSent,
}));
vi.mock("../lib/invoiceService", () => ({
  issueInvoiceForBooking: spies.issueInvoiceForBooking,
  sendInvoiceEmail: spies.sendInvoiceEmail,
}));
vi.mock("../lib/gebaeudecheck", () => ({
  fulfillOrder: spies.fulfillOrder,
  refundOrder: spies.refundOrder,
}));
vi.mock("../lib/foerderschiene", () => ({
  fulfillReport: spies.fulfillReport,
  deliverReportReadyEmail: spies.deliverReportReadyEmail,
  fulfillEnergieausweis: spies.fulfillEnergieausweis,
  refundReport: spies.refundReport,
  refundEnergieausweis: spies.refundEnergieausweis,
  deliverEnergieausweisConfirmationEmail: spies.deliverEnergieausweisConfirmationEmail,
}));
vi.mock("../lib/financeAffiliate", () => ({
  createFinanceLeadsForPaidReport: spies.createFinanceLeadsForPaidReport,
  enqueueFinanceLeadCreation: spies.enqueueFinanceLeadCreation,
}));

import express, { type Express } from "express";
import webhookRouter from "./webhook";
import {
  db,
  providersTable,
  servicesTable,
  timeSlotsTable,
  categoriesTable,
  bookingsTable,
  providerWalletTable,
  walletTransactionsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// Minimal app: only the webhook router (which mounts its own express.raw()).
// We deliberately do NOT add express.json() so the raw body is preserved for
// signature verification, exactly as in the real app.ts mount.
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
  app.use("/api", webhookRouter);
  return app;
}

const sfx = `whtest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const customerId = `${sfx}_customer`;
const providerUser = `${sfx}_provider`;
const categorySlug = `${sfx}_cat`;
const subscriptionId = `sub_${sfx}`;
const connectAccountId = `acct_${sfx}`;

const WEBHOOK_SECRET = "whsec_test_secret";

let server: Server;
let baseUrl: string;
let provider: typeof providersTable.$inferSelect;
let service: typeof servicesTable.$inferSelect;

function hourFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 3600_000);
}

async function createSlot(start: Date): Promise<typeof timeSlotsTable.$inferSelect> {
  const [slot] = await db
    .insert(timeSlotsTable)
    .values({
      providerId: provider.id,
      startTime: start,
      endTime: new Date(start.getTime() + 3600_000),
      isAvailable: false,
    })
    .returning();
  return slot!;
}

async function insertBooking(
  paymentStatus: "pending" | "paid" | "failed" = "pending",
): Promise<number> {
  const slot = await createSlot(hourFromNow(100 + Math.random() * 500));
  const [booking] = await db
    .insert(bookingsTable)
    .values({
      customerId,
      customerName: "Test Kunde",
      customerEmail: "kunde@example.com",
      providerId: provider.id,
      providerName: provider.displayName,
      serviceId: service.id,
      serviceName: service.name,
      slotId: slot.id,
      status: "confirmed",
      totalPrice: 120,
      scheduledAt: slot.startTime,
      paymentRequired: true,
      paymentStatus,
    })
    .returning();
  return booking!.id;
}

async function postWebhook(
  event: unknown,
  opts: { signature?: string | null } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sig = "signature" in opts ? opts.signature : "t=1,v1=fake";
  if (sig !== null && sig !== undefined) headers["stripe-signature"] = sig;
  const res = await fetch(`${baseUrl}/api/billing/webhook`, {
    method: "POST",
    headers,
    body: JSON.stringify(event),
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
  process.env["STRIPE_WEBHOOK_SECRET"] = WEBHOOK_SECRET;

  server = makeApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.insert(categoriesTable).values({
    name: "Webhook Test Kategorie",
    slug: categorySlug,
    requiresDirectBilling: false,
  });

  const [p] = await db
    .insert(providersTable)
    .values({
      clerkUserId: providerUser,
      approvalStatus: "approved",
      displayName: "Webhook Berater (test)",
      email: "webhook-berater@example.com",
      category: "Webhook Test Kategorie",
      categorySlug,
      city: "Berlin",
      zip: "10115",
      subscriptionTier: "basic",
      stripeAccountId: connectAccountId,
    })
    .returning();
  provider = p!;

  const [s] = await db
    .insert(servicesTable)
    .values({
      providerId: provider.id,
      name: "Webhook Leistung",
      price: 120,
      durationMinutes: 60,
    })
    .returning();
  service = s!;
});

afterAll(async () => {
  await db.delete(bookingsTable).where(eq(bookingsTable.customerId, customerId));
  if (provider?.id) {
    await db.delete(timeSlotsTable).where(eq(timeSlotsTable.providerId, provider.id));
    await db.delete(servicesTable).where(eq(servicesTable.providerId, provider.id));
    await db
      .delete(walletTransactionsTable)
      .where(eq(walletTransactionsTable.providerId, provider.id));
    await db.delete(providerWalletTable).where(eq(providerWalletTable.providerId, provider.id));
    await db.delete(providersTable).where(inArray(providersTable.id, [provider.id]));
  }
  await db.delete(categoriesTable).where(eq(categoriesTable.slug, categorySlug));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  stripeState.client = "configured";
  stripeState.verify = "ok";
  spies.sendStripeActivated.mockClear();
  spies.sendPaymentConfirmation.mockClear();
  spies.sendPaymentFailed.mockClear();
  spies.sendPaymentRefunded.mockClear();
  spies.sendPaymentRefunded.mockResolvedValue("sent");
  spies.wasEmailSent.mockClear();
  spies.wasEmailSent.mockResolvedValue(false);
  spies.fulfillOrder.mockClear();
  spies.refundOrder.mockReset();
  spies.refundOrder.mockResolvedValue(null);
  spies.issueInvoiceForBooking.mockClear();
  spies.fulfillReport.mockClear();
  spies.deliverReportReadyEmail.mockClear();
  spies.fulfillEnergieausweis.mockClear();
  spies.refundReport.mockReset();
  spies.refundReport.mockResolvedValue(null);
  spies.refundEnergieausweis.mockReset();
  spies.refundEnergieausweis.mockResolvedValue(null);
  spies.deliverEnergieausweisConfirmationEmail.mockClear();
  spies.createFinanceLeadsForPaidReport.mockClear();
  spies.enqueueFinanceLeadCreation.mockReset();
  spies.enqueueFinanceLeadCreation.mockResolvedValue(undefined);
});

describe("POST /api/billing/webhook — signature & configuration guards", () => {
  it("returns 503 when Stripe is not configured", async () => {
    stripeState.client = "null";
    const res = await postWebhook({ type: "checkout.session.completed", data: { object: {} } });
    expect(res.status).toBe(503);
  });

  it("returns 503 when the webhook secret is not configured", async () => {
    const saved = process.env["STRIPE_WEBHOOK_SECRET"];
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    try {
      const res = await postWebhook({ type: "checkout.session.completed", data: { object: {} } });
      expect(res.status).toBe(503);
    } finally {
      process.env["STRIPE_WEBHOOK_SECRET"] = saved;
    }
  });

  it("returns 400 when the stripe-signature header is missing", async () => {
    const res = await postWebhook(
      { type: "checkout.session.completed", data: { object: {} } },
      { signature: null },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when signature verification fails (unverified event)", async () => {
    stripeState.verify = "throw";
    const res = await postWebhook({
      type: "checkout.session.completed",
      data: { object: {} },
    });
    expect(res.status).toBe(400);
  });

  it("does NOT mutate state for an unverified event", async () => {
    // Pre-condition: provider is basic.
    await db
      .update(providersTable)
      .set({ subscriptionTier: "basic", stripeSubscriptionId: null })
      .where(eq(providersTable.id, provider.id));
    stripeState.verify = "throw";

    await postWebhook({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { kind: "subscription", providerId: String(provider.id) },
          subscription: subscriptionId,
        },
      },
    });

    const [row] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.id, provider.id));
    expect(row?.subscriptionTier).toBe("basic");
    expect(spies.sendStripeActivated).not.toHaveBeenCalled();
  });
});

describe("checkout.session.completed — subscription", () => {
  it("upgrades a basic provider to premium and notifies once", async () => {
    await db
      .update(providersTable)
      .set({ subscriptionTier: "basic", stripeSubscriptionId: null, premiumSince: null })
      .where(eq(providersTable.id, provider.id));

    const res = await postWebhook({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { kind: "subscription", providerId: String(provider.id) },
          subscription: subscriptionId,
        },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    const [row] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.id, provider.id));
    expect(row?.subscriptionTier).toBe("premium");
    expect(row?.stripeSubscriptionId).toBe(subscriptionId);
    expect(row?.premiumSince).toBeTruthy();
    expect(spies.sendStripeActivated).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — a replay for an already-premium provider does not re-notify", async () => {
    // Provider is already premium from the previous test.
    const res = await postWebhook({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { kind: "subscription", providerId: String(provider.id) },
          subscription: subscriptionId,
        },
      },
    });
    expect(res.status).toBe(200);
    expect(spies.sendStripeActivated).not.toHaveBeenCalled();
  });
});

describe("checkout.session.completed — booking payment", () => {
  it("marks a paid booking as paid and sends confirmation", async () => {
    const bookingId = await insertBooking("pending");

    const res = await postWebhook({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { kind: "booking", bookingId: String(bookingId) },
          payment_status: "paid",
        },
      },
    });
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId));
    expect(row?.paymentStatus).toBe("paid");
    expect(spies.sendPaymentConfirmation).toHaveBeenCalledTimes(1);
  });

  it("does NOT mark a booking paid when payment_status is unpaid", async () => {
    const bookingId = await insertBooking("pending");

    const res = await postWebhook({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { kind: "booking", bookingId: String(bookingId) },
          payment_status: "unpaid",
        },
      },
    });
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId));
    expect(row?.paymentStatus).toBe("pending");
    expect(spies.sendPaymentConfirmation).not.toHaveBeenCalled();
  });
});

describe("checkout.session.completed — foerderschiene_report", () => {
  it("calls fulfillReport and deliverReportReadyEmail when payment_status is paid", async () => {
    const sessionId = `cs_report_${sfx}`;
    const res = await postWebhook({
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          metadata: { kind: "foerderschiene_report" },
          payment_status: "paid",
          customer_details: { email: "buyer@example.com" },
          customer_email: null,
        },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    // The webhook must have called both fulfillment functions.
    expect(spies.fulfillReport).toHaveBeenCalledTimes(1);
    expect(spies.fulfillReport).toHaveBeenCalledWith(sessionId);
    expect(spies.deliverReportReadyEmail).toHaveBeenCalledTimes(1);
    // The session object forwarded to deliverReportReadyEmail must carry the
    // correct session ID so the function can look up the report row.
    const [sessionArg] = spies.deliverReportReadyEmail.mock.calls[0] as [{ id: string }];
    expect(sessionArg.id).toBe(sessionId);
  });

  it("durably queues finance-lead creation before starting it asynchronously", async () => {
    const reportId = 17_301;
    const res = await postWebhook({
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_report_affiliate_${sfx}`,
          metadata: {
            kind: "foerderschiene_report",
            reportId: String(reportId),
          },
          payment_status: "paid",
          customer_details: { email: "buyer@example.com" },
        },
      },
    });

    expect(res.status).toBe(200);
    expect(spies.enqueueFinanceLeadCreation).toHaveBeenCalledWith(reportId);
    expect(spies.createFinanceLeadsForPaidReport).toHaveBeenCalledWith(reportId);
  });

  it("returns 503 when finance-lead creation cannot be queued", async () => {
    spies.enqueueFinanceLeadCreation.mockRejectedValueOnce(new Error("database unavailable"));
    const res = await postWebhook({
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_report_queue_failure_${sfx}`,
          metadata: {
            kind: "foerderschiene_report",
            reportId: "17",
          },
          payment_status: "paid",
          customer_details: { email: "buyer@example.com" },
        },
      },
    });

    expect(res.status).toBe(503);
    expect(spies.createFinanceLeadsForPaidReport).not.toHaveBeenCalled();
  });

  it("does NOT call fulfillReport or deliverReportReadyEmail when payment_status is unpaid", async () => {
    const res = await postWebhook({
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_report_unpaid_${sfx}`,
          metadata: { kind: "foerderschiene_report" },
          payment_status: "unpaid",
        },
      },
    });
    expect(res.status).toBe(200);
    expect(spies.fulfillReport).not.toHaveBeenCalled();
    expect(spies.deliverReportReadyEmail).not.toHaveBeenCalled();
  });

  it("returns 503 when deliverReportReadyEmail fails so Stripe enqueues a retry", async () => {
    // When Resend fails the webhook must NOT acknowledge with 200. Returning 503
    // causes Stripe to enqueue an automatic retry — the durable retry path that
    // lets the email be eventually delivered without buyer interaction.
    spies.deliverReportReadyEmail.mockResolvedValueOnce("failed");

    const sessionId = `cs_report_fail_${sfx}`;
    const res = await postWebhook({
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          metadata: { kind: "foerderschiene_report" },
          payment_status: "paid",
          customer_details: { email: "buyer@example.com" },
          customer_email: null,
        },
      },
    });

    // 503 signals to Stripe that the event should be retried.
    expect(res.status).toBe(503);
    // fulfillReport must still have been called — only email delivery failed.
    expect(spies.fulfillReport).toHaveBeenCalledTimes(1);
  });
});

describe("checkout.session.completed — gebaeudecheck", () => {
  it("fulfills the order when paid", async () => {
    const res = await postWebhook({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_gebaeudecheck_1",
          metadata: { kind: "gebaeudecheck" },
          payment_status: "paid",
        },
      },
    });
    expect(res.status).toBe(200);
    expect(spies.fulfillOrder).toHaveBeenCalledWith("cs_gebaeudecheck_1");
  });
});

describe("checkout.session.completed — foerderschiene_energieausweis", () => {
  it("calls fulfillEnergieausweis and deliverEnergieausweisConfirmationEmail when paid", async () => {
    const sessionId = `cs_ea_${sfx}`;
    const res = await postWebhook({
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          metadata: { kind: "foerderschiene_energieausweis" },
          payment_status: "paid",
        },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    expect(spies.fulfillEnergieausweis).toHaveBeenCalledTimes(1);
    expect(spies.fulfillEnergieausweis).toHaveBeenCalledWith(sessionId);
    expect(spies.deliverEnergieausweisConfirmationEmail).toHaveBeenCalledTimes(1);
    const [sessionArg] = spies.deliverEnergieausweisConfirmationEmail.mock.calls[0] as [
      { id: string },
    ];
    expect(sessionArg.id).toBe(sessionId);
  });

  it("returns 503 when the confirmation email fails so Stripe enqueues a retry", async () => {
    // A failure must not be acknowledged: Stripe needs a non-2xx response to
    // retry this event after the failed email-log claim is released.
    spies.deliverEnergieausweisConfirmationEmail.mockResolvedValueOnce("failed");

    const sessionId = `cs_ea_fail_${sfx}`;
    const res = await postWebhook({
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          metadata: { kind: "foerderschiene_energieausweis" },
          payment_status: "paid",
          customer_details: { email: "buyer@example.com" },
          customer_email: null,
        },
      },
    });

    expect(res.status).toBe(503);
    expect(spies.fulfillEnergieausweis).toHaveBeenCalledWith(sessionId);
    expect(spies.deliverEnergieausweisConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: sessionId }),
    );
  });

  it("returns 503 when the confirmation email was not delivered yet", async () => {
    const sessionId = `cs_ea_retryable_${sfx}`;
    for (const deliveryResult of ["skipped", "in_flight", "retryable"] as const) {
      spies.deliverEnergieausweisConfirmationEmail.mockResolvedValueOnce(deliveryResult);
      const res = await postWebhook({
        type: "checkout.session.completed",
        data: {
          object: {
            id: `${sessionId}_${deliveryResult}`,
            metadata: { kind: "foerderschiene_energieausweis" },
            payment_status: "paid",
          },
        },
      });
      expect(res.status).toBe(503);
    }
  });

  it("does NOT call fulfillEnergieausweis or deliverEnergieausweisConfirmationEmail when unpaid", async () => {
    const res = await postWebhook({
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_ea_unpaid_${sfx}`,
          metadata: { kind: "foerderschiene_energieausweis" },
          payment_status: "unpaid",
        },
      },
    });
    expect(res.status).toBe(200);
    expect(spies.fulfillEnergieausweis).not.toHaveBeenCalled();
    expect(spies.deliverEnergieausweisConfirmationEmail).not.toHaveBeenCalled();
  });
});

describe("customer.subscription.deleted", () => {
  it("downgrades the matching provider back to basic", async () => {
    await db
      .update(providersTable)
      .set({ subscriptionTier: "premium", stripeSubscriptionId: subscriptionId })
      .where(eq(providersTable.id, provider.id));

    const res = await postWebhook({
      type: "customer.subscription.deleted",
      data: { object: { id: subscriptionId } },
    });
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.id, provider.id));
    expect(row?.subscriptionTier).toBe("basic");
    expect(row?.stripeSubscriptionId).toBeNull();
  });
});

describe("account.updated — Connect onboarding state", () => {
  it("sets stripeOnboardedAt when charges are enabled and details submitted", async () => {
    await db
      .update(providersTable)
      .set({ stripeOnboardedAt: null })
      .where(eq(providersTable.id, provider.id));

    const res = await postWebhook({
      type: "account.updated",
      data: {
        object: { id: connectAccountId, charges_enabled: true, details_submitted: true },
      },
    });
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.id, provider.id));
    expect(row?.stripeOnboardedAt).toBeTruthy();
  });

  it("clears stripeOnboardedAt when the account can no longer charge", async () => {
    await db
      .update(providersTable)
      .set({ stripeOnboardedAt: new Date() })
      .where(eq(providersTable.id, provider.id));

    const res = await postWebhook({
      type: "account.updated",
      data: {
        object: { id: connectAccountId, charges_enabled: false, details_submitted: true },
      },
    });
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.id, provider.id));
    expect(row?.stripeOnboardedAt).toBeNull();
  });
});

describe("payment_intent.payment_failed", () => {
  it("marks the booking payment as failed and notifies the customer once", async () => {
    const bookingId = await insertBooking("pending");

    const res = await postWebhook({
      type: "payment_intent.payment_failed",
      data: {
        object: {
          metadata: { kind: "booking", bookingId: String(bookingId) },
          last_payment_error: { message: "Karte abgelehnt" },
        },
      },
    });
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId));
    expect(row?.paymentStatus).toBe("failed");
    expect(spies.sendPaymentFailed).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — a replay for an already-failed booking does not re-notify", async () => {
    const bookingId = await insertBooking("failed");

    const res = await postWebhook({
      type: "payment_intent.payment_failed",
      data: {
        object: {
          metadata: { kind: "booking", bookingId: String(bookingId) },
          last_payment_error: { message: "Karte abgelehnt" },
        },
      },
    });
    expect(res.status).toBe(200);
    expect(spies.sendPaymentFailed).not.toHaveBeenCalled();
  });

  it("ignores non-booking payment intents", async () => {
    const res = await postWebhook({
      type: "payment_intent.payment_failed",
      data: { object: { metadata: { kind: "other" } } },
    });
    expect(res.status).toBe(200);
    expect(spies.sendPaymentFailed).not.toHaveBeenCalled();
  });
});

describe("charge.refunded", () => {
  it("marks the matched report refunded and emails the buyer exactly once", async () => {
    spies.refundReport.mockResolvedValueOnce({
      id: 431,
      email: "refund-buyer@example.com",
      amountCents: 2900,
    });

    const res = await postWebhook({
      type: "charge.refunded",
      data: {
        object: {
          id: `ch_${sfx}_report_refund`,
          payment_intent: `pi_${sfx}_report_refund`,
          billing_details: { email: "stripe-email@example.com" },
        },
      },
    });

    expect(res.status).toBe(200);
    expect(spies.refundReport).toHaveBeenCalledWith(`pi_${sfx}_report_refund`);
    expect(spies.sendPaymentRefunded).toHaveBeenCalledWith({
      email: "refund-buyer@example.com",
      productName: "Gebäudereport",
      amountCents: 2900,
      relatedId: "report:431",
      kontaktName: null,
    });
  });

  it("does not fully refund a partially refunded charge", async () => {
    const res = await postWebhook({
      type: "charge.refunded",
      data: {
        object: {
          id: `ch_${sfx}_credits_refund`,
          payment_intent: `pi_${sfx}_credits_refund`,
          amount: 1999,
          amount_refunded: 999,
          refunded: false,
          billing_details: { email: "credits-buyer@example.com" },
        },
      },
    });

    expect(res.status).toBe(200);
    expect(spies.refundOrder).not.toHaveBeenCalled();
    expect(spies.sendPaymentRefunded).not.toHaveBeenCalled();
  });

  it("returns 503 when the refund confirmation email fails so Stripe retries", async () => {
    spies.refundReport.mockResolvedValueOnce({
      id: 432,
      email: "refund-buyer@example.com",
      amountCents: 2900,
    });
    spies.sendPaymentRefunded.mockResolvedValueOnce("failed");

    const res = await postWebhook({
      type: "charge.refunded",
      data: {
        object: {
          id: `ch_${sfx}_report_refund_email_failure`,
          payment_intent: `pi_${sfx}_report_refund_email_failure`,
          billing_details: { email: "stripe-email@example.com" },
        },
      },
    });

    expect(res.status).toBe(503);
  });

  it("returns 503 when refund reconciliation fails so Stripe retries", async () => {
    spies.refundOrder.mockRejectedValueOnce(new Error("database unavailable"));

    const res = await postWebhook({
      type: "charge.refunded",
      data: {
        object: {
          id: `ch_${sfx}_report_refund_database_failure`,
          payment_intent: `pi_${sfx}_report_refund_database_failure`,
        },
      },
    });

    expect(res.status).toBe(503);
  });
});

describe("checkout.session.completed — wallet_topup (lead credit)", () => {
  async function balanceCents(): Promise<number> {
    const [row] = await db
      .select({ balanceCents: providerWalletTable.balanceCents })
      .from(providerWalletTable)
      .where(eq(providerWalletTable.providerId, provider.id))
      .limit(1);
    return row?.balanceCents ?? 0;
  }

  it("credits the wallet exactly once and is idempotent on replay", async () => {
    // Start from a clean wallet for a deterministic assertion.
    await db
      .delete(walletTransactionsTable)
      .where(eq(walletTransactionsTable.providerId, provider.id));
    await db.delete(providerWalletTable).where(eq(providerWalletTable.providerId, provider.id));

    const paymentIntent = `pi_${sfx}_topup`;
    const topupEvent = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_${sfx}_topup`,
          metadata: {
            kind: "wallet_topup",
            providerId: String(provider.id),
            amountCents: "5000",
          },
          payment_status: "paid",
          payment_intent: paymentIntent,
          amount_total: 5000,
        },
      },
    };

    const first = await postWebhook(topupEvent);
    expect(first.status).toBe(200);
    expect(await balanceCents()).toBe(5000);

    // A duplicate delivery (same payment_intent) must NOT double-credit.
    const replay = await postWebhook(topupEvent);
    expect(replay.status).toBe(200);
    expect(await balanceCents()).toBe(5000);

    // Exactly one ledger row exists for this payment.
    const txns = await db
      .select()
      .from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.providerId, provider.id));
    expect(txns.filter((t) => t.stripePaymentId === paymentIntent)).toHaveLength(1);
  });

  it("does not credit when the session is unpaid", async () => {
    await db
      .delete(walletTransactionsTable)
      .where(eq(walletTransactionsTable.providerId, provider.id));
    await db.delete(providerWalletTable).where(eq(providerWalletTable.providerId, provider.id));

    const res = await postWebhook({
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_${sfx}_topup_unpaid`,
          metadata: {
            kind: "wallet_topup",
            providerId: String(provider.id),
            amountCents: "5000",
          },
          payment_status: "unpaid",
          payment_intent: `pi_${sfx}_topup_unpaid`,
          amount_total: 5000,
        },
      },
    });
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(providerWalletTable)
      .where(eq(providerWalletTable.providerId, provider.id))
      .limit(1);
    // No wallet row created at all (nothing credited).
    expect(row).toBeUndefined();
  });
});
