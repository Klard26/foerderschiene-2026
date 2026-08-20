import type { PoolClient } from "pg";
import { foerderpilotPool, fpQuery, fpQueryOne } from "./foerderpilotDb";
import { logger } from "./logger";
// SQL bundled as text via the esbuild ".sql" loader (see build.mjs). Order matters:
// schema (creates the catalog tables in the public schema — Replit's publish
// pipeline does not support custom Postgres schemas) → import (65 programs) →
// antragspfade (guided application paths + rejection reasons).
import schemaSql from "../foerderpilot-sql/01_schema.sql";
import importSql from "../foerderpilot-sql/02_import.sql";
import antragspfadeSql from "../foerderpilot-sql/03_antragspfade.sql";
// Vorgangs-/Dokument-/Exposé-Erweiterung (Facilioo-/PLANFLUX-Muster). Extends the
// Förderpilot tables in `public`; fully idempotent (IF NOT EXISTS / guarded enums / CREATE
// OR REPLACE / guarded seed), so it runs every boot AFTER the base catalog exists.
import vorgangSql from "../foerderpilot-sql/04_vorgang.sql";
// Energetische-Sanierung Förderprogramme (BEG/KfW EM+WG, EBW, Baubegleitung,
// § 35c, Länder-/Kommunalprogramme, Kombinationen). Fully idempotent: programs are
// upserted by titel, junctions are DELETE+re-INSERT, foerdergeber are name-guarded.
// Runs every boot AFTER the base catalog (the base loader skips once populated, so
// a new seed would never reach an existing DB unless run unconditionally here).
import energieSql from "../foerderpilot-sql/05_energie.sql";

let didRun = false;
let retryAttempts = 0;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 60_000;

/**
 * Idempotently ensures the Förderpilot funding catalog exists in the connected
 * database (standard `public` schema). Runs once per process and is guarded on
 * table existence so it works in BOTH dev and production (each environment
 * loads on first boot).
 *
 * Idempotency: the import script is a SINGLE atomic transaction. Its `programm`
 * + junction inserts ARE re-runnable (existence-guarded by titel / ON CONFLICT),
 * but `foerdergeber` has no unique key (its `ON CONFLICT DO NOTHING` only guards
 * the serial PK), so re-running would slowly DUPLICATE the foerdergeber rows. We
 * therefore load ONLY when the catalog is absent or empty:
 *   - table absent      → run schema (DROP+CREATE) + import + antragspfade.
 *   - table present, 0 rows → run import + antragspfade (schema already exists;
 *     a prior import that failed rolled back atomically, leaving 0 rows).
 *   - table present, >0 rows → skip (already loaded — avoids any duplication).
 * Because import is atomic, the row count is reliably either 0 or complete, so
 * this both avoids duplicates AND self-heals an aborted earlier load. To fully
 * re-seed, drop the catalog tables and restart the server.
 *
 * Publish freeze: if `public.foerderpilot_publish_freeze` exists AND contains a
 * row, the entire setup is skipped. This lets us keep the DEV database free of
 * the catalog's enum types/views while a Replit publish is pending (the publish
 * schema-differ chokes on same-named types in the legacy prod schema), and is
 * restart-proof — a workspace wake or workflow restart cannot resurrect the
 * catalog mid-publish. The publish schema copy recreates the freeze table in
 * prod EMPTY (schema only, never rows), so production is never frozen by it.
 */
