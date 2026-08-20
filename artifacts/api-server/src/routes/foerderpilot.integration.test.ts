import { describe, it, expect, beforeAll, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Integration tests for the imported Förderpilot funding catalog. These guard
// two real bugs that were only caught in review and were previously untested:
//
//   1. Category/target-group FILTERS send slugs, but the `v_programm_voll` view
//      aggregates display NAMES — so the finder must resolve slugs via the
//      junction tables, not `= ANY(vp.kategorien)`. A regression here would
//      silently return zero results for every category filter.
//   2. The first-boot data loader (`ensureFoerderpilotCatalog`) must be
//      idempotent: re-running it against an already-populated catalog must not
//      error or duplicate data (`foerdergeber` has no unique key).
//
// The real route handlers run against the live (development) Postgres and the
// real Förderpilot schema, which `ensureFoerderpilotCatalog()` loads in
// beforeAll. Nothing external is involved, so nothing needs mocking.
// ---------------------------------------------------------------------------

import express, { type Express } from "express";
import foerderpilotRouter from "./foerderpilot";
import { ensureFoerderpilotCatalog } from "../lib/foerderpilotSetup";
import { fpQueryOne } from "../lib/foerderpilotDb";

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
  app.use(express.json());
  app.use("/api", foerderpilotRouter);
  return app;
}

let server: Server;
let baseUrl: string;

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
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

async function countRows(table: string): Promise<number> {
  const row = await fpQueryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${table}`,
  );
  return Number(row?.n ?? 0);
}

beforeAll(async () => {
  // Load the real Förderpilot catalog into the dev DB (idempotent — skips if
  // already populated). Generous timeout: a cold load runs the full import SQL.
  await ensureFoerderpilotCatalog();

  server = makeApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
}, 60_000);

describe("GET /api/foerderpilot/programme — category-slug filtering", () => {
  it("returns a non-empty result set for a known category slug", async () => {
    // `energie_gebaeude` is one of the seeded kategorie slugs with multiple
    // programs. This only matches if the handler resolves the slug via the
    // junction table rather than comparing it against the view's display names.
    const res = await api(
      "GET",
      "/api/foerderpilot/programme?kategorie=energie_gebaeude",
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(Array.isArray(res.body.programme)).toBe(true);
    expect(res.body.programme.length).toBeGreaterThan(0);
    expect(res.body.anzahl).toBe(res.body.programme.length);
  });

  it("returns zero results for an unknown category slug", async () => {
    const res = await api(
      "GET",
      "/api/foerderpilot/programme?kategorie=__does_not_exist__",
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.anzahl).toBe(0);
    expect(res.body.programme).toEqual([]);
  });

  it("filters by zielgruppe slug via the junction table", async () => {
    const res = await api(
      "GET",
      "/api/foerderpilot/programme?zielgruppe=privat",
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.programme.length).toBeGreaterThan(0);
  });

  it("returns zero results for an unknown zielgruppe slug", async () => {
    const res = await api(
      "GET",
      "/api/foerderpilot/programme?zielgruppe=__nope__",
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.programme).toEqual([]);
  });
});

describe("ensureFoerderpilotCatalog — idempotent re-run", () => {
  it("does not error or duplicate data when run a second time", async () => {
    const programmeBefore = await countRows("programm");
    const foerdergeberBefore = await countRows("foerdergeber");
    // A loaded catalog must have programs.
    expect(programmeBefore).toBeGreaterThan(0);

    // The module-level `didRun` guard short-circuits a second call within the
    // same process, so reset the module registry to obtain a fresh instance
    // (didRun = false) that actually re-executes the loader body against the
    // now-populated catalog — exercising the real skip-when-populated path.
    vi.resetModules();
    const { ensureFoerderpilotCatalog: ensureAgain } = await import(
      "../lib/foerderpilotSetup"
    );
    await expect(ensureAgain()).resolves.toBeUndefined();

    const programmeAfter = await countRows("programm");
    const foerdergeberAfter = await countRows("foerdergeber");

    // No duplication: row counts are unchanged after the second run.
    expect(programmeAfter).toBe(programmeBefore);
    expect(foerdergeberAfter).toBe(foerdergeberBefore);
  }, 60_000);
});
