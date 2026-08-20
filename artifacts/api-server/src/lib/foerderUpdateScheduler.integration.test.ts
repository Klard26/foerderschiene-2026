import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@workspace/db";
import { foerderUpdateLogTable } from "@workspace/db";
import {
  consecutiveFailureCount,
  dueFoerderUpdateSources,
  failureAlertRelatedId,
} from "./foerderUpdateScheduler";

// DB-backed due-check for the weekly catalogue update: runs Mondays from
// 06:00 Europe/Berlin; per source at most once per ~week, based on the last
// SUCCESSFUL completion in foerder_update_log (restart-proof, failure-aware).

// 2026-08-24 is a Monday. 05:00Z = 07:00 Europe/Berlin (CEST).
const MONDAY_MORNING = new Date("2026-08-24T05:00:00Z");
// 03:00Z = 05:00 Berlin — before the 06:00 window opens.
const MONDAY_EARLY = new Date("2026-08-24T03:00:00Z");
// 2026-08-25 is a Tuesday.
const TUESDAY = new Date("2026-08-25T05:00:00Z");

async function clearLog() {
  await db.delete(foerderUpdateLogTable);
}

beforeEach(clearLog);
afterAll(clearLog);

describe("dueFoerderUpdateSources", () => {
  it("is empty outside Monday or before 06:00 Berlin", async () => {
    expect(await dueFoerderUpdateSources(TUESDAY)).toEqual([]);
    expect(await dueFoerderUpdateSources(MONDAY_EARLY)).toEqual([]);
  });

  it("includes all sources Monday morning when no successful run exists", async () => {
    const due = await dueFoerderUpdateSources(MONDAY_MORNING);
    expect(due.map((s) => s.quelle).sort()).toEqual(["bafa", "kfw"]);
  });

  it("excludes a source that completed successfully within the last 6 days", async () => {
    await db.insert(foerderUpdateLogTable).values({
      quelle: "kfw",
      gestartetAm: new Date(MONDAY_MORNING.getTime() - 60_000),
      abgeschlossenAm: new Date(MONDAY_MORNING.getTime() - 30_000),
    });
    const due = await dueFoerderUpdateSources(MONDAY_MORNING);
    expect(due.map((s) => s.quelle)).toEqual(["bafa"]);
  });

  it("keeps retrying a source whose last run failed", async () => {
    await db.insert(foerderUpdateLogTable).values([
      {
        quelle: "kfw",
        gestartetAm: new Date(MONDAY_MORNING.getTime() - 60_000),
        abgeschlossenAm: new Date(MONDAY_MORNING.getTime() - 30_000),
      },
      {
        quelle: "bafa",
        gestartetAm: new Date(MONDAY_MORNING.getTime() - 60_000),
        abgeschlossenAm: new Date(MONDAY_MORNING.getTime() - 30_000),
        fehler: "fetch failed",
      },
    ]);
    const due = await dueFoerderUpdateSources(MONDAY_MORNING);
    expect(due.map((s) => s.quelle)).toEqual(["bafa"]);
  });

  it("is due again on the following Monday", async () => {
    await db.insert(foerderUpdateLogTable).values({
      quelle: "kfw",
      gestartetAm: MONDAY_MORNING,
      abgeschlossenAm: MONDAY_MORNING,
    });
    const nextMonday = new Date("2026-08-31T05:00:00Z");
    const due = await dueFoerderUpdateSources(nextMonday);
    expect(due.map((s) => s.quelle).sort()).toEqual(["bafa", "kfw"]);
  });
});

describe("consecutiveFailureCount", () => {
  it("recognizes two completed failures in a row", async () => {
    await db.insert(foerderUpdateLogTable).values([
      {
        quelle: "kfw",
        gestartetAm: new Date("2026-08-24T05:00:00Z"),
        abgeschlossenAm: new Date("2026-08-24T05:01:00Z"),
        fehler: "first fetch failed",
      },
      {
        quelle: "kfw",
        gestartetAm: new Date("2026-08-24T06:00:00Z"),
        abgeschlossenAm: new Date("2026-08-24T06:01:00Z"),
        fehler: "second fetch failed",
      },
    ]);

    await expect(consecutiveFailureCount("kfw")).resolves.toBe(2);
  });

  it("resets the count after a successful run", async () => {
    await db.insert(foerderUpdateLogTable).values([
      {
        quelle: "bafa",
        gestartetAm: new Date("2026-08-24T05:00:00Z"),
        abgeschlossenAm: new Date("2026-08-24T05:01:00Z"),
        fehler: "older failure",
      },
      {
        quelle: "bafa",
        gestartetAm: new Date("2026-08-24T06:00:00Z"),
        abgeschlossenAm: new Date("2026-08-24T06:01:00Z"),
      },
      {
        quelle: "bafa",
        gestartetAm: new Date("2026-08-24T07:00:00Z"),
        abgeschlossenAm: new Date("2026-08-24T07:01:00Z"),
        fehler: "new failure",
      },
    ]);

    await expect(consecutiveFailureCount("bafa")).resolves.toBe(1);
  });
});

describe("failureAlertRelatedId", () => {
  it("uses one source-specific ID for the Berlin calendar week", () => {
    const monday = new Date("2026-08-24T05:00:00Z");
    const sunday = new Date("2026-08-30T20:00:00Z");
    const followingMonday = new Date("2026-08-31T05:00:00Z");

    expect(failureAlertRelatedId("kfw", monday)).toBe(
      failureAlertRelatedId("kfw", sunday),
    );
    expect(failureAlertRelatedId("kfw", followingMonday)).not.toBe(
      failureAlertRelatedId("kfw", monday),
    );
    expect(failureAlertRelatedId("bafa", monday)).not.toBe(
      failureAlertRelatedId("kfw", monday),
    );
  });
});
