import {
  db,
  worldsTable,
  areasTable,
  categoriesTable,
  serviceTemplatesTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { CLASSIFICATION_SNAPSHOT } from "../seed-data/classificationSnapshot";

/**
 * Ensures the Branchen catalog (worlds → areas → categories) and the service
 * templates exist in whatever database this server is pointed at — most
 * importantly PRODUCTION, where the dev-only seed script never runs.
 *
 * The data comes from a generated snapshot of the dev database
 * (src/seed-data/classificationSnapshot.ts, written by
 * scripts/src/snapshotClassification.ts). Behavior:
 *
 * - worlds/areas/categories are UPSERTED on every boot (keyed by string id /
 *   slug), so a redeploy converges production onto the shipped catalog.
 *   Nothing is ever deleted here — removals stay in the dev seed script,
 *   which is destructive only behind SEED_ALLOW_DELETE.
 * - service templates are seeded only when the table is EMPTY (rows have no
 *   stable natural key; the dev script wipes and reseeds them instead).
 * - `provider_count` is recomputed from the providers table afterwards.
 *
 * Failures are logged but never crash the server.
 */
export async function ensureClassificationCatalog(): Promise<void> {
  try {
    let templatesInserted = 0;
    await db.transaction(async (tx) => {
      // Serialize concurrent boots (autoscale can start several instances at
      // once): without this, two instances could both see an empty
      // service_templates table and double-insert. Lock is released on commit.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(824001)`);

      for (const w of CLASSIFICATION_SNAPSHOT.worlds) {
        await tx
          .insert(worldsTable)
          .values(w)
          .onConflictDoUpdate({
            target: worldsTable.id,
            set: {
              title: w.title,
              description: w.description,
              defaultPricingModel: w.defaultPricingModel,
              displayOrder: w.displayOrder,
            },
          });
      }

      for (const a of CLASSIFICATION_SNAPSHOT.areas) {
        await tx
          .insert(areasTable)
          .values(a)
          .onConflictDoUpdate({
            target: areasTable.id,
            set: {
              worldId: a.worldId,
              code: a.code,
              num: a.num,
              name: a.name,
              description: a.description,
              displayOrder: a.displayOrder,
            },
          });
      }

      for (const c of CLASSIFICATION_SNAPSHOT.categories) {
        await tx
          .insert(categoriesTable)
          .values(c)
          .onConflictDoUpdate({
            target: categoriesTable.slug,
            set: {
              name: c.name,
              icon: c.icon,
              description: c.description,
              color: c.color,
              colorLight: c.colorLight,
              displayOrder: c.displayOrder,
              requiresDirectBilling: c.requiresDirectBilling,
              qualifications: c.qualifications,
              worldId: c.worldId,
              areaId: c.areaId,
              professionCode: c.professionCode,
              pricingModel: c.pricingModel,
              leadPriceCents: c.leadPriceCents,
              indicativePrice: c.indicativePrice,
              priceUnit: c.priceUnit,
              exampleServices: c.exampleServices,
              requirements: c.requirements,
            },
          });
      }

      const [tpl] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(serviceTemplatesTable);
      if ((tpl?.count ?? 0) === 0 && CLASSIFICATION_SNAPSHOT.serviceTemplates.length > 0) {
        for (const t of CLASSIFICATION_SNAPSHOT.serviceTemplates) {
          await tx.insert(serviceTemplatesTable).values(t);
          templatesInserted++;
        }
      }

      await tx.execute(sql`
        UPDATE categories c
        SET provider_count = (
          SELECT COUNT(*) FROM providers p WHERE p.category_slug = c.slug
        )
      `);
    });

    logger.info(
      {
        worlds: CLASSIFICATION_SNAPSHOT.worlds.length,
        areas: CLASSIFICATION_SNAPSHOT.areas.length,
        categories: CLASSIFICATION_SNAPSHOT.categories.length,
        templatesInserted,
      },
      "[classification] Branchen catalog ready",
    );
  } catch (err) {
    logger.error({ err }, "[classification] Failed to seed Branchen catalog");
  }
}