export async function ensureFoerderpilotCatalog(): Promise<void> {
  if (didRun) return;
  didRun = true;

  logger.info("[foerderpilot] Setup starting…");

  try {
    if (await isPublishFrozen()) {
      logger.warn(
        "[foerderpilot] Publish freeze active (public.foerderpilot_publish_freeze has rows) — skipping catalog setup. Delete the freeze row and restart to rebuild.",
      );
      return;
    }

    // Serialize the whole setup across concurrently booting instances (prod
    // autoscale can start several at once). Without the lock, two instances can
    // both see an absent/empty catalog and double-run the import — foerdergeber
    // has no unique key, so that would duplicate rows. The lock is held on a
    // dedicated connection; the helpers re-check state after acquiring it, so
    // the second instance simply sees a populated catalog and skips.
    // (Same pattern as classificationSeed.ts, which uses lock id 824001.)
    //
    // The lock client carries a statement_timeout so a blocked lock wait or a
    // blocked DDL statement (ALTER EXTENSION / DROP SCHEMA can wait on object
    // locks held elsewhere) errors out loudly instead of hanging the setup
    // silently forever — the error is logged and retried below.
    const lockClient = await foerderpilotPool.connect();
    try {
      await lockClient.query("SET statement_timeout = '30s'");
      await lockClient.query("SELECT pg_advisory_lock(824002)");
      try {
        // Re-check the freeze AFTER acquiring the lock: a booting instance that
        // passed the first check while the catalog was being dropped + frozen
        // concurrently must not resurrect it.
        if (await isPublishFrozen()) {
          logger.warn(
            "[foerderpilot] Publish freeze appeared while waiting for the setup lock — skipping catalog setup.",
          );
          return;
        }
        await healStrandedExtensions(lockClient);
        await dropLegacySchema(lockClient);
        await ensureBaseCatalog();
        await ensureVorgangExtension();
        await ensureEnergieSeed();
        retryAttempts = 0;
      } finally {
        await lockClient.query("SELECT pg_advisory_unlock(824002)");
      }
    } finally {
      // Reset before returning the connection to the pool — pooled connections
      // keep session GUCs, so a later borrower would inherit the 30s timeout.
      // RESET restores the pool's own startup default (120s), not "no timeout".
      try {
        await lockClient.query("RESET statement_timeout");
      } finally {
        lockClient.release();
      }
    }
  } catch (err) {
    // Never let setup crash the server — the rest of the API stays available;
    // the Förderpilot routes will surface errors if the catalog is missing.
    // Retry with a delay so a transient hang/lock at boot self-heals.
    logger.error({ err }, "[foerderpilot] Failed to load funding catalog.");
    if (retryAttempts < MAX_RETRIES) {
      retryAttempts += 1;
      logger.info(
        { attempt: retryAttempts, maxRetries: MAX_RETRIES, delayMs: RETRY_DELAY_MS },
        "[foerderpilot] Scheduling setup retry.",
      );
      setTimeout(() => {
        didRun = false;
        void ensureFoerderpilotCatalog();
      }, RETRY_DELAY_MS).unref();
    } else {
      logger.error(
        { maxRetries: MAX_RETRIES },
        "[foerderpilot] Giving up on catalog setup after max retries.",
      );
    }
  }
}

/**
 * Dev-side publish freeze: skip the whole setup while a publish is pending.
 * Frozen = the marker table exists AND has at least one row. Row-based on
 * purpose: Replit's publish copies the SCHEMA to production but never data,
 * so prod sees the table empty and proceeds normally.
 */
async function isPublishFrozen(): Promise<boolean> {
  const reg = await fpQueryOne<{ reg: string | null }>(
    "SELECT to_regclass('public.foerderpilot_publish_freeze')::text AS reg",
  );
  if (!reg?.reg) return false;
  const row = await fpQueryOne<{ n: string }>(
    "SELECT count(*)::text AS n FROM public.foerderpilot_publish_freeze",
  );
  return Number(row?.n ?? 0) > 0;
}

