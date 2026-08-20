/**
 * Maps a provider (via its `categorySlug`) onto the Klard classification "world"
 * and Abrechnungsmodell, the single source of truth for world-aware money rules:
 *
 *   - world `pro`    → Beratung & Bau     (commission 14% Basic / 9% Premium; flat lead price)
 *   - world `alltag` → Alltag & Handwerk  (commission 15% Basic / 10% Premium; tiered lead price)
 *
 * Pricing model (Model B):
 *   - `now` / `hybrid` categories charge a booking COMMISSION (no lead fee)
 *   - `lead` / `hybrid` categories charge a per-lead FEE (no commission)
 *
 * There is no denormalization: classification is read from `categories` by slug.
 */
import { db } from "@workspace/db";
import { categoriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type WorldId = "pro" | "alltag";

/** Normalize any stored world id to the two supported worlds (default "pro"). */
export function normalizeWorld(worldId: string | null | undefined): WorldId {
  return worldId === "alltag" ? "alltag" : "pro";
}

export interface CategoryClassification {
  worldId: WorldId;
  /** now | lead | hybrid; null when the category is unknown/unclassified. */
  pricingModel: string | null;
  /** Category-level lead fee in cents (alltag tiers); null for flat/pro. */
  leadPriceCents: number | null;
}

const PRO_DEFAULT: CategoryClassification = {
  worldId: "pro",
  pricingModel: null,
  leadPriceCents: null,
};

/** Resolve a category slug to its world + pricing model + lead price. */
export async function getCategoryClassification(
  categorySlug: string | null | undefined,
): Promise<CategoryClassification> {
  if (!categorySlug) return PRO_DEFAULT;
  const [cat] = await db
    .select({
      worldId: categoriesTable.worldId,
      pricingModel: categoriesTable.pricingModel,
      leadPriceCents: categoriesTable.leadPriceCents,
    })
    .from(categoriesTable)
    .where(eq(categoriesTable.slug, categorySlug))
    .limit(1);
  if (!cat) return PRO_DEFAULT;
  return {
    worldId: normalizeWorld(cat.worldId),
    pricingModel: cat.pricingModel ?? null,
    leadPriceCents: cat.leadPriceCents ?? null,
  };
}

/**
 * Model B: a category may be booked (and thus charged commission) when it is a
 * `now` or `hybrid` category. Unknown/unclassified (null) defaults to bookable
 * for back-compat with pre-classification providers.
 */
export function allowsBooking(pricingModel: string | null | undefined): boolean {
  return pricingModel == null || pricingModel === "now" || pricingModel === "hybrid";
}

/**
 * Model B: a category accepts paid leads (and thus charges a lead fee) when it
 * is a `lead` or `hybrid` category.
 */
export function allowsLead(pricingModel: string | null | undefined): boolean {
  return pricingModel === "lead" || pricingModel === "hybrid";
}
