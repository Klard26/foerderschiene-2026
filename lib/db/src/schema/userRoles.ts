import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Strict role separation within the single shared Clerk instance: every signed-in
 * user is bound to exactly ONE role — either `customer` (Kunde, the Klard
 * marketplace) or `provider` (Berater, the standalone provider app). The same
 * Clerk account (= same email) can therefore never hold both roles.
 *
 * A row is claimed the first time a user acts in a role-specific surface (signing
 * up in the provider app, or creating a booking / provider profile). Once set, the
 * role is immutable from the API — attempting to act in the other role is rejected.
 */
export const userRolesTable = pgTable("user_roles", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  role: text("role").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const USER_ROLES = ["customer", "provider"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const insertUserRoleSchema = createInsertSchema(userRolesTable).omit({
  createdAt: true,
});
export type InsertUserRole = z.infer<typeof insertUserRoleSchema>;
export type UserRoleRow = typeof userRolesTable.$inferSelect;
