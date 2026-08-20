import { db, foerderschieneReportsTable } from "@workspace/db";
import { and, asc, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { createFinanceLeadsForPaidReport } from "./financeAffiliate";
import { logger } from "./logger";

// A short delay gives transient database/network errors room to recover while
// still making a paid buyer's opted-in finance lead available promptly.
const CHECK_INTERVAL_MS = 60_000;
const STARTUP_DELAY_MS = 30_000;
const BATCH_SIZE = 25;

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Retry every due, still-consented paid report. Lead inserts and partner-email
 * claims are idempotent, so a concurrent webhook/redelivery is safe.
 */
export async function retryDueFinanceLeadCreations(now = new Date()): Promise<number> {
  const reports = await db
    .select({ id: foerderschieneReportsTable.id })
    .from(foerderschieneReportsTable)
    .where(
      and(
        eq(foerderschieneReportsTable.status, "paid"),
        eq(foerderschieneReportsTable.financeConsent, true),
        isNull(foerderschieneReportsTable.financeConsentRevokedAt),
        isNotNull(foerderschieneReportsTable.financeLeadRetryAt),
        lte(foerderschieneReportsTable.financeLeadRetryAt, now),
      ),
    )
    .orderBy(asc(foerderschieneReportsTable.financeLeadRetryAt))
    .limit(BATCH_SIZE);

  let succeeded = 0;
  for (const report of reports) {
    try {
      await createFinanceLeadsForPaidReport(report.id);
      succeeded += 1;
      logger.info({ reportId: report.id }, "finance lead creation retry succeeded");
    } catch (err) {
      // The creation function has already postponed and persisted this failure.
      logger.error({ err, reportId: report.id }, "finance lead creation retry failed");
    }
  }
  return succeeded;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await retryDueFinanceLeadCreations();
  } catch (err) {
    logger.error({ err }, "finance lead retry scheduler tick failed");
  } finally {
    running = false;
  }
}

export function startFinanceLeadRetryScheduler(): void {
  if (timer) return;
  setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
  logger.info("Finance-lead retry scheduler scheduled (every minute)");
}