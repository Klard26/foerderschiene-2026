import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express } from "express";
import { db } from "@workspace/db";
import { foerderLeadsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Integration tests for the public Förderprogramm-Finder submission endpoint.
// The AI + email pipeline (processFoerderFinderLead) is mocked — these tests
// guard the request-side contract:
//   1. Valid submission persists the lead with a server-side consent snapshot
//      and deduped/capped massnahmen, and kicks off background processing.
//   2. Missing DSGVO consent is rejected (400) without persisting anything.
//   3. The per-address cooldown rejects a repeat submission (429).
// ---------------------------------------------------------------------------

vi.mock("../lib/foerderFinder", () => ({
  processFoerderFinderLead: vi.fn().mockResolvedValue(undefined),
  recoverPendingFoerderLeads: vi.fn().mockResolvedValue(undefined),
}));

import { processFoerderFinderLead } from "../lib/foerderFinder";
import foerderschieneRouter from "./foerderschiene";

const TEST_EMAILS = [
  "finder-test-a@example.test",
  "finder-test-b@example.test",
  "finder-test-noconsent@example.test",
];

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
  app.use("/api", foerderschieneRouter);
  return app;
}

let server: Server;
let baseUrl: string;

async function cleanup() {
  await db
    .delete(foerderLeadsTable)
    .where(inArray(foerderLeadsTable.email, TEST_EMAILS));
}

beforeAll(async () => {
  await cleanup();
  const app = makeApp();
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await cleanup();
  server?.close();
});

async function submit(body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/api/foerderschiene/finder`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const validInput = {
  name: "Finder Test",
  email: "finder-test-a@example.test",
  gebaeudeTyp: "einfamilienhaus",
  baujahr: 1975,
  massnahmen: ["heizung", "heizung", "daemmung"],
  eigennutzer: true,
  bundesland: "Bayern",
  dsgvoConsent: true,
};

describe("POST /foerderschiene/finder", () => {
  it("persists a valid lead with consent snapshot and deduped massnahmen, and starts processing", async () => {
    const res = await submit(validInput);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.leadId).toBeGreaterThan(0);

    const [lead] = await db
      .select()
      .from(foerderLeadsTable)
      .where(eq(foerderLeadsTable.id, res.body.leadId));
    expect(lead).toBeDefined();
    expect(lead!.email).toBe("finder-test-a@example.test");
    expect(lead!.emailStatus).toBe("pending");
    // Server-side consent snapshot, never client-supplied
    expect(lead!.consentVersion).toBe("1.0");
    expect(lead!.consentText).toContain("Einwilligung");
    expect(lead!.consentAt).toBeInstanceOf(Date);
    // massnahmen deduped
    const eingaben = lead!.eingaben as { massnahmen: string[] };
    expect(eingaben.massnahmen).toEqual(["heizung", "daemmung"]);

    expect(processFoerderFinderLead).toHaveBeenCalledWith(
      res.body.leadId,
      expect.objectContaining({ email: "finder-test-a@example.test" }),
    );
  });

  it("rejects a repeat submission for the same address within the cooldown (429)", async () => {
    const res = await submit({ ...validInput, name: "Repeat" });
    expect(res.status).toBe(429);
    const rows = await db
      .select({ id: foerderLeadsTable.id })
      .from(foerderLeadsTable)
      .where(eq(foerderLeadsTable.email, "finder-test-a@example.test"));
    expect(rows).toHaveLength(1);
  });

  it("rejects a submission without DSGVO consent (400) and persists nothing", async () => {
    const res = await submit({
      ...validInput,
      email: "finder-test-noconsent@example.test",
      dsgvoConsent: false,
    });
    expect(res.status).toBe(400);
    const rows = await db
      .select({ id: foerderLeadsTable.id })
      .from(foerderLeadsTable)
      .where(eq(foerderLeadsTable.email, "finder-test-noconsent@example.test"));
    expect(rows).toHaveLength(0);
  });

  it("rejects an invalid body (unknown massnahme)", async () => {
    const res = await submit({
      ...validInput,
      email: "finder-test-b@example.test",
      massnahmen: ["atomkraftwerk"],
    });
    expect(res.status).toBe(400);
  });
});