/**
 * Self-heal: moves the pgcrypto/pg_trgm extensions into the `public` schema if
 * an earlier deployment left them inside the legacy `foerderpilot` schema.
 *
 * Background: the catalog originally lived in a dedicated `foerderpilot`
 * schema; `CREATE EXTENSION` back then installed both extensions INTO that
 * schema. The production database still carries that legacy schema. When the
 * catalog now loads into `public`, `CREATE EXTENSION IF NOT EXISTS` is a no-op
 * (the extensions DO exist — just in the wrong schema), so `gen_random_uuid()`
 * and the `gin_trgm_ops` operator class are not resolvable on the default
 * search_path and 01_schema.sql would abort. Moving the extensions is safe and
 * transparent: existing objects reference extension members by OID, so old
 * tables/indexes in the legacy schema keep working. Both extensions are
 * relocatable. A no-op when the extensions already live in `public` (dev).
 *
 * Runs on the lock client so the statement_timeout applies — ALTER EXTENSION
 * takes exclusive locks and must fail loudly instead of blocking forever.
 */
async function healStrandedExtensions(client: PoolClient): Promise<void> {
  // Two sources of stranded extensions, both must end up in `public`:
  //  (a) the catalog's own extensions (pgcrypto/pg_trgm) sitting in ANY
  //      non-public schema — 01_schema.sql needs them resolvable, and
  //  (b) any OTHER extension still inside the legacy `foerderpilot` schema —
  //      dropLegacySchema refuses to drop while extensions live there, so an
  //      unexpected leftover would silently block the publish fix forever.
  const stranded = await client.query<{
    extname: string;
    nspname: string;
    extrelocatable: boolean;
  }>(
    `SELECT e.extname, n.nspname, e.extrelocatable
       FROM pg_extension e
       JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE (e.extname IN ('pgcrypto', 'pg_trgm') AND n.nspname <> 'public')
         OR n.nspname = 'foerderpilot'`,
  );
  for (const ext of stranded.rows) {
    if (!ext.extrelocatable) {
      logger.error(
        { extension: ext.extname, schema: ext.nspname },
        "[foerderpilot] Stranded extension is NOT relocatable — cannot move it to public; the legacy schema drop will be skipped. Manual intervention required.",
      );
      continue;
    }
    // Identifier-quote the extension name (source is pg_extension, but never
    // interpolate unquoted).
    const quoted = `"${ext.extname.replaceAll('"', '""')}"`;
    await client.query(`ALTER EXTENSION ${quoted} SET SCHEMA public`);
    logger.info(
      { extension: ext.extname, from: ext.nspname },
      "[foerderpilot] Moved stranded extension into the public schema.",
    );
  }
}

/**
 * Drops the legacy `foerderpilot` schema if it still exists (production only —
 * dev was cleaned manually). The orphan schema contains ONLY the pre-migration
 * catalog + demo fixtures (verified: no real user data), but its enum types
 * share names with the public-schema catalog types, which breaks Replit's
 * publish schema-differ: the differ skips restoring the "already existing"
 * types while still restoring views that reference them, aborting every
 * publish with `type "public.<enum>" does not exist`. Removing the orphan
 * schema fixes publishing permanently.
 *
 * Guarded: never drops while extensions are still stranded inside (the heal
 * step must succeed first — otherwise CASCADE would take pgcrypto/pg_trgm
 * down with it). Runs on the lock client so the statement_timeout applies.
 */
async function dropLegacySchema(client: PoolClient): Promise<void> {
  const schema = await client.query(
    "SELECT 1 FROM pg_namespace WHERE nspname = 'foerderpilot'",
  );
  if (schema.rowCount === 0) return;

  const stillStranded = await client.query(
    `SELECT 1
       FROM pg_extension e
       JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE n.nspname = 'foerderpilot'`,
  );
  if ((stillStranded.rowCount ?? 0) > 0) {
    // ERROR level on purpose: if this fires, the publish-differ bug is NOT
    // fixed and every future publish will keep failing — it must not drown
    // as a warning while the setup otherwise reports success.
    logger.error(
      "[foerderpilot] Legacy schema still contains extensions — skipping schema drop. Publishing stays broken until this is resolved manually.",
    );
    return;
  }

  await client.query("DROP SCHEMA foerderpilot CASCADE");
  logger.info(
    "[foerderpilot] Dropped legacy foerderpilot schema (pre-migration catalog + demo fixtures).",
  );
}

