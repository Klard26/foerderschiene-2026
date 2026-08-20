/**
 * Matches an open request to candidate providers. Providers are matched on the
 * request's `categorySlug`; same-PLZ-prefix candidates are preferred, and the
 * ordering is (tier ranking boost + provider rating) so premium providers and
 * higher-rated ones surface first. Matched rows are written to `request_matches`
 * (idempotent per request+provider) and the matched providers are returned for
 * notification.
 */
import { db } from "@workspace/db";
import { providersTable, requestMatchesTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { entitlementsForTier, type DbTransaction } from "./leadEntitlements";

const MATCH_LIMIT = 25;

export interface MatchedProvider {
  id: number;
  email: string;
  displayName: string;
}

/**
 * Find + persist matches for a request inside the creating transaction.
 * Returns the matched providers (id/email/displayName) for downstream emails.
 */
export async function matchProvidersForRequest(
  tx: DbTransaction,
  requestId: number,
  categorySlug: string,
  postalCode?: string | null,
): Promise<MatchedProvider[]> {
  const premiumBoost = entitlementsForTier("premium").rankingBoost;
  // Ranking score: premium boost + provider rating, with a small nudge for a
  // matching 2-digit PLZ region when the request carries a postal code.
  const zipPrefix = postalCode ? postalCode.trim().slice(0, 2) : null;
  const zipBonus =
    zipPrefix && /^\d{2}$/.test(zipPrefix)
      ? sql<number>`(CASE WHEN ${providersTable.zip} LIKE ${zipPrefix + "%"} THEN 1 ELSE 0 END)`
      : sql<number>`0`;
  const scoreExpr = sql<number>`(CASE WHEN ${providersTable.subscriptionTier} = 'premium' THEN ${premiumBoost} ELSE 0 END) + ${providersTable.rating} + ${zipBonus}`;

  const candidates = await tx
    .select({
      id: providersTable.id,
      email: providersTable.email,
      displayName: providersTable.displayName,
      score: scoreExpr,
    })
    .from(providersTable)
    .where(eq(providersTable.categorySlug, categorySlug))
    .orderBy(desc(scoreExpr))
    .limit(MATCH_LIMIT);

  if (candidates.length === 0) return [];

  await tx
    .insert(requestMatchesTable)
    .values(
      candidates.map((c) => ({
        requestId,
        providerId: c.id,
        matchScore: c.score,
        notifiedAt: new Date(),
      })),
    )
    .onConflictDoNothing({
      target: [requestMatchesTable.requestId, requestMatchesTable.providerId],
    });

  return candidates.map((c) => ({ id: c.id, email: c.email, displayName: c.displayName }));
}

/** Whether a provider is matched to a request (gate for inbox detail/offer). */
export async function isProviderMatched(
  providerId: number,
  requestId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: requestMatchesTable.id })
    .from(requestMatchesTable)
    .where(
      and(
        eq(requestMatchesTable.providerId, providerId),
        eq(requestMatchesTable.requestId, requestId),
      ),
    )
    .limit(1);
  return !!row;
}
