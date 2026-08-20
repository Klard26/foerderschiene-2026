import { db, userRolesTable, type UserRole } from "@workspace/db";
import { eq } from "drizzle-orm";

export type { UserRole };

/** Read the role bound to a Clerk user, or null if none has been claimed yet. */
export async function getRole(userId: string): Promise<UserRole | null> {
  const [row] = await db
    .select({ role: userRolesTable.role })
    .from(userRolesTable)
    .where(eq(userRolesTable.clerkUserId, userId))
    .limit(1);
  return (row?.role as UserRole | undefined) ?? null;
}

export class RoleConflictError extends Error {
  constructor(
    public readonly current: UserRole,
    public readonly attempted: UserRole,
  ) {
    super(`Account is already a "${current}" account and cannot act as "${attempted}".`);
    this.name = "RoleConflictError";
  }
}

/**
 * Claim a role for a user. If the user has no role yet, it is set (idempotently,
 * tolerating a concurrent claim). If the user already holds the SAME role, this is
 * a no-op. If the user already holds the OTHER role, a {@link RoleConflictError} is
 * thrown so the caller can respond 403 — this is what enforces strict separation.
 */
export async function claimRole(userId: string, role: UserRole): Promise<UserRole> {
  const existing = await getRole(userId);
  if (existing === role) return role;
  if (existing && existing !== role) throw new RoleConflictError(existing, role);

  await db
    .insert(userRolesTable)
    .values({ clerkUserId: userId, role })
    .onConflictDoNothing({ target: userRolesTable.clerkUserId });

  // Re-read to settle races: a concurrent request may have claimed the other role.
  const settled = await getRole(userId);
  if (settled && settled !== role) throw new RoleConflictError(settled, role);
  return role;
}
