import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for checkEmailDeliveryHealth (email.ts).
//
// The function queries email_log for recent failed rows with
// critical transactional templates and fires an ERROR log when any are found.
// These tests confirm:
//   1. Failed rows within the window trigger the ERROR alert.
//   2. An empty result (no failures) produces no ERROR log.
//   3. The returned rows match what the DB returned.
//
// The DB and logger are mocked so no real Postgres or Resend is touched.
// ---------------------------------------------------------------------------

// ── Mock @workspace/db ────────────────────────────────────────────────────

const mockSelect = vi.hoisted(() => vi.fn());
vi.mock("@workspace/db", () => {
  const drizzleMock = {
    select: () => drizzleMock,
    from: () => drizzleMock,
    where: () => drizzleMock,
    orderBy: mockSelect,
  };
  return {
    db: drizzleMock,
    emailLogTable: {
      id: "id",
      templateId: "template_id",
      recipient: "recipient",
      relatedId: "related_id",
      subject: "subject",
      status: "status",
      error: "error",
      sentAt: "sent_at",
    },
  };
});

// ── Mock drizzle-orm helpers (eq, and, desc, gte, lt, inArray) ───────────
const inArraySpy = vi.hoisted(() => vi.fn((_col: unknown, _values: unknown) => "inArray"));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn((_col: unknown, _val: unknown) => "eq"),
    and: vi.fn((..._args: unknown[]) => "and"),
    desc: vi.fn((_col: unknown) => "desc"),
    gte: vi.fn((_col: unknown, _val: unknown) => "gte"),
    lt: vi.fn((_col: unknown, _val: unknown) => "lt"),
    inArray: inArraySpy,
  };
});

// ── Mock resendClient (imported transitively by email.ts) ─────────────────
vi.mock("../lib/resendClient", () => ({
  sendEmailViaResend: vi.fn(async () => ({
    sent: false,
    skipped: true,
    error: "Resend connector not configured",
  })),
  isResendConfigured: vi.fn(async () => false),
}));

// ── Capture logger.error calls ────────────────────────────────────────────
const loggerErrorSpy = vi.hoisted(() => vi.fn());
vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerErrorSpy,
  },
}));

// Hbs template imports used by email.ts — return empty strings.
vi.mock("../email-templates/foerderschiene_report_ready.hbs", () => ({
  default: "",
}));
vi.mock("../email-templates/welcome_provider.hbs", () => ({ default: "" }));
vi.mock("../email-templates/booking_confirmation_customer.hbs", () => ({ default: "" }));
vi.mock("../email-templates/booking_confirmation_provider.hbs", () => ({ default: "" }));
vi.mock("../email-templates/booking_cancelled_by_customer.hbs", () => ({ default: "" }));
vi.mock("../email-templates/booking_cancelled_by_provider.hbs", () => ({ default: "" }));
vi.mock("../email-templates/booking_reminder_24h.hbs", () => ({ default: "" }));
vi.mock("../email-templates/invoice_ready.hbs", () => ({ default: "" }));
vi.mock("../email-templates/welcome_customer.hbs", () => ({ default: "" }));
vi.mock("../email-templates/stripe_activated.hbs", () => ({ default: "" }));
vi.mock("../email-templates/payment_failed.hbs", () => ({ default: "" }));
vi.mock("../email-templates/payment_refunded.hbs", () => ({ default: "" }));
vi.mock("../email-templates/booking_reminder_1h.hbs", () => ({ default: "" }));
vi.mock("../email-templates/energieausweis_order_confirmation.hbs", () => ({ default: "" }));
vi.mock("../email-templates/finance_lead_partner.hbs", () => ({ default: "" }));
vi.mock("../email-templates/new_request_provider.hbs", () => ({ default: "" }));
vi.mock("../email-templates/offer_received.hbs", () => ({ default: "" }));
vi.mock("../email-templates/ical_booking_conflict.hbs", () => ({ default: "" }));

// ── Import after mocks are declared ──────────────────────────────────────
import {
  checkEmailDeliveryHealth,
  CRITICAL_TRANSACTIONAL_EMAIL_TEMPLATE_IDS,
} from "./email";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────

function makeRow(
  overrides: Partial<{
    id: number;
    templateId: string;
    recipient: string;
    error: string | null;
    sentAt: Date;
  }> = {},
) {
  return {
    id: 1,
    templateId: "foerderschiene_report_ready",
    recipient: "buyer@example.com",
    error: "API key invalid",
    sentAt: new Date("2026-08-18T10:00:00Z"),
    ...overrides,
  };
}

