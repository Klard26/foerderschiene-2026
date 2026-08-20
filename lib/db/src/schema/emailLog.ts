import { pgTable, serial, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const emailLogTable = pgTable(
  "email_log",
  {
    id: serial("id").primaryKey(),
    templateId: text("template_id").notNull(),
    recipient: text("recipient").notNull(),
    relatedId: text("related_id"),
    subject: text("subject"),
    status: text("status").notNull(),
    error: text("error"),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
  },
  (t) => ({
    templateRelatedIdx: index("email_log_template_related_idx").on(
      t.templateId,
      t.relatedId,
    ),
    sentAtIdx: index("email_log_sent_at_idx").on(t.sentAt),
    // Prevents two concurrent callers from racing past the in-flight claim and
    // double-sending the same transactional email. Only 'in_flight' and 'sent'
    // rows participate — 'failed' and 'skipped' rows are excluded so a retried
    // send can claim a fresh slot even after a prior attempt was logged.
    activeDedup: uniqueIndex("email_log_active_dedup")
      .on(t.templateId, t.relatedId)
      .where(sql`status IN ('in_flight', 'sent')`),
  }),
);

export const insertEmailLogSchema = createInsertSchema(emailLogTable).omit({
  id: true,
  sentAt: true,
});
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;
export type EmailLog = typeof emailLogTable.$inferSelect;
