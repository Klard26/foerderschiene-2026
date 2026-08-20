/**
 * Lightweight startup migration runner.
 *
 * Each migration is an idempotent SQL string keyed by a unique name.  The
 * runner creates a `_migrations` tracking table if it does not exist, then
 * applies any migration that has not been recorded yet — exactly once, inside a
 * transaction.  This is intentionally simpler than drizzle-kit migrations:
 * `db push` covers schema shape in development, while this runner ensures
 * low-level DDL that push cannot express (e.g. partial unique indexes) is
 * applied safely on every deployment, including production.
 */

import { pool } from "./";

const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "0001_email_log_active_dedup",
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS email_log_active_dedup
        ON email_log (template_id, related_id)
        WHERE status IN ('in_flight', 'sent');
    `,
  },
  {
    name: "0002_providers_berater_registration_fields",
    sql: `
      ALTER TABLE providers
        ADD COLUMN IF NOT EXISTS bafa_nummer text,
        ADD COLUMN IF NOT EXISTS kapazitaet_stunden_pro_woche integer;
    `,
  },
  {
    name: "0003_foerder_leads",
    sql: `
      CREATE TABLE IF NOT EXISTS foerder_leads (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        telefon TEXT,
        eingaben JSONB NOT NULL,
        programm_analyse TEXT,
        email_status TEXT NOT NULL DEFAULT 'pending',
        consent_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    name: "0004_foerder_leads_consent_snapshot",
    sql: `
      ALTER TABLE foerder_leads
        ADD COLUMN IF NOT EXISTS consent_version text,
        ADD COLUMN IF NOT EXISTS consent_text text;
    `,
  },
  {
    name: "0005_foerder_update_log",
    sql: `
      CREATE TABLE IF NOT EXISTS foerder_update_log (
        id SERIAL PRIMARY KEY,
        gestartet_am TIMESTAMP NOT NULL DEFAULT NOW(),
        abgeschlossen_am TIMESTAMP,
        quelle TEXT NOT NULL,
        eingefuegt INTEGER NOT NULL DEFAULT 0,
        geaendert INTEGER NOT NULL DEFAULT 0,
        deaktiviert INTEGER NOT NULL DEFAULT 0,
        fehler TEXT
      );
    `,
  },
  {
    name: "0006_foerderschiene_finance_lead_retries",
    sql: `
      ALTER TABLE foerderschiene_reports
        ADD COLUMN IF NOT EXISTS finance_lead_retry_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS finance_lead_retry_count INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS finance_lead_last_error TEXT;

      CREATE INDEX IF NOT EXISTS foerderschiene_reports_finance_lead_retry_idx
        ON foerderschiene_reports (finance_lead_retry_at)
        WHERE finance_lead_retry_at IS NOT NULL;
    `,
  },
  {
    name: "0007_refunded_checkout_orders",
    sql: `
      ALTER TABLE foerderschiene_reports
        ADD COLUMN IF NOT EXISTS payment_intent_id TEXT,
        ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP;

      ALTER TABLE energieausweis_orders
        ADD COLUMN IF NOT EXISTS payment_intent_id TEXT,
        ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP;

      ALTER TABLE gebaeudecheck_orders
        ADD COLUMN IF NOT EXISTS payment_intent_id TEXT,
        ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP;

      CREATE INDEX IF NOT EXISTS foerderschiene_reports_payment_intent_idx
        ON foerderschiene_reports (payment_intent_id)
        WHERE payment_intent_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS energieausweis_orders_payment_intent_idx
        ON energieausweis_orders (payment_intent_id)
        WHERE payment_intent_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS gebaeudecheck_orders_payment_intent_idx
        ON gebaeudecheck_orders (payment_intent_id)
        WHERE payment_intent_id IS NOT NULL;
    `,
  },
  {
    name: "0008_gebaeudecheck_credits_deducted",
    sql: `
      ALTER TABLE gebaeudecheck_orders
        ADD COLUMN IF NOT EXISTS credits_deducted INTEGER NOT NULL DEFAULT 0;
    `,
  },
];

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // Ensure the tracking table exists before any migration runs.
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const migration of MIGRATIONS) {
      const { rowCount } = await client.query(
        "SELECT 1 FROM _migrations WHERE name = $1",
        [migration.name],
      );
      if (rowCount && rowCount > 0) continue; // already applied

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [
          migration.name,
        ]);
        await client.query("COMMIT");
        console.log(`[migrations] Applied: ${migration.name}`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`[migrations] Failed: ${migration.name}`, err);
        throw err;
      }
    }
  } finally {
    client.release();
  }
}
