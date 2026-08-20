import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// ---------------------------------------------------------------------------
// Integration tests for the report-ready email delivery path.
//
// Flow under test:
//   paid Stripe session → fulfillReport → deliverReportReadyEmail
//   → sendFoerderschieneReportReady → email_log row written
//
// Only the external edges are mocked:
//   - resendClient (getUncachableResendClient) so no real mail leaves the box
//     and we can toggle "Resend configured vs not configured" per test.
//
// Everything else — wasEmailSent, logEmail, foerderschiene_reports DB writes —
// runs against the live development Postgres database.
// ---------------------------------------------------------------------------

// ── Resend connector mock (hoisted so it is available inside vi.mock factories)

const resendState = vi.hoisted(() => ({
  /** Set to false in individual tests to simulate "Resend not configured". */
  configured: true as boolean,
  /**
   * Spy called with the sendEmailViaResend input so tests can assert on
   * the recipient, subject, and html. Return value is converted to the
   * ResendSendResult shape by the mock wrapper below.
   */
  sendSpy: vi.fn(async (_args: unknown) => undefined as void),
}));

vi.mock("./resendClient", () => ({
  sendEmailViaResend: vi.fn(async (args: unknown) => {
    if (!resendState.configured) {
      return { sent: false, skipped: true, error: "Resend connector not configured" };
    }
    try {
      await resendState.sendSpy(args);
      return { sent: true, skipped: false, error: null };
    } catch (err) {
      return {
        sent: false,
        skipped: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }),
}));

// ── Imports (after mocks are registered) ────────────────────────────────────

import {
  deliverEnergieausweisConfirmationEmail,
  deliverReportReadyEmail,
  fulfillEnergieausweis,
  fulfillReport,
} from "./foerderschiene";
import { wasEmailSent } from "./email";
import {
  db,
  energieausweisOrdersTable,
  foerderschieneReportsTable,
  emailLogTable,
} from "@workspace/db";
import { eq, and, like } from "drizzle-orm";

// ── Helpers ──────────────────────────────────────────────────────────────────

const sfx = `fsemailtest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const testEmail = `${sfx}@example.com`;
const BASE_URL = "https://app.example.test";

/** Insert a minimal pending report row and return it. */
async function insertPendingReport(opts: {
  sessionId: string;
  email?: string | null;
  adresse?: string | null;
} = { sessionId: `cs_test_${sfx}` }) {
  const [report] = await db
    .insert(foerderschieneReportsTable)
    .values({
      status: "pending",
      amountCents: 2900,
      adresse: opts.adresse ?? "Musterstraße 1, 10115 Berlin",
      email: opts.email ?? testEmail,
      profil: { baujahr: 1975, wohnflaeche: 120, heizung: "gas" },
      sessionId: opts.sessionId,
    })
    .returning();
  return report!;
}

/** Build a minimal Stripe-like session object. */
function makeSession(sessionId: string, email?: string | null) {
  return {
    id: sessionId,
    customer_details: { email: email ?? testEmail },
    customer_email: null as string | null,
  };
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

// Clean up email_log rows written by these tests between runs.
beforeEach(async () => {
  resendState.configured = true;
  resendState.sendSpy.mockClear();
  // Remove email_log rows from previous assertions in this test suite.
  await db
    .delete(emailLogTable)
    .where(like(emailLogTable.recipient, `${sfx}%`));
});

afterAll(async () => {
  // Remove any report rows created by the test suite.
  // We identify them by the test-scoped email address.
  await db
    .delete(emailLogTable)
    .where(like(emailLogTable.recipient, `${sfx}%`));
  // Reports don't have an email filter available via a simple eq, so we
  // clean them up via the per-test session ID prefix stored in `session_id`.
  await db
    .delete(foerderschieneReportsTable)
    .where(like(foerderschieneReportsTable.sessionId, `cs_test_${sfx}%`));
  await db
    .delete(energieausweisOrdersTable)
    .where(like(energieausweisOrdersTable.sessionId, `cs_ea_test_${sfx}%`));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("deliverReportReadyEmail — happy path: paid session → email sent", () => {
  it("sends the report-ready email and writes an email_log row with status 'sent'", async () => {
    const sessionId = `cs_test_${sfx}_happy`;
    const report = await insertPendingReport({ sessionId });
    await fulfillReport(sessionId);

    const session = makeSession(sessionId);
    await deliverReportReadyEmail(session, BASE_URL);

    // Resend was called exactly once.
    expect(resendState.sendSpy).toHaveBeenCalledTimes(1);

    // The call included the correct recipient.
    const [callArgs] = resendState.sendSpy.mock.calls[0] as [Record<string, unknown>];
    expect(callArgs.to).toBe(testEmail);
    expect(String(callArgs.subject ?? "")).toContain("Gebäudereport");

    // The report URL embedded in the email points to the success page.
    const html = String(callArgs.html ?? "");
    expect(html).toContain(sessionId);

    // email_log row persisted with status "sent".
    const logRows = await db
      .select()
      .from(emailLogTable)
      .where(
        and(
          eq(emailLogTable.templateId, "foerderschiene_report_ready"),
          eq(emailLogTable.recipient, testEmail),
          eq(emailLogTable.relatedId, String(report.id)),
        ),
      );
    expect(logRows.length).toBe(1);
    expect(logRows[0]!.status).toBe("sent");
  });

  it("picks the email from session.customer_details when the report row has no email", async () => {
    const sessionId = `cs_test_${sfx}_noemail`;
    // Insert report WITHOUT an email address.
    const [report] = await db
      .insert(foerderschieneReportsTable)
      .values({
        status: "pending",
        amountCents: 2900,
        profil: { baujahr: 1980, wohnflaeche: 90, heizung: "oel" },
        sessionId,
        email: null,
      })
      .returning();
    await fulfillReport(sessionId);

    const buyerEmail = `buyer_${sfx}@example.com`;
    const session = makeSession(sessionId, buyerEmail);
    await deliverReportReadyEmail(session, BASE_URL);

    expect(resendState.sendSpy).toHaveBeenCalledTimes(1);
    const [callArgs] = resendState.sendSpy.mock.calls[0] as [Record<string, unknown>];
    expect(callArgs.to).toBe(buyerEmail);

    // The email address was also backfilled onto the report row.
    const [fresh] = await db
      .select({ email: foerderschieneReportsTable.email })
      .from(foerderschieneReportsTable)
      .where(eq(foerderschieneReportsTable.id, report!.id));
    expect(fresh?.email).toBe(buyerEmail);

    // Cleanup extra email_log row for the buyer email.
    await db
      .delete(emailLogTable)
      .where(like(emailLogTable.recipient, `buyer_${sfx}%`));
  });
});

describe("deliverReportReadyEmail — deduplication guard (wasEmailSent)", () => {
  it("sends the email only once when called twice for the same report", async () => {
    const sessionId = `cs_test_${sfx}_dedup`;
    const report = await insertPendingReport({ sessionId });
    await fulfillReport(sessionId);

    const session = makeSession(sessionId);

    // First call → sends.
    await deliverReportReadyEmail(session, BASE_URL);
    expect(resendState.sendSpy).toHaveBeenCalledTimes(1);

    // Second call → deduped via wasEmailSent, no additional send.
    await deliverReportReadyEmail(session, BASE_URL);
    expect(resendState.sendSpy).toHaveBeenCalledTimes(1);

    // Only one email_log row exists for this report.
    const logRows = await db
      .select()
      .from(emailLogTable)
      .where(
        and(
          eq(emailLogTable.templateId, "foerderschiene_report_ready"),
          eq(emailLogTable.relatedId, String(report.id)),
        ),
      );
    expect(logRows.length).toBe(1);
    expect(logRows[0]!.status).toBe("sent");
  });

  it("wasEmailSent returns true after a successful delivery and false before", async () => {
    const sessionId = `cs_test_${sfx}_wasemailsent`;
    const report = await insertPendingReport({ sessionId });
    await fulfillReport(sessionId);

    // Before delivery: wasEmailSent should be false.
    expect(await wasEmailSent("foerderschiene_report_ready", report.id)).toBe(false);

    await deliverReportReadyEmail(makeSession(sessionId), BASE_URL);

    // After delivery: wasEmailSent should be true.
    expect(await wasEmailSent("foerderschiene_report_ready", report.id)).toBe(true);
  });
});

describe("deliverReportReadyEmail — Resend not configured", () => {
  it("writes an email_log row with status 'skipped' and does not throw", async () => {
    resendState.configured = false;

    const sessionId = `cs_test_${sfx}_skipped`;
    const report = await insertPendingReport({ sessionId });
    await fulfillReport(sessionId);

    const session = makeSession(sessionId);
    await expect(deliverReportReadyEmail(session, BASE_URL)).resolves.not.toThrow();

    // No real Resend call made.
    expect(resendState.sendSpy).not.toHaveBeenCalled();

    // email_log row persisted with status "skipped".
    const logRows = await db
      .select()
      .from(emailLogTable)
      .where(
        and(
          eq(emailLogTable.templateId, "foerderschiene_report_ready"),
          eq(emailLogTable.relatedId, String(report.id)),
        ),
      );
    expect(logRows.length).toBe(1);
    expect(logRows[0]!.status).toBe("skipped");
  });

  it("does not count a 'skipped' log row as delivered — wasEmailSent returns false", async () => {
    resendState.configured = false;

    const sessionId = `cs_test_${sfx}_skipped_dedup`;
    const report = await insertPendingReport({ sessionId });
    await fulfillReport(sessionId);

    await deliverReportReadyEmail(makeSession(sessionId), BASE_URL);

    // A skipped delivery must NOT satisfy the deduplication guard.
    expect(await wasEmailSent("foerderschiene_report_ready", report.id)).toBe(false);
  });
});

describe("deliverReportReadyEmail — webhook safety-net: buyer abandoned tab", () => {
  it("delivers the email via the webhook path when the buyer never returned to the success page", async () => {
    // Simulate the state right after Stripe fires checkout.session.completed:
    // the report row was inserted at checkout-creation time but the buyer closed
    // the tab, so the reconcile route (success-page) never ran.  The email
    // address therefore comes from the Stripe session, not from the report row.
    const sessionId = `cs_test_${sfx}_webhook_safetynet`;
    await insertPendingReport({ sessionId, email: null }); // no email on row

    // Webhook handler calls fulfillReport then deliverReportReadyEmail.
    await fulfillReport(sessionId);
    const session = makeSession(sessionId); // email in session.customer_details
    await deliverReportReadyEmail(session, BASE_URL);

    // Email was dispatched exactly once.
    expect(resendState.sendSpy).toHaveBeenCalledTimes(1);
    const [callArgs] = resendState.sendSpy.mock.calls[0] as [Record<string, unknown>];
    expect(callArgs.to).toBe(testEmail);
  });

  it("sends the email exactly once when webhook and success-page reconcile race concurrently (Promise.all)", async () => {
    // The real risk: the Stripe webhook fires while the buyer is still being
    // redirected to the success page, so both code paths invoke
    // deliverReportReadyEmail at the same instant. The unique partial index on
    // email_log (status IN ('in_flight','sent')) must ensure only one Resend
    // call is made regardless of the interleaving.
    const sessionId = `cs_test_${sfx}_concurrent`;
    await insertPendingReport({ sessionId });
    await fulfillReport(sessionId);

    const session = makeSession(sessionId);

    // Fire both paths simultaneously — only one must reach Resend.
    await Promise.all([
      deliverReportReadyEmail(session, BASE_URL),
      deliverReportReadyEmail(session, BASE_URL),
    ]);

    expect(resendState.sendSpy).toHaveBeenCalledTimes(1);
  });

  it("allows retry after a transient Resend failure — email is eventually delivered", async () => {
    // When Resend fails the 'in_flight' claim is flipped to 'failed'. 'failed'
    // is excluded from the unique partial index, so the next caller (e.g. a
    // Stripe webhook retry) can claim a fresh slot and retry delivery.
    const sessionId = `cs_test_${sfx}_retry`;
    const report = await insertPendingReport({ sessionId });
    await fulfillReport(sessionId);

    const session = makeSession(sessionId);

    // First attempt — Resend throws a transient error.
    resendState.sendSpy.mockRejectedValueOnce(new Error("Transient Resend error"));
    await deliverReportReadyEmail(session, BASE_URL);
    expect(resendState.sendSpy).toHaveBeenCalledTimes(1);
    // The 'failed' claim does NOT count as delivered.
    expect(await wasEmailSent("foerderschiene_report_ready", report.id)).toBe(false);

    resendState.sendSpy.mockClear();

    // Second attempt — Resend succeeds; the prior 'failed' row is outside the
    // unique index, so this call claims a fresh in_flight slot.
    await deliverReportReadyEmail(session, BASE_URL);
    expect(resendState.sendSpy).toHaveBeenCalledTimes(1);
    expect(await wasEmailSent("foerderschiene_report_ready", report.id)).toBe(true);
  });
});

describe("deliverReportReadyEmail — edge cases", () => {
  it("returns early without error when the report is not found", async () => {
    const session = { id: `cs_test_${sfx}_missing`, customer_details: { email: testEmail }, customer_email: null };
    await expect(deliverReportReadyEmail(session, BASE_URL)).resolves.not.toThrow();
    expect(resendState.sendSpy).not.toHaveBeenCalled();
  });

  it("returns early when no email address is available on the session or the report", async () => {
    const sessionId = `cs_test_${sfx}_noemail2`;
    await db
      .insert(foerderschieneReportsTable)
      .values({
        status: "pending",
        amountCents: 2900,
        profil: { baujahr: 1970, wohnflaeche: 80, heizung: "gas" },
        sessionId,
        email: null,
      });
    await fulfillReport(sessionId);

    const session = { id: sessionId, customer_details: { email: null }, customer_email: null };
    await expect(deliverReportReadyEmail(session, BASE_URL)).resolves.not.toThrow();
    expect(resendState.sendSpy).not.toHaveBeenCalled();
  });
});

describe("deliverEnergieausweisConfirmationEmail — atomic retry deduplication", () => {
  it("sends only once when the webhook retry and success-page reconcile race", async () => {
    const sessionId = `cs_ea_test_${sfx}_concurrent`;
    const [order] = await db
      .insert(energieausweisOrdersTable)
      .values({
        userId: `user_${sfx}`,
        sessionId,
        ausweisTyp: "bedarf",
        status: "pending_payment",
        amountCents: 14900,
        kontaktName: "Test Kunde",
        kontaktEmail: testEmail,
        intake: {},
      })
      .returning();
    await fulfillEnergieausweis(sessionId);

    const session = {
      id: sessionId,
      customer_details: { email: testEmail },
      customer_email: null,
    };
    const results = await Promise.all([
      deliverEnergieausweisConfirmationEmail(session),
      deliverEnergieausweisConfirmationEmail(session),
    ]);

    expect(results).toContain("sent");
    expect(results.some((result) => result === "in_flight" || result === "already_delivered")).toBe(
      true,
    );
    expect(resendState.sendSpy).toHaveBeenCalledTimes(1);
    expect(await wasEmailSent("energieausweis_order_confirmation", order!.id)).toBe(true);
  });

  it("exposes an in-flight result so a concurrent failure is retried", async () => {
    const sessionId = `cs_ea_test_${sfx}_failed_race`;
    const [order] = await db
      .insert(energieausweisOrdersTable)
      .values({
        userId: `user_${sfx}_failed_race`,
        sessionId,
        ausweisTyp: "verbrauch",
        status: "pending_payment",
        amountCents: 7900,
        kontaktName: "Test Kunde",
        kontaktEmail: testEmail,
        intake: {},
      })
      .returning();
    await fulfillEnergieausweis(sessionId);

    let rejectFirstSend!: (reason: Error) => void;
    resendState.sendSpy.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject: (reason: Error) => void) => {
          rejectFirstSend = reject;
        }),
    );
    const session = {
      id: sessionId,
      customer_details: { email: testEmail },
      customer_email: null,
    };

    const reconciliation = deliverEnergieausweisConfirmationEmail(session);
    await vi.waitFor(() => expect(resendState.sendSpy).toHaveBeenCalledTimes(1));

    // The concurrent webhook cannot acknowledge this active attempt as if it
    // had been delivered. It receives an explicit retryable in-flight result.
    await expect(deliverEnergieausweisConfirmationEmail(session)).resolves.toBe("in_flight");
    rejectFirstSend(new Error("Transient Resend error"));
    await expect(reconciliation).resolves.toBe("failed");

    await expect(deliverEnergieausweisConfirmationEmail(session)).resolves.toBe("sent");
    expect(resendState.sendSpy).toHaveBeenCalledTimes(2);
    expect(await wasEmailSent("energieausweis_order_confirmation", order!.id)).toBe(true);
  });
});
