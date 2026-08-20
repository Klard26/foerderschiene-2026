import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";

/**
 * Returns the set of Clerk user IDs that have admin access, configured via the
 * `ADMIN_CLERK_USER_IDS` env var (comma-separated). Returns an empty set if
 * unset, which disables admin access entirely (fail-closed).
 */
export function adminUserIds(): Set<string> {
  const raw = process.env.ADMIN_CLERK_USER_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export function isAdminUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return adminUserIds().has(userId);
}

/**
 * Express middleware: 401 if not signed in, 403 if not in the admin allowlist.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!isAdminUserId(userId)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
