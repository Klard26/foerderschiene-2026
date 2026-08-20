import { db } from "@workspace/db";
import { bookingsTable, providersTable, timeSlotsTable } from "@workspace/db";
import { and, eq, gt, lt, lte, isNull, inArray } from "drizzle-orm";
import {
  sendBookingReminder,
  sendBookingReminder1h,
  wasEmailSent,
  purgeOldEmailLogs,
  checkEmailDeliveryHealth,
  CRITICAL_TRANSACTIONAL_EMAIL_TEMPLATE_IDS,
} from "./email";
import { issueInvoiceForBooking, sendInvoiceEmail } from "./invoiceService";
import { logger } from "./logger";
import {
  grantLeadCredits,
  currentPeriodMonth,
  startOfNextMonthUtc,
  LEAD_GRANT_SOURCES,
  PREMIUM_MONTHLY_LEADS,
} from "./leadGrants";

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// The email_log purge only needs to run occasionally — once a day is plenty to
// keep the table within its retention window. Throttle so the 15-minute tick
// doesn't fire a pointless DELETE every time.
const EMAIL_LOG_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
let lastEmailLogPurgeAt = 0;

// Email delivery health check — scan for recent critical transactional email
// failures.
// Run once per hour rather than every 15-minute tick to avoid log spam.
const EMAIL_HEALTH_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let lastEmailHealthCheckAt = 0;

// 24h reminder window: send between 24h and 25h before the appointment.
const H24_LOWER = 24;
const H24_UPPER = 25;
// 1h reminder window: send between 1h and 1h15m before the appointment.
const H1_LOWER_MIN = 60;
const H1_UPPER_MIN = 75;

let timer: NodeJS.Timeout | null = null;

async function providerEmailMap(
  bookings: { providerId: number }[],
): Promise<Map<number, string | null>> {
  const ids = Array.from(new Set(bookings.map((b) => b.providerId)));
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: providersTable.id, email: providersTable.email })
    .from(providersTable)
    .where(inArray(providersTable.id, ids));
  return new Map(rows.map((p) => [p.id, p.email]));
}

async function send24hReminders(now: Date): Promise<void> {
  const lower = new Date(now.getTime() + H24_LOWER * 3600 * 1000);
  const upper = new Date(now.getTime() + H24_UPPER * 3600 * 1000);
  const due = await db
    .select()
    .from(bookingsTable)
    .where(
      and(
        isNull(bookingsTable.reminderSentAt),
        inArray(bookingsTable.status, ["pending", "confirmed"]),
        gt(bookingsTable.scheduledAt, lower),
        lte(bookingsTable.scheduledAt, upper),
      ),
    );
  if (due.length === 0) return;
  const emails = await providerEmailMap(due);
  for (const b of due) {
    await sendBookingReminder({
      bookingId: b.id,
      scheduledAt: b.scheduledAt,
      serviceName: b.serviceName,
      providerName: b.providerName,
      customerName: b.customerName,
      customerEmail: b.customerEmail,
      providerEmail: emails.get(b.providerId) ?? null,
      totalPrice: b.totalPrice,
      paymentRequired: b.paymentRequired,
    });
    await db
      .update(bookingsTable)
      .set({ reminderSentAt: new Date() })
      .where(eq(bookingsTable.id, b.id));
  }
  logger.info({ count: due.length }, "Sent 24h booking reminders");
}

async function send1hReminders(now: Date): Promise<void> {
  const lower = new Date(now.getTime() + H1_LOWER_MIN * 60 * 1000);
  const upper = new Date(now.getTime() + H1_UPPER_MIN * 60 * 1000);
  const due = await db
    .select()
    .from(bookingsTable)
    .where(
      and(
        inArray(bookingsTable.status, ["pending", "confirmed"]),
        gt(bookingsTable.scheduledAt, lower),
        lte(bookingsTable.scheduledAt, upper),
      ),
    );
  if (due.length === 0) return;
  const emails = await providerEmailMap(due);
  let sent = 0;
  for (const b of due) {
    // Dedupe via email_log: the 24h reminder uses a dedicated column, but the
    // 1h reminder has no flag, so we rely on the email_log audit instead.
    if (await wasEmailSent("booking_reminder_1h", b.id)) continue;
    await sendBookingReminder1h({
      bookingId: b.id,
      scheduledAt: b.scheduledAt,
      serviceName: b.serviceName,
      providerName: b.providerName,
      customerName: b.customerName,
      customerEmail: b.customerEmail,
      providerEmail: emails.get(b.providerId) ?? null,
      totalPrice: b.totalPrice,
      paymentRequired: b.paymentRequired,
    });
    sent++;
  }
  if (sent > 0) logger.info({ count: sent }, "Sent 1h booking reminders");
}

