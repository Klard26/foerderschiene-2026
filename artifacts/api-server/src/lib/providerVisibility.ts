import type { Request } from "express";
import { db, providersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { isAdminUserId } from "./adminAuth";

/**
 * Provider visibility for public detail subresources (services, availability,
 * reviews). Approved profiles are public; non-approved profiles are visible
 * only to their owner or an admin, so the marketplace cannot leak pending or
 * rejected profiles by known ID. Resolves to false when the provider does not
 * exist at all.
 */
export async function canViewProvider(
  req: Request,
  providerId: number,
): Promise<boolean> {
  const [provider] = await db
    .select({
      approvalStatus: providersTable.approvalStatus,
      clerkUserId: providersTable.clerkUserId,
    })
    .from(providersTable)
    .where(eq(providersTable.id, providerId))
    .limit(1);
  if (!provider) return false;
  if (provider.approvalStatus === "approved") return true;
  const { userId } = getAuth(req);
  if (!userId) return false;
  return isAdminUserId(userId) || provider.clerkUserId === userId;
}
