import app from "./app";
import { logger } from "./lib/logger";
import { startReminderScheduler } from "./lib/reminderScheduler";
import { startIcalSyncScheduler } from "./lib/icalSync";
import { ensureFoerderpilotCatalog } from "./lib/foerderpilotSetup";
import { ensureClassificationCatalog } from "./lib/classificationSeed";
import { ensureEnergieberaterDemoData } from "./lib/seedEnergieberater";
import { recoverPendingFoerderLeads } from "./lib/foerderFinder";
import { startFoerderUpdateScheduler } from "./lib/foerderUpdateScheduler";
import { startFinanceLeadRetryScheduler } from "./lib/financeLeadRetryScheduler";
import { runMigrations } from "@workspace/db";
import { sweepOrphanedEnergieausweisOrders } from "./lib/foerderschiene";
import { isResendConfigured } from "./lib/resendClient";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Apply any pending DDL migrations before accepting traffic. This is the
// production path for low-level schema changes that drizzle-kit push cannot
// express (e.g. partial unique indexes). The runner is idempotent — it records
// each applied migration in _migrations and skips it on subsequent starts.
runMigrations()
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");

      // Probe the direct Resend connector at startup so a disconnected
      // integration surfaces before the first transactional email is needed.
      void isResendConfigured().then((reachable) => {
        if (!reachable) {
          logger.warn(
            {},
              "Resend connector is unreachable — email delivery will fail " +
              "(check the Replit Resend integration)",
          );
        } else {
          logger.info({}, "Resend connector reachable — email delivery active");
        }
      });

      startReminderScheduler();
      startIcalSyncScheduler();
      startFoerderUpdateScheduler();
      startFinanceLeadRetryScheduler();
      void ensureFoerderpilotCatalog();
      // On every startup, detect any Energieausweis orders that have no
      // sessionId (left by the old two-step checkout if the process crashed).
      // Recent ones (< 24 h) are logged as warnings; stale ones (≥ 24 h) are
      // cancelled because their Stripe session has definitely expired.
      void sweepOrphanedEnergieausweisOrders((msg, data) =>
        logger.warn(data ?? {}, msg),
      );
      // Categories must exist before the demo Energieberater are (re)seeded so
      // provider_count and category lookups line up on a fresh database.
      void ensureClassificationCatalog().then(() => ensureEnergieberaterDemoData());
      // Re-process Förder-Finder leads stranded in "pending" by a restart.
      void recoverPendingFoerderLeads();
    });
  })
  .catch((err) => {
    logger.error({ err }, "Failed to apply migrations; aborting startup");
    process.exit(1);
  });