/**
 * Loads the base funding catalog (schema + 65 programs + antragspfade). See the
 * idempotency notes above: loads only when the catalog table is absent or empty,
 * skips when already populated, and self-heals an atomically-aborted earlier load.
 */
async function ensureBaseCatalog(): Promise<void> {
  const existing = await fpQueryOne<{ reg: string | null }>(
    "SELECT to_regclass('public.programm')::text AS reg",
  );

  let count = 0;
  if (existing?.reg) {
    const c = await fpQueryOne<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.programm",
    );
    count = Number(c?.n ?? 0);
  }

  if (existing?.reg && count > 0) {
    logger.info(
      { programme: count },
      "[foerderpilot] Catalog already populated — skipping load.",
    );
    return;
  }

  logger.info("[foerderpilot] Loading funding catalog…");
  const client = await foerderpilotPool.connect();
  try {
    if (!existing?.reg) {
      await client.query(schemaSql);
    }
    // Atomic import + idempotent antragspfade (DELETE+INSERT).
    await client.query(importSql);
    await client.query(antragspfadeSql);
  } finally {
    client.release();
  }

  const loaded = await fpQueryOne<{ n: string }>(
    "SELECT count(*)::text AS n FROM public.programm",
  );
  logger.info(
    { programme: loaded?.n ?? "0" },
    "[foerderpilot] Funding catalog ready.",
  );
}

/**
 * Ensures the Vorgangs-/Dokument-/Exposé extension exists. Runs on every boot
 * AFTER the base catalog, because the extension SQL depends on base tables
 * (nutzer, berater, programm, pflichtunterlage, antragsschritt, bundesland).
 *
 * Safe to run unconditionally: the SQL is fully idempotent (CREATE TABLE IF NOT
 * EXISTS, guarded enum creation, ALTER ... ADD COLUMN IF NOT EXISTS, DROP TRIGGER
 * IF EXISTS, CREATE OR REPLACE VIEW, and a seed guarded by
 * `IF NOT EXISTS (SELECT 1 FROM organisation)`), so re-running self-heals a
 * partial earlier run without duplicating data. Guarded on the base schema so it
 * never runs against a missing programm table.
 */
async function ensureVorgangExtension(): Promise<void> {
  const base = await fpQueryOne<{ reg: string | null }>(
    "SELECT to_regclass('public.programm')::text AS reg",
  );
  if (!base?.reg) {
    logger.warn(
      "[foerderpilot] Base catalog missing — skipping Vorgang/Exposé extension.",
    );
    return;
  }

  const client = await foerderpilotPool.connect();
  try {
    await client.query(vorgangSql);
  } finally {
    client.release();
  }
  logger.info("[foerderpilot] Vorgang/Exposé extension ready.");
}

/**
 * Loads/refreshes the energetic-renovation funding programs (05_energie.sql). Runs
 * on every boot AFTER the base catalog, because the base loader skips once the
 * catalog is populated — so a newly added seed would otherwise never reach an
 * already-seeded database.
 *
 * Safe to run unconditionally: the seed is fully idempotent (programs upserted by
 * `titel`, junction tables DELETE+re-INSERT per program, foerdergeber guarded by
 * name), so re-running self-heals without duplicating rows. Guarded on the base
 * catalog so it never runs against a missing programm table.
 */
async function ensureEnergieSeed(): Promise<void> {
  const base = await fpQueryOne<{ reg: string | null }>(
    "SELECT to_regclass('public.programm')::text AS reg",
  );
  if (!base?.reg) {
    logger.warn(
      "[foerderpilot] Base catalog missing — skipping energetic funding seed.",
    );
    return;
  }

  const client = await foerderpilotPool.connect();
  try {
    await client.query(energieSql);
  } finally {
    client.release();
  }
  logger.info("[foerderpilot] Energetic funding programs ready.");
}
