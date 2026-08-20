import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { providersTable } from "./providers";

export const assessmentsTable = pgTable("assessments", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  providerId: integer("provider_id").references(() => providersTable.id, { onDelete: "set null" }),
  label: text("label").notNull(),
  addressJson: jsonb("address_json"),
  inputJson: jsonb("input_json").notNull(),
  resultJson: jsonb("result_json").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAssessmentSchema = createInsertSchema(assessmentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAssessment = z.infer<typeof insertAssessmentSchema>;
export type Assessment = typeof assessmentsTable.$inferSelect;
