import pg from "pg";

const { Pool } = pg;

/**
 * Dedicated connection pool for the imported "Förderpilot" funding catalog.
 *
 * The Förderpilot tables live in the regular `public` schema (they USED to sit
 * in an isolated `foerderpilot` schema, but Replit's publish pipeline only
 * supports the public schema when copying/diffing the database into
 * production — a custom schema aborts the publish build). The pool stays
 * separate from the shared Drizzle pool only to isolate connection load of the
 * catalog's raw-SQL queries.
 */
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set for the Förderpilot pool.");
}

export const foerderpilotPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  // Never wait forever for a connection at boot — a stalled prod DB must
  // surface as a loud error (which the setup retries), not a silent hang.
  connectionTimeoutMillis: 15_000,
  // Session default for every pooled connection. Generous enough for the
  // multi-thousand-line catalog import, but guarantees NO statement (boot
  // setup or runtime query) can block silently forever.
  statement_timeout: 120_000,
});

foerderpilotPool.on("error", (err) => {
  // A pool-level connection error must never crash the process.
  // eslint-disable-next-line no-console
  console.error("[foerderpilot-db] Unexpected pool error:", err.message);
});

/** Typed multi-row query helper. */
export async function fpQuery<T = unknown>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await foerderpilotPool.query(text, params);
  return res.rows as T[];
}

/** Typed single-row query helper (or null). */
export async function fpQueryOne<T = unknown>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await fpQuery<T>(text, params);
  return rows[0] ?? null;
}