export async function autoCompleteBookings(now: Date): Promise<void> {
  // A booking is complete once its time slot has fully ended. Join the slot to
  // get the real end time rather than guessing a fixed duration.
  const past = await db
    .select({
      id: bookingsTable.id,
      providerId: bookingsTable.providerId,
      paymentRequired: bookingsTable.paymentRequired,
      paymentStatus: bookingsTable.paymentStatus,
    })
    .from(bookingsTable)
    .innerJoin(timeSlotsTable, eq(bookingsTable.slotId, timeSlotsTable.id))
    .where(
      and(
        inArray(bookingsTable.status, ["pending", "confirmed"]),
        lt(timeSlotsTable.endTime, now),
      ),
    );
  if (past.length === 0) return;

  for (const b of past) {
    await db
      .update(bookingsTable)
      .set({ status: "completed" })
      .where(eq(bookingsTable.id, b.id));

    // Ensure an invoice exists for paid, platform-billed bookings. Invoices are
    // normally issued at payment time (Stripe webhook); this is a safety net for
    // any booking whose webhook was missed. issueInvoiceForBooking and
    // sendInvoiceEmail are both idempotent, so re-runs never duplicate.
    if (b.paymentRequired && b.paymentStatus === "paid") {
      try {
        const result = await issueInvoiceForBooking({ bookingId: b.id });
        if (result?.created) {
          const [provider] = await db
            .select()
            .from(providersTable)
            .where(eq(providersTable.id, b.providerId))
            .limit(1);
          const [booking] = await db
            .select()
            .from(bookingsTable)
            .where(eq(bookingsTable.id, b.id))
            .limit(1);
          if (provider && booking) {
            await sendInvoiceEmail({ invoice: result.invoice, provider, booking });
          }
        }
      } catch (err) {
        logger.error({ err, bookingId: b.id }, "Auto-invoice on completion failed");
      }
    }
  }
  logger.info({ count: past.length }, "Auto-completed past bookings");
}

/**
 * Monthly Premium free-lead top-up: 3 leads per calendar month while premium.
 * Idempotent via the unique (provider, premium_monthly, "YYYY-MM") grant, so the
 * 15-minute tick re-running within the same month is a no-op. Use-it-or-lose-it:
 * the grant expires at the start of next month so unused free leads don't pile up.
 */
async function grantMonthlyPremiumLeads(now: Date): Promise<void> {
  const periodMonth = currentPeriodMonth(now);
  const expiresAt = startOfNextMonthUtc(now);
  const premium = await db
    .select({ id: providersTable.id })
    .from(providersTable)
    .where(eq(providersTable.subscriptionTier, "premium"));
  let granted = 0;
  for (const p of premium) {
    try {
      const did = await grantLeadCredits(db, {
        providerId: p.id,
        source: LEAD_GRANT_SOURCES.premiumMonthly,
        periodMonth,
        count: PREMIUM_MONTHLY_LEADS,
        expiresAt,
      });
      if (did) granted += 1;
    } catch (err) {
      logger.error({ err, providerId: p.id }, "Monthly premium free-lead grant failed");
    }
  }
  if (granted > 0) {
    logger.info({ count: granted, periodMonth }, "Granted monthly premium free leads");
  }
}

async function tick(): Promise<void> {
  const now = new Date();
  try {
    await send24hReminders(now);
  } catch (err) {
    logger.error({ err }, "24h reminder tick failed");
  }
  try {
    await grantMonthlyPremiumLeads(now);
  } catch (err) {
    logger.error({ err }, "Monthly premium free-lead tick failed");
  }
  try {
    await send1hReminders(now);
  } catch (err) {
    logger.error({ err }, "1h reminder tick failed");
  }
  try {
    await autoCompleteBookings(now);
  } catch (err) {
    logger.error({ err }, "Auto-complete tick failed");
  }
  if (now.getTime() - lastEmailLogPurgeAt >= EMAIL_LOG_PURGE_INTERVAL_MS) {
    lastEmailLogPurgeAt = now.getTime();
    try {
      await purgeOldEmailLogs(now);
    } catch (err) {
      logger.error({ err }, "email_log purge tick failed");
    }
  }
  if (now.getTime() - lastEmailHealthCheckAt >= EMAIL_HEALTH_CHECK_INTERVAL_MS) {
    lastEmailHealthCheckAt = now.getTime();
    try {
      await checkEmailDeliveryHealth(24, now, CRITICAL_TRANSACTIONAL_EMAIL_TEMPLATE_IDS);
    } catch (err) {
      logger.error({ err }, "email delivery health-check tick failed");
    }
  }
}

export function startReminderScheduler(): void {
  if (timer) return;
  // Kick off after 30s so the server is fully ready, then on interval.
  setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  }, 30_000);
  logger.info("Reminder scheduler scheduled (24h + 1h reminders, auto-complete)");
}