function loggedTemplateIdsFromSharedSender(): string[] {
  const senderSource = readFileSync(new URL("./email.ts", import.meta.url), "utf8");
  const templateIds = [...senderSource.matchAll(/\btemplateId:\s*"([^"]+)"/g)].map(
    ([, templateId]) => templateId,
  );

  return [...new Set(templateIds)].sort();
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("checkEmailDeliveryHealth", () => {
  it("keeps monitored IDs in sync with every template logged by the shared sender", () => {
    expect([...CRITICAL_TRANSACTIONAL_EMAIL_TEMPLATE_IDS].sort()).toEqual(
      loggedTemplateIdsFromSharedSender(),
    );
  });

  it("monitors every logged transactional email template by default", async () => {
    const expectedTemplateIds = [...CRITICAL_TRANSACTIONAL_EMAIL_TEMPLATE_IDS];
    const rows = expectedTemplateIds.map((templateId, index) =>
      makeRow({ id: index + 1, templateId }),
    );
    mockSelect.mockResolvedValueOnce(rows);

    const result = await checkEmailDeliveryHealth(24, new Date());

    expect(CRITICAL_TRANSACTIONAL_EMAIL_TEMPLATE_IDS).toEqual(expectedTemplateIds);
    expect(inArraySpy).toHaveBeenCalledWith("template_id", expectedTemplateIds);
    expect(result.map((row) => row.templateId)).toEqual(expectedTemplateIds);
  });

  it("returns an empty array and does NOT log an error when no failures exist", async () => {
    mockSelect.mockResolvedValueOnce([]);

    const result = await checkEmailDeliveryHealth(24, new Date());

    expect(result).toEqual([]);
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it("returns the failed rows and logs an ERROR when failures are found", async () => {
    const row = makeRow({ id: 42, error: "550 Mailbox does not exist" });
    mockSelect.mockResolvedValueOnce([row]);

    const result = await checkEmailDeliveryHealth(24, new Date());

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 42, error: "550 Mailbox does not exist" });

    expect(loggerErrorSpy).toHaveBeenCalledOnce();
    const [bindings, message] = loggerErrorSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(bindings.failedCount).toBe(1);
    expect(message).toMatch(/EMAIL DELIVERY ALERT/);
  });

  it("accepts multiple template IDs and returns failures from all of them", async () => {
    const rows = [
      makeRow({ id: 42, templateId: "energieausweis_order_confirmation" }),
      makeRow({
        id: 43,
        templateId: "finance_lead_partner",
        recipient: "partner@example.com",
      }),
    ];
    mockSelect.mockResolvedValueOnce(rows);

    const result = await checkEmailDeliveryHealth(
      24,
      new Date(),
      ["energieausweis_order_confirmation", "finance_lead_partner"],
    );

    expect(result).toEqual(rows);
    expect(result).toHaveLength(2);
    expect(result.map((row) => row.templateId)).toEqual([
      "energieausweis_order_confirmation",
      "finance_lead_partner",
    ]);
    expect(inArraySpy).toHaveBeenCalledWith("template_id", [
      "energieausweis_order_confirmation",
      "finance_lead_partner",
    ]);
    expect(loggerErrorSpy).toHaveBeenCalledOnce();
    const [bindings] = loggerErrorSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(bindings.templateIds).toEqual([
      "energieausweis_order_confirmation",
      "finance_lead_partner",
    ]);
  });

  it("does not query or log when no templates are configured", async () => {
    const result = await checkEmailDeliveryHealth(24, new Date(), []);

    expect(result).toEqual([]);
    expect(mockSelect).not.toHaveBeenCalled();
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it("includes all returned rows in the result, capped samples at 5 in the log", async () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      makeRow({ id: i + 1, recipient: `buyer${i + 1}@example.com` }),
    );
    mockSelect.mockResolvedValueOnce(rows);

    const result = await checkEmailDeliveryHealth(24, new Date());

    expect(result).toHaveLength(7);
    expect(loggerErrorSpy).toHaveBeenCalledOnce();
    const [bindings] = loggerErrorSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(bindings.failedCount).toBe(7);
    // samples is capped at 5 inside the function
    expect((bindings.samples as unknown[]).length).toBeLessThanOrEqual(5);
  });

  it("logs the windowHours used for the look-back in the error context", async () => {
    const row = makeRow();
    mockSelect.mockResolvedValueOnce([row]);

    await checkEmailDeliveryHealth(48, new Date());

    expect(loggerErrorSpy).toHaveBeenCalledOnce();
    const [bindings] = loggerErrorSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(bindings.windowHours).toBe(48);
  });

  it("does not log an error for an empty failures list on a second call after a clean one", async () => {
    mockSelect.mockResolvedValueOnce([makeRow()]);
    await checkEmailDeliveryHealth(24, new Date());
    expect(loggerErrorSpy).toHaveBeenCalledOnce();

    loggerErrorSpy.mockClear();
    mockSelect.mockResolvedValueOnce([]);
    await checkEmailDeliveryHealth(24, new Date());
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });
});
