import {
  db,
  categoriesTable,
  worldsTable,
  areasTable,
  providersTable,
  servicesTable,
  bookingsTable,
  reviewsTable,
  timeSlotsTable,
  serviceTemplatesTable,
} from "@workspace/db";
import { sql, inArray, notInArray } from "drizzle-orm";
import { writeClassificationSnapshot } from "./snapshotClassification";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/* ------------------------------------------------------------------ *
 * v2 Leistungskatalog (services + the 8 Bau-/Energie Berufsgruppen)
 * ------------------------------------------------------------------ */
interface CatalogService {
  name: string;
  price_type: "fix" | "hr" | "pa" | "hoai" | "on";
  duration: string;
  p_min?: number | null;
  p_avg?: number | null;
  p_max?: number | null;
  unit?: string | null;
  inputs?: string[];
  fundable?: string | null;
  notes?: string | null;
}
interface CatalogServiceCategory {
  name: string;
  display_order: number;
  services: CatalogService[];
}
interface CatalogBranch {
  id: string;
  name: string;
  icon: string;
  description: string;
  color: string;
  color_light: string;
  display_order: number;
  qualifications: Record<string, unknown>;
  service_categories: CatalogServiceCategory[];
}
interface Catalog {
  branches: CatalogBranch[];
}

/* ------------------------------------------------------------------ *
 * v3 Klassifikation (Welten -> Bereiche -> Berufsgruppen)
 * ------------------------------------------------------------------ */
interface ClassProfession {
  id: string;
  code: string;
  name: string;
  example_services?: string | null;
  requirements?: string[];
  indicative_price?: number | null;
  price_unit?: string | null;
  pricing_model?: "now" | "lead" | "hybrid";
}
interface ClassArea {
  id: string;
  code: string;
  num?: string | null;
  name: string;
  description?: string | null;
  professions: ClassProfession[];
}
interface ClassWorld {
  id: string;
  title: string;
  description?: string | null;
  default_pricing_model?: "now" | "lead" | "hybrid";
  areas: ClassArea[];
}
interface Classification {
  worlds: ClassWorld[];
  totals?: { worlds: number; areas: number; professions: number };
}

/** The 8 v2 Bau-/Energie Berufsgruppen (= v3 area "pro_bau"). Keyed by their
 * v2 branch id, which equals the v3 profession code lower-cased. */
const ICON_BY_BRANCH: Record<string, string> = {
  enb: "zap",
  arc: "ruler",
  sta: "pen-tool",
  bau: "hard-hat",
  sac: "search-check",
  vrm: "map",
  tga: "thermometer",
  bps: "shield",
};

const SLUG_BY_BRANCH: Record<string, string> = {
  enb: "energieberatung",
  arc: "architektur",
  sta: "statiker-tragwerksplaner",
  bau: "bauberatung-baubegleitung",
  sac: "gebaeudesachverstaendige",
  vrm: "vermesser-geodaeten",
  tga: "tga-fachplaner-haustechnik",
  bps: "bauphysik-spezialberatung",
};

const NAME_BY_BRANCH: Record<string, string> = {
  enb: "Energieberatung",
  arc: "Architektur",
  sta: "Statiker / Tragwerksplaner",
  bau: "Bauberatung / Baubegleitung",
  sac: "Gebäudesachverständige",
  vrm: "Vermesser / Geodäten",
  tga: "TGA-Fachplaner (Haustechnik)",
  bps: "Bauphysik & Spezialberatung",
};

/** Per-area default Lucide icon (no emojis, per project convention). pro_bau
 * professions keep their individual v2 icons via ICON_BY_BRANCH. */
const ICON_BY_AREA: Record<string, string> = {
  pro_bau: "hard-hat",
  pro_fin: "scale",
  pro_imm: "building",
  pro_biz: "trending-up",
  alltag_haus: "sparkles",
  alltag_garten: "leaf",
  alltag_hw: "wrench",
  alltag_mode: "scissors",
  alltag_beauty: "heart-pulse",
  alltag_tier: "paw-print",
  alltag_fam: "baby",
  alltag_evt: "camera",
  alltag_sen: "heart-handshake",
};

/** Professions billed directly under RVG/StBVV/GNotKG — excluded from Klard's
 * payment flow (matches requiresDirectBilling in the platform). */
const DIRECT_BILLING_CODES = new Set(["STB", "RAB", "WPR", "NOT"]);

/** Stable machine slug for a NEW (non pro_bau) profession. */
function professionSlug(p: ClassProfession): string {
  return p.id.replace(/_/g, "-");
}

