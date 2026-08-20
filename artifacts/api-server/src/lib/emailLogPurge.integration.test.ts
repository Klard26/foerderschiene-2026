import { describe, it, expect, beforeEach, afterAll } from "vitest";

// ---------------------------------------------------------------------------
// Integration tests for the email_log retention/purge job
// (`purgeOldEmailLogs` in email.ts).
//
// Account deletion already purges a user's email_log rows, but rows for users
// who never delete their account would otherwise accumulate forever, keeping
// recipient email addresses on file indefinitely. This scheduled job ages out
// rows older than EMAIL_LOG_RETENTION_DAYS while preserving recent rows that
// the reminder/idempotency dedupe (`wasEmailSent`) still depends on.
//
// We run the real DELETE against the live (development) Postgres. No external
// edges are involved, so nothing needs mocking.
// ---------------------------------------------------------------------------

import {
  purgeOldEmailLogs,
  wasEmailLogged,
  wasEmailSent,
  EMAIL_LOG_RETENTION_DAYS,
} from "./email";
import { db, emailLogTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";

const sfx = `purgetest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const templateId = `${sfx}_tpl`;
const recipient = `${sfx}@example.com`;

const DAY_MS = 24 * 60 * 60 * 1000;

async function insertRow(opts: {
  relatedId: string;
  ageDays: number;
  status?: "sent" | "failed";
}): Promise<number> {
  const [row] = await db
    .insert(emailLogTable)
    .values({
      templateId,
      recipient,
      relatedId: opts.relatedId,
      subject: "Test",
      status: opts.status ?? "sent",
      sentAt: new Date(Date.now() - opts.ageDays * DAY_MS),
    })
    .returning({ id: emailLogTable.id });
  return row!.id;
}

beforeEach(async () => {
  await db.delete(emailLogTable).where(eq(emailLogTable.templateId, templateId));
});

afterAll(async () => {
  await db.delete(emailLogTable).where(like(emailLogTable.templateId, `${sfx}%`));
});

describe("purgeOldEmailLogs — ages out rows past the retention window", () => {
  it("deletes rows older than the retention window and keeps recent rows", async () => {
    const oldId = await insertRow({
      relatedId: "old",
      ageDays: EMAIL_LOG_RETENTION_DAYS + 10,
    });
    const recentId = await insertRow({
      relatedId: "recent",
      ageDays: 1,
    });

    const deleted = await purgeOldEmailLogs();
    expect(deleted).toBeGreaterThanOrEqual(1);

    const remaining = await db
      .select({ id: emailLogTable.id })
      .from(emailLogTable)
      .where(eq(emailLogTable.templateId, templateId));
    const remainingIds = remaining.map((r) => r.id);

    expect(remainingIds).not.toContain(oldId);
    expect(remainingIds).toContain(recentId);
  });

  it("does not delete a row sitting just inside the retention window", async () => {
    const justInsideId = await insertRow({
      relatedId: "edge",
      ageDays: EMAIL_LOG_RETENTION_DAYS - 1,
    });

    await purgeOldEmailLogs();

    const remaining = await db
      .select({ id: emailLogTable.id })
      .from(emailLogTable)
      .where(eq(emailLogTable.templateId, templateId));
    expect(remaining.map((r) => r.id)).toContain(justInsideId);
  });

  it("preserves reminder dedupe — wasEmailSent still finds a recent sent row after a purge", async () => {
    await insertRow({ relatedId: "dedupe", ageDays: 5, status: "sent" });

    await purgeOldEmailLogs();

    expect(await wasEmailSent(templateId, "dedupe")).toBe(true);
  });

  it("breaks dedupe only for genuinely expired rows (older than retention)", async () => {
    await insertRow({
      relatedId: "expired",
      ageDays: EMAIL_LOG_RETENTION_DAYS + 30,
      status: "sent",
    });

    await purgeOldEmailLogs();

    expect(await wasEmailSent(templateId, "expired")).toBe(false);
  });

  it("rate-limits operator alerts even when the prior delivery failed", async () => {
    await insertRow({ relatedId: "source-kfw", ageDays: 1, status: "failed" });

    await expect(wasEmailLogged(templateId, "source-kfw")).resolves.toBe(true);
    await expect(wasEmailLogged(templateId, "other-source")).resolves.toBe(false);
  });

  it("respects an explicit retention window and reference time", async () => {
    const id = await insertRow({ relatedId: "custom", ageDays: 40 });

    // With a 30-day window, the 40-day-old row is expired and removed.
    const deleted = await purgeOldEmailLogs(new Date(), 30);
    expect(deleted).toBeGreaterThanOrEqual(1);

    const remaining = await db
      .select({ id: emailLogTable.id })
      .from(emailLogTable)
      .where(eq(emailLogTable.templateId, templateId));
    expect(remaining.map((r) => r.id)).not.toContain(id);
  });

  it("is idempotent — a second run over an already-clean window deletes nothing of ours", async () => {
    await insertRow({ relatedId: "recent2", ageDays: 2 });

    await purgeOldEmailLogs();
    const beforeSecond = await db
      .select({ id: emailLogTable.id })
      .from(emailLogTable)
      .where(eq(emailLogTable.templateId, templateId));

    await purgeOldEmailLogs();
    const afterSecond = await db
      .select({ id: emailLogTable.id })
      .from(emailLogTable)
      .where(eq(emailLogTable.templateId, templateId));

    expect(afterSecond.length).toBe(beforeSecond.length);
  });
});
