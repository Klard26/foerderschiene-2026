import { db } from "@workspace/db";
import {
  foerderUpdateLogTable,
  type FoerderUpdateLogRow,
} from "@workspace/db";
import { and, desc, eq, isNull, not } from "drizzle-orm";
import {
  runFoerderUpdate,
  FOERDER_UPDATE_SOURCES,
  type UpdateSource,
} from "./foerderUpdate";
import {
  sendFoerderUpdateFailureAlert,
  wasEmailLogged,
} from "./email";
import { logger } from "./logger";

// Wöchentliche Katalog-Aktualisierung: Montag ab 06:00 Uhr (Europe/Berlin).
// Der Tick prüft stündlich; ob ein Lauf fällig ist, wird DB-gestützt über das
// foerder_update_log entschieden — dadurch restart-sicher (kein "erster Lauf
// erst 24h nach Boot"-Problem) und mehrfachlauf-sicher innerhalb derselben
// Woche.
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // stündlich
const MIN_DAYS_BETWEEN_RUNS = 6;
const FAILURE_ALERT_THRESHOLD = 2;
const FAILURE_ALERT_TEMPLATE_ID = "foerder_update_failure";

let timer: NodeJS.Timeout | null = null;
let running = false;

function berlinNow(now: Date): { weekday: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { weekday: get("weekday"), hour: Number(get("hour")) };
}

/** Letzter ERFOLGREICHER Abschluss (fehler IS NULL) je Quelle. */
async function lastSuccessAt(quelle: string): Promise<Date | null> {
  const [row] = await db
    .select({ abgeschlossenAm: foerderUpdateLogTable.abgeschlossenAm })
    .from(foerderUpdateLogTable)
    .where(
      and(
        eq(foerderUpdateLogTable.quelle, quelle),
        not(isNull(foerderUpdateLogTable.abgeschlossenAm)),
        isNull(foerderUpdateLogTable.fehler),
      ),
    )
    .orderBy(desc(foerderUpdateLogTable.abgeschlossenAm))
    .limit(1);
  return row?.abgeschlossenAm ?? null;
}

/**
 * Counts the latest completed runs for a source until the first success.
 * Limiting the read to the alert threshold is sufficient because callers only
 * need to know whether the threshold has been reached.
 */
export async function consecutiveFailureCount(quelle: string): Promise<number> {
  const rows = await db
    .select({ fehler: foerderUpdateLogTable.fehler })
    .from(foerderUpdateLogTable)
    .where(
      and(
        eq(foerderUpdateLogTable.quelle, quelle),
        not(isNull(foerderUpdateLogTable.abgeschlossenAm)),
      ),
    )
    .orderBy(desc(foerderUpdateLogTable.gestartetAm))
    .limit(FAILURE_ALERT_THRESHOLD);

  let failures = 0;
  for (const row of rows) {
    if (row.fehler == null) break;
    failures += 1;
  }
  return failures;
}

function foerderUpdateAlertRecipient(): string | null {
  const configured =
    process.env["FOERDER_UPDATE_ADMIN_EMAIL"] ?? process.env["ADMIN_EMAIL"];
  const recipient = configured?.trim();
  return recipient || null;
}

/**
 * Gives each source a different alert-log ID per ISO calendar week in Berlin.
 * Besides naturally expressing the rate limit, this avoids reusing an
 * email_log active-deduplication key after a prior week's successful alert.
 */
export function failureAlertRelatedId(quelle: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const localDate = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  const day = localDate.getUTCDay() || 7;
  localDate.setUTCDate(localDate.getUTCDate() + 4 - day);
  const isoYear = localDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil(
    ((localDate.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${quelle}:${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
}

/**
 * Sends at most one alert per source and Berlin calendar week. The
 * email_log check remains valid across scheduler restarts and deployments.
 */
export async function alertOnRepeatedSourceFailures(
  results: FoerderUpdateLogRow[],
  now: Date = new Date(),
): Promise<void> {
  const failedSources = results.filter((result) => result.fehler != null);
  if (failedSources.length === 0) return;

  const recipient = foerderUpdateAlertRecipient();
  for (const result of failedSources) {
    const failures = await consecutiveFailureCount(result.quelle);
    if (failures < FAILURE_ALERT_THRESHOLD) continue;

    if (!recipient) {
      logger.warn(
        { quelle: result.quelle, failures },
        "[foerder-update] Wiederholter Quellenfehler erkannt, aber keine Admin-E-Mail konfiguriert",
      );
      continue;
    }

    const alertRelatedId = failureAlertRelatedId(result.quelle, now);
    const attemptedThisWeek = await wasEmailLogged(
      FAILURE_ALERT_TEMPLATE_ID,
      alertRelatedId,
    );
    if (attemptedThisWeek) {
      logger.info(
        { quelle: result.quelle },
        "[foerder-update] Alarm für wiederholten Quellenfehler diese Woche bereits protokolliert",
      );
      continue;
    }

    await sendFoerderUpdateFailureAlert({
      adminEmail: recipient,
      quelle: result.quelle,
      failureCount: failures,
      lastError: result.fehler ?? "Unbekannter Fehler",
      relatedId: alertRelatedId,
    });
  }
}

/**
 * Fällige Quellen: Montag ab 06:00 Berlin, und pro Quelle nur, wenn der
 * letzte ERFOLGREICHE Lauf länger als ~1 Woche zurückliegt. Fehlgeschlagene
 * Quellen zählen nicht als erledigt und werden beim nächsten Tick erneut
 * versucht (auch später am Montag), ohne erfolgreiche Quellen zu wiederholen.
 */
export async function dueFoerderUpdateSources(now: Date): Promise<UpdateSource[]> {
  const { weekday, hour } = berlinNow(now);
  if (weekday !== "Mon" || hour < 6) return [];
  const due: UpdateSource[] = [];
  for (const source of FOERDER_UPDATE_SOURCES) {
    const last = await lastSuccessAt(source.quelle);
    const days = last
      ? (now.getTime() - last.getTime()) / (24 * 60 * 60 * 1000)
      : Infinity;
    if (days >= MIN_DAYS_BETWEEN_RUNS) due.push(source);
  }
  return due;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due = await dueFoerderUpdateSources(new Date());
    if (due.length > 0) {
      logger.info(
        { quellen: due.map((s) => s.quelle) },
        "[foerder-update] Wöchentlicher Lauf startet",
      );
      const results = await runFoerderUpdate(due);
      await alertOnRepeatedSourceFailures(results);
    }
  } catch (err) {
    logger.error({ err }, "[foerder-update] Scheduler-Tick fehlgeschlagen");
  } finally {
    running = false;
  }
}

export function startFoerderUpdateScheduler(): void {
  if (timer) return;
  // 60s nach Boot starten, damit Migrationen/Seeds durch sind, dann stündlich.
  setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  }, 60_000);
  logger.info(
    "Förderprogramm-Update-Scheduler geplant (montags ab 06:00 Europe/Berlin)",
  );
}