/** Build a human-readable reference price string from v2 min/avg/max recommendations. */
function buildReferencePrice(svc: CatalogService): string {
  const fmt = (n: number) => `${n.toLocaleString("de-DE")} €`;
  const suffix = svc.price_type === "hr" ? "/h" : svc.price_type === "hoai" ? " (HOAI)" : "";
  const { p_min, p_avg, p_max } = svc;
  if (p_min != null && p_max != null && p_min !== p_max) {
    return `${fmt(p_min)}–${fmt(p_max)}${suffix}`;
  }
  if (p_avg != null) return `ø ${fmt(p_avg)}${suffix}`;
  if (p_min != null) return `ab ${fmt(p_min)}${suffix}`;
  return "auf Anfrage";
}

/**
 * Best-effort booking-slot length in minutes from a v2 duration string.
 * The full human-readable label is preserved separately in `durationLabel`;
 * this value is only the default appointment length a provider gets when
 * importing the template. Appointment-scale formats (minutes/hours/half-day/
 * days) are parsed precisely; project-scale lead-times (weeks/months/years,
 * "projektbegleitend", "individuell", "Bauzeit" …) cannot be a single slot and
 * are clamped to a standard 2h consultation.
 */
const PROJECT_SLOT_MINUTES = 120;
function num(x: string): number {
  return Number(x.replace(",", "."));
}
function avg(lo: string, hi: string | undefined): number {
  const a = num(lo);
  const b = hi != null ? num(hi) : a;
  return (a + b) / 2;
}
function parseDuration(d: string): number {
  if (!d) return 60;
  const s = d.toLowerCase();
  // Minutes: "ca. 30 Min."
  const minMatch = s.match(/(\d+)\s*min/);
  if (minMatch) return Number(minMatch[1]);
  // Hours (with decimals + ranges): "ca. 4–6h", "ca. 1,5h", "2–3h inkl. Anfahrt"
  const hMatch = s.match(/(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*h\b/);
  if (hMatch) return Math.round(avg(hMatch[1]!, hMatch[2]) * 60);
  if (/halbtag/.test(s)) return 240;
  // Days (singular + plural + ranges): "1 Tag", "1–2 Tage", "ca. 1–3 Tage pro View"
  const dayMatch = s.match(/(\d+)\s*(?:[–-]\s*(\d+))?\s*tage?\b/);
  if (dayMatch) return Math.min(960, Math.round(avg(dayMatch[1]!, dayMatch[2]) * 480));
  // Weeks/months/years and open-ended project descriptors → standard consult slot.
  return PROJECT_SLOT_MINUTES;
}

async function main() {
  const catalogPath = resolve(__dirname, "../data/klard-katalog.json");
  const catalog: Catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const classificationPath = resolve(__dirname, "../data/klard-classification-v3.json");
  const classification: Classification = JSON.parse(readFileSync(classificationPath, "utf8"));

  // v2 branch lookup by id (= v3 pro_bau profession code, lower-cased).
  const branchById = new Map(catalog.branches.map((b) => [b.id, b]));

  // Flatten the v3 hierarchy and resolve every profession to a category row.
  let worldCount = 0;
  let areaCount = 0;
  interface CategoryRow {
    slug: string;
    name: string;
    icon: string;
    description: string | null;
    color: string | null;
    colorLight: string | null;
    displayOrder: number;
    requiresDirectBilling: boolean;
    qualifications: Record<string, unknown> | null;
    worldId: string;
    areaId: string;
    professionCode: string;
    pricingModel: string;
    indicativePrice: number | null;
    priceUnit: string | null;
    exampleServices: string | null;
    requirements: string[];
    leadPriceCents: number | null;
  }
  const categoryRows: CategoryRow[] = [];

  // Server-authoritative Alltag lead-fee tiers (A/B/C) in cents, defaulted per
  // area. Pro categories use the flat pro lead price in code (leadPriceCents=null).
  const LEAD_TIER_CENTS = { A: 600, B: 1000, C: 1500 } as const;
  const LEAD_TIER_BY_AREA: Record<string, keyof typeof LEAD_TIER_CENTS> = {
    alltag_haus: "A",
    alltag_garten: "B",
    alltag_hw: "C",
    alltag_mode: "A",
    alltag_beauty: "A",
    alltag_tier: "A",
    alltag_fam: "A",
    alltag_evt: "B",
    alltag_sen: "A",
  };

  for (const w of classification.worlds) {
    worldCount++;
    for (const a of w.areas) {
      areaCount++;
      a.professions.forEach((p, profIdx) => {
        const branchKey = p.code.toLowerCase();
        const v2 = a.id === "pro_bau" ? branchById.get(branchKey) : undefined;
        const slug = v2 ? SLUG_BY_BRANCH[branchKey]! : professionSlug(p);
        const name = v2 ? NAME_BY_BRANCH[branchKey]! : p.name;
        const icon = v2 ? ICON_BY_BRANCH[branchKey]! : (ICON_BY_AREA[a.id] ?? "briefcase");
        categoryRows.push({
          slug,
          name,
          icon,
          // pro_bau keeps its richer v2 copy; others use the area description.
          description: v2 ? v2.description : (a.description ?? null),
          color: v2 ? v2.color : null,
          colorLight: v2 ? v2.color_light : null,
          displayOrder: v2 ? v2.display_order : profIdx,
          requiresDirectBilling: DIRECT_BILLING_CODES.has(p.code),
          qualifications: v2 ? v2.qualifications : null,
          worldId: w.id,
          areaId: a.id,
          professionCode: p.code,
          pricingModel: p.pricing_model ?? w.default_pricing_model ?? "now",
          indicativePrice: p.indicative_price ?? null,
          priceUnit: p.price_unit ?? null,
          exampleServices: p.example_services ?? null,
          requirements: p.requirements ?? [],
          leadPriceCents:
            w.id === "alltag"
              ? LEAD_TIER_CENTS[LEAD_TIER_BY_AREA[a.id] ?? "B"]
              : null,
        });
      });
    }
  }

  // Fail-fast integrity checks BEFORE touching the DB.
  const slugs = categoryRows.map((r) => r.slug);
  const dupSlugs = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  if (dupSlugs.length > 0) {
    throw new Error(`Duplicate category slugs in classification: ${[...new Set(dupSlugs)].join(", ")}`);
  }
  for (const id of Object.keys(SLUG_BY_BRANCH)) {
    if (!slugs.includes(SLUG_BY_BRANCH[id]!)) {
      throw new Error(`Existing slug '${SLUG_BY_BRANCH[id]}' missing from classification (would orphan providers)`);
    }
  }
  const totals = classification.totals;
  console.log(
    `Classification: ${worldCount} Welten, ${areaCount} Bereiche, ${categoryRows.length} Berufsgruppen` +
      (totals ? ` (manifest: ${totals.worlds}/${totals.areas}/${totals.professions})` : ""),
  );

  const keepSlugs = slugs;
  const allowDelete = process.env.SEED_ALLOW_DELETE === "true";

  await db.transaction(async (tx) => {
    // Providers referencing a slug no longer in the catalog. Non-destructive by
    // default (data-loss guard): only deleted when SEED_ALLOW_DELETE=true.
    const orphanProviders = await tx
      .select({ id: providersTable.id, slug: providersTable.categorySlug })
      .from(providersTable)
      .where(notInArray(providersTable.categorySlug, keepSlugs));
    if (orphanProviders.length > 0) {
      if (allowDelete) {
        const orphanIds = orphanProviders.map((p) => p.id);
        console.log(`  → deleting ${orphanIds.length} orphan providers (SEED_ALLOW_DELETE=true)`);
        await tx.delete(reviewsTable).where(inArray(reviewsTable.providerId, orphanIds));
        await tx.delete(bookingsTable).where(inArray(bookingsTable.providerId, orphanIds));
        await tx.delete(timeSlotsTable).where(inArray(timeSlotsTable.providerId, orphanIds));
        await tx.delete(servicesTable).where(inArray(servicesTable.providerId, orphanIds));
        await tx.delete(providersTable).where(inArray(providersTable.id, orphanIds));
      } else {
        console.warn(
          `  ! ${orphanProviders.length} providers reference slugs outside the catalog ` +
            `(${[...new Set(orphanProviders.map((p) => p.slug))].join(", ")}). ` +
            `NOT deleting — set SEED_ALLOW_DELETE=true to clean up.`,
        );
      }
    }

    console.log(`Seeding ${classification.worlds.length} worlds…`);
    for (let i = 0; i < classification.worlds.length; i++) {
      const w = classification.worlds[i]!;
      await tx
        .insert(worldsTable)
        .values({
          id: w.id,
          title: w.title,
          description: w.description ?? null,
          defaultPricingModel: w.default_pricing_model ?? "now",
          displayOrder: i,
        })
        .onConflictDoUpdate({
          target: worldsTable.id,
          set: {
            title: w.title,
            description: w.description ?? null,
            defaultPricingModel: w.default_pricing_model ?? "now",
            displayOrder: i,
          },
        });
    }

    console.log(`Seeding ${areaCount} areas…`);
    for (const w of classification.worlds) {
      for (let idx = 0; idx < w.areas.length; idx++) {
        const a = w.areas[idx]!;
        await tx
          .insert(areasTable)
          .values({
            id: a.id,
            worldId: w.id,
            code: a.code,
            num: a.num ?? null,
            name: a.name,
            description: a.description ?? null,
            displayOrder: idx,
          })
          .onConflictDoUpdate({
            target: areasTable.id,
            set: {
              worldId: w.id,
              code: a.code,
              num: a.num ?? null,
              name: a.name,
              description: a.description ?? null,
              displayOrder: idx,
            },
          });
      }
    }

    // Remove areas that are no longer part of the classification.
    const keepAreaIds = classification.worlds.flatMap((w) => w.areas.map((a) => a.id));
    const removedAreas = await tx
      .delete(areasTable)
      .where(notInArray(areasTable.id, keepAreaIds))
      .returning({ id: areasTable.id });
    if (removedAreas.length > 0) {
      console.log(
        `  → removed ${removedAreas.length} areas not in classification: ${removedAreas.map((a) => a.id).join(", ")}`,
      );
    }

    // Remove categories that are no longer part of the classification.
    const removedCats = await tx
      .delete(categoriesTable)
      .where(notInArray(categoriesTable.slug, keepSlugs))
      .returning({ slug: categoriesTable.slug });
    if (removedCats.length > 0) {
      console.log(`  → removed ${removedCats.length} categories not in classification`);
    }

    console.log(`Seeding ${categoryRows.length} categories…`);
    for (const r of categoryRows) {
      await tx
        .insert(categoriesTable)
        .values({
          name: r.name,
          slug: r.slug,
          icon: r.icon,
          description: r.description,
          color: r.color,
          colorLight: r.colorLight,
          displayOrder: r.displayOrder,
          requiresDirectBilling: r.requiresDirectBilling,
          qualifications: r.qualifications,
          worldId: r.worldId,
          areaId: r.areaId,
          professionCode: r.professionCode,
          pricingModel: r.pricingModel,
          indicativePrice: r.indicativePrice,
          priceUnit: r.priceUnit,
          exampleServices: r.exampleServices,
          requirements: r.requirements,
          leadPriceCents: r.leadPriceCents,
        })
        .onConflictDoUpdate({
          target: categoriesTable.slug,
          set: {
            name: r.name,
            icon: r.icon,
            description: r.description,
            color: r.color,
            colorLight: r.colorLight,
            displayOrder: r.displayOrder,
            requiresDirectBilling: r.requiresDirectBilling,
            qualifications: r.qualifications,
            worldId: r.worldId,
            areaId: r.areaId,
            professionCode: r.professionCode,
            pricingModel: r.pricingModel,
            indicativePrice: r.indicativePrice,
            priceUnit: r.priceUnit,
            exampleServices: r.exampleServices,
            requirements: r.requirements,
            leadPriceCents: r.leadPriceCents,
          },
        });
    }

    // Service templates exist only for the 8 v2 Bau-/Energie Berufsgruppen.
    console.log("Wiping and reseeding service_templates…");
    await tx.delete(serviceTemplatesTable);
    let total = 0;
    let sortCounter = 0;
    for (const b of catalog.branches) {
      const slug = SLUG_BY_BRANCH[b.id];
      if (!slug) {
        throw new Error(`No slug mapping for catalog branch '${b.id}'`);
      }
      for (const sc of b.service_categories) {
        for (const svc of sc.services) {
          await tx.insert(serviceTemplatesTable).values({
            categorySlug: slug,
            groupName: sc.name,
            name: svc.name,
            priceType: svc.price_type,
            referencePrice: buildReferencePrice(svc),
            durationLabel: svc.duration,
            defaultDurationMinutes: parseDuration(svc.duration),
            defaultPrice: svc.p_avg ?? svc.p_min ?? null,
            priceMin: svc.p_min ?? null,
            priceAvg: svc.p_avg ?? null,
            priceMax: svc.p_max ?? null,
            unit: svc.unit ?? null,
            inputs: svc.inputs ?? [],
            fundable: svc.fundable ?? null,
            notes: svc.notes ?? null,
            sortOrder: sortCounter++,
          });
          total++;
        }
      }
    }
    console.log(`  → inserted ${total} service templates`);

    await tx.execute(sql`
      UPDATE categories c
      SET provider_count = (
        SELECT COUNT(*) FROM providers p WHERE p.category_slug = c.slug
      )
    `);
  });

  // Keep the api-server boot snapshot in sync with what was just seeded, so
  // production (which never runs this script) picks up the same catalog.
  await writeClassificationSnapshot();

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
