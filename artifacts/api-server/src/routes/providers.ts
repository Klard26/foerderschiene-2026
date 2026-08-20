import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { providersTable, categoriesTable, icalBookingConflictsTable } from "@workspace/db";
import {
  CreateProviderBody,
  UpdateProviderBody,
  UpdateProviderParams,
  GetProviderParams,
  ListProvidersQueryParams,
} from "@workspace/api-zod";
import { eq, ilike, or, and, desc, inArray, type SQL, sql } from "drizzle-orm";
import { getAuth, clerkClient } from "@clerk/express";
import { randomBytes } from "node:crypto";
import { slugify } from "../lib/slugify";
import { sendProviderWelcome } from "../lib/email";
import { claimRole, RoleConflictError } from "../lib/userRole";
import {
  grantLeadCredits,
  LEAD_GRANT_SOURCES,
  ONE_TIME_PERIOD,
  BASIC_SIGNUP_LEADS,
} from "../lib/leadGrants";

const router: IRouter = Router();

async function getDirectBillingMap(): Promise<Record<string, boolean>> {
  const cats = await db.select({ slug: categoriesTable.slug, req: categoriesTable.requiresDirectBilling }).from(categoriesTable);
  const map: Record<string, boolean> = {};
  for (const c of cats) map[c.slug] = c.req ?? false;
  return map;
}

/**
 * Resolve a user-supplied category string to a real entry in `categories`.
 * Accepts either the canonical slug or the display name. Returns null if no
 * matching category exists, so the caller can respond with a 400 instead of
 * silently writing an orphan slug into the providers table.
 */
type ResolvedCategory = {
  name: string;
  slug: string;
  qualifications: QualificationsConfig | null;
};

async function resolveCategory(input: string): Promise<ResolvedCategory | null> {
  const candidate = slugify(input);
  const cols = {
    name: categoriesTable.name,
    slug: categoriesTable.slug,
    qualifications: categoriesTable.qualifications,
  };
  const [bySlug] = await db.select(cols).from(categoriesTable).where(eq(categoriesTable.slug, candidate)).limit(1);
  if (bySlug) return bySlug as ResolvedCategory;

  const [byName] = await db.select(cols).from(categoriesTable).where(eq(categoriesTable.name, input)).limit(1);
  return (byName as ResolvedCategory | undefined) ?? null;
}

interface QualificationsConfig {
  notes?: string;
  dena_required?: boolean;
  dena_categories?: string[];
  dena_programs?: string[];
  kammer_required?: boolean;
  kammer_type?: string;
  bauvorlage_required?: boolean;
  oebvi_optional?: boolean;
  zertifizierung_required?: boolean;
  options?: string[];
  specialties?: string[];
  fachbereiche?: string[];
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isStringArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const isYearString = (v: unknown): boolean => {
  if (typeof v !== "string" && typeof v !== "number") return false;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1950 && n <= new Date().getFullYear();
};

/**
 * Compute the set of qualification keys that the given category config legitimately
 * accepts. Anything outside this set is treated as cross-category contamination and
 * rejected to prevent stale fields from previous categories slipping into the JSON.
 */
function allowedKeysForConfig(config: QualificationsConfig): Set<string> {
  const keys = new Set<string>();
  if (config.dena_required) {
    keys.add("dena_id");
    keys.add("dena_since");
    if (config.dena_categories) keys.add("dena_categories");
    if (config.dena_programs) keys.add("dena_programs");
  }
  if (config.kammer_required) {
    keys.add("kammer_state");
    keys.add("kammer_id");
  }
  if (config.bauvorlage_required) keys.add("bauvorlage");
  if (config.oebvi_optional) {
    keys.add("is_oebvi");
    keys.add("oebvi_state");
    keys.add("oebvi_id");
  }
  if (config.zertifizierung_required) keys.add("zertifizierung");
  if (config.specialties) keys.add("specialties");
  if (config.fachbereiche) keys.add("fachbereiche");
  return keys;
}

/**
 * Validate and normalize qualifications JSON against the category's qualification config.
 * - filters keys to only those legitimate for the given category (no contamination).
 * - validates types of every accepted field (not just the required ones).
 * - returns { ok: false, error } when required fields are missing or any field is malformed.
 */
function validateQualifications(
  config: QualificationsConfig | null,
  raw: unknown,
): { ok: true; data: Record<string, unknown> | null } | { ok: false; error: string } {
  if (raw == null) {
    if (!config) return { ok: true, data: null };
    if (config.dena_required) return { ok: false, error: "Qualifikationen erforderlich (dena-Eintragung)" };
    if (config.kammer_required) return { ok: false, error: "Qualifikationen erforderlich (Kammer-Mitgliedschaft)" };
    if (config.zertifizierung_required) return { ok: false, error: "Qualifikationen erforderlich (Zertifizierung)" };
    return { ok: true, data: null };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "qualifications muss ein Objekt sein" };
  }
  if (!config) {
    // No qualification config for this category → reject any payload to avoid orphan data.
    return { ok: false, error: "Diese Branche akzeptiert keine Qualifikationen" };
  }

  const input = raw as Record<string, unknown>;
  const allowed = allowedKeysForConfig(config);
  const out: Record<string, unknown> = {};

  // Drop unknown/empty keys silently; reject if any non-empty unknown key is supplied.
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null || v === "") continue;
    if (!allowed.has(k)) {
      return { ok: false, error: `Feld '${k}' ist für diese Branche nicht zulässig` };
    }
    out[k] = v;
  }

  // Per-key type validation
  if (out.dena_id !== undefined && !isNonEmptyString(out.dena_id)) {
    return { ok: false, error: "dena_id muss ein Text sein" };
  }
  if (out.dena_since !== undefined && !isYearString(out.dena_since)) {
    return { ok: false, error: "dena_since muss ein gültiges Jahr sein" };
  }
  if (out.kammer_state !== undefined && !isNonEmptyString(out.kammer_state)) {
    return { ok: false, error: "kammer_state muss ein Text sein" };
  }
  if (out.kammer_id !== undefined && !isNonEmptyString(out.kammer_id)) {
    return { ok: false, error: "kammer_id muss ein Text sein" };
  }
  if (out.bauvorlage !== undefined && typeof out.bauvorlage !== "boolean") {
    return { ok: false, error: "bauvorlage muss true oder false sein" };
  }
  if (out.is_oebvi !== undefined && typeof out.is_oebvi !== "boolean") {
    return { ok: false, error: "is_oebvi muss true oder false sein" };
  }
  if (out.oebvi_state !== undefined && !isNonEmptyString(out.oebvi_state)) {
    return { ok: false, error: "oebvi_state muss ein Text sein" };
  }
  if (out.oebvi_id !== undefined && !isNonEmptyString(out.oebvi_id)) {
    return { ok: false, error: "oebvi_id muss ein Text sein" };
  }

  // Required-field enforcement
  if (config.dena_required && !isNonEmptyString(out.dena_id)) {
    return { ok: false, error: "dena-Kundennummer ist erforderlich" };
  }
  if (config.kammer_required) {
    if (!isNonEmptyString(out.kammer_state)) return { ok: false, error: "Kammer-Bundesland ist erforderlich" };
    if (!isNonEmptyString(out.kammer_id)) return { ok: false, error: "Kammer-Mitgliedsnummer ist erforderlich" };
  }
  if (config.bauvorlage_required && out.bauvorlage !== true) {
    return { ok: false, error: "Bauvorlageberechtigung muss bestätigt werden" };
  }
  if (config.zertifizierung_required) {
    if (!isStringArr(out.zertifizierung) || out.zertifizierung.length === 0) {
      return { ok: false, error: "Mindestens eine Anerkennung muss ausgewählt werden" };
    }
    if (!config.options || !out.zertifizierung.every((z) => config.options!.includes(z))) {
      return { ok: false, error: "Ungültige Anerkennung" };
    }
  }

  // Enum array fields must always be string[] AND all values must come from the allowed list.
  const enumChecks: Array<[string, string[] | undefined]> = [
    ["dena_categories", config.dena_categories],
    ["dena_programs", config.dena_programs],
    ["specialties", config.specialties],
    ["fachbereiche", config.fachbereiche],
  ];
  for (const [key, allowedValues] of enumChecks) {
    const v = out[key];
    if (v === undefined) continue;
    if (!isStringArr(v)) return { ok: false, error: `Feld ${key} muss eine Liste sein` };
    if (!allowedValues || !v.every((x) => allowedValues.includes(x))) {
      return { ok: false, error: `Ungültiger Wert in ${key}` };
    }
  }

  return { ok: true, data: Object.keys(out).length > 0 ? out : null };
}

function withDirectBilling<T extends { categorySlug?: string | null }>(p: T, map: Record<string, boolean>): T & { requiresDirectBilling: boolean } {
  return { ...p, requiresDirectBilling: !!(p.categorySlug && map[p.categorySlug]) };
}

router.get("/providers", async (req, res): Promise<void> => {
  try {
    const parsed = ListProvidersQueryParams.safeParse(req.query);
    const q = parsed.success ? parsed.data : {};

    const conditions: SQL[] = [];
    // Only approved providers are visible in the public marketplace.
    conditions.push(eq(providersTable.approvalStatus, "approved"));
    if (q.zip) conditions.push(eq(providersTable.zip, q.zip));
    if (q.city) conditions.push(ilike(providersTable.city, `%${q.city}%`));
    if (q.category) conditions.push(eq(providersTable.categorySlug, q.category));
    if (q.area) {
      // Resolve a classification Bereich to all of its profession slugs.
      const areaSlugs = await db
        .select({ slug: categoriesTable.slug })
        .from(categoriesTable)
        .where(eq(categoriesTable.areaId, q.area));
      // Empty IN () matches nothing — a bogus area yields zero providers.
      conditions.push(inArray(providersTable.categorySlug, areaSlugs.map((c) => c.slug)));
    }
    if (q.q) {
      conditions.push(
        or(
          ilike(providersTable.displayName, `%${q.q}%`),
          ilike(providersTable.bio, `%${q.q}%`),
        ) as SQL,
      );
    }

    const limit = q.limit ?? 20;
    const offset = q.offset ?? 0;

    // Premium-first ranking: premium providers ahead of basic, then by rating desc, then by reviewCount desc.
    const providers = await db
      .select()
      .from(providersTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .limit(limit)
      .offset(offset)
      .orderBy(
        sql`CASE WHEN ${providersTable.subscriptionTier} = 'premium' THEN 0 ELSE 1 END`,
        desc(providersTable.rating),
        desc(providersTable.reviewCount),
      );

    const map = await getDirectBillingMap();
    res.json(providers.map(p => withDirectBilling(p, map)));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch providers");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/providers/me", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const [provider] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.clerkUserId, userId))
      .limit(1);

    if (!provider) {
      res.status(404).json({ error: "Provider profile not found" });
      return;
    }
    const map = await getDirectBillingMap();
    res.json(withDirectBilling(provider, map));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch own provider profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/providers/me/ical-conflicts", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const [provider] = await db
      .select({ id: providersTable.id })
      .from(providersTable)
      .where(eq(providersTable.clerkUserId, userId))
      .limit(1);
    if (!provider) {
      res.status(404).json({ error: "Provider profile not found" });
      return;
    }
    const conflicts = await db
      .select()
      .from(icalBookingConflictsTable)
      .where(eq(icalBookingConflictsTable.providerId, provider.id))
      .orderBy(icalBookingConflictsTable.bookingScheduledAt);
    res.json(conflicts);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch iCal booking conflicts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/providers/:id", async (req, res): Promise<void> => {
  try {
    const parsed = GetProviderParams.safeParse({ id: Number(req.params.id) });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [provider] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.id, parsed.data.id))
      .limit(1);

    // Non-approved profiles are not publicly visible (hard 404). The owner
    // sees their own status via /providers/me; admins use /admin/providers.
    if (!provider || provider.approvalStatus !== "approved") {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    const map = await getDirectBillingMap();
    res.json(withDirectBilling(provider, map));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch provider");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/providers", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      await claimRole(userId, "provider");
    } catch (err) {
      if (err instanceof RoleConflictError) {
        res.status(403).json({
          error: "Dieses Konto ist ein Kunden-Konto und kann kein Berater-Profil anlegen.",
        });
        return;
      }
      throw err;
    }
    const parsed = CreateProviderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    const category = await resolveCategory(d.category);
    if (!category) {
      res.status(400).json({ error: `Unbekannte Branche: ${d.category}` });
      return;
    }
    const qualCheck = validateQualifications(category.qualifications, d.qualifications ?? null);
    if (!qualCheck.ok) {
      res.status(400).json({ error: qualCheck.error });
      return;
    }
    const cleanQualifications = qualCheck.data;

    const [existing] = await db
      .select({ id: providersTable.id })
      .from(providersTable)
      .where(eq(providersTable.clerkUserId, userId))
      .limit(1);
    if (existing) {
      res.status(409).json({
        error: "Sie haben bereits ein Berater-Profil. Bearbeiten Sie es in Ihrem Dashboard.",
      });
      return;
    }

    let email = "";
    try {
      const u = await clerkClient.users.getUser(userId);
      email = u.primaryEmailAddress?.emailAddress ?? "";
    } catch {
      // ignore
    }
    const [provider] = await db
      .insert(providersTable)
      .values({
        clerkUserId: userId,
        displayName: d.displayName,
        email,
        bio: d.bio,
        category: category.name,
        categorySlug: category.slug,
        city: d.city,
        zip: d.zip,
        address: d.address,
        phone: d.phone,
        website: d.website,
        logoUrl: d.logoUrl,
        yearsExperience: d.yearsExperience,
        companyLegalName: d.companyLegalName,
        taxId: d.taxId,
        responseTime: d.responseTime,
        consultationMode: d.consultationMode ?? "both",
        certificates: d.certificates ?? [],
        qualifications: cleanQualifications,
        bafaNummer: d.bafaNummer,
        kapazitaetStundenProWoche: d.kapazitaetStundenProWoche,
        icalToken: randomBytes(24).toString("hex"),
        // New profiles require admin approval (Freigabe) before going live.
        approvalStatus: "pending",
      })
      .returning();

    if (provider) {
      // Welcome bonus: 2 free leads (never expire). Idempotent + best-effort, so
      // a grant hiccup never fails provider creation.
      try {
        await grantLeadCredits(db, {
          providerId: provider.id,
          source: LEAD_GRANT_SOURCES.basicSignup,
          periodMonth: ONE_TIME_PERIOD,
          count: BASIC_SIGNUP_LEADS,
          expiresAt: null,
        });
      } catch (err) {
        req.log.error({ err, providerId: provider.id }, "Basic free-lead grant failed");
      }
      if (email) {
        void sendProviderWelcome({ email, displayName: provider.displayName });
      }
    }

    res.status(201).json(provider);
  } catch (err) {
    // Race: two concurrent submits for the same Clerk user hit the unique
    // constraint. Surface it as a clean conflict rather than a 500.
    if (
      err &&
      typeof err === "object" &&
      "cause" in err &&
      (err as { cause?: { code?: string } }).cause?.code === "23505"
    ) {
      res.status(409).json({
        error: "Sie haben bereits ein Berater-Profil. Bearbeiten Sie es in Ihrem Dashboard.",
      });
      return;
    }
    req.log.error({ err }, "Failed to create provider");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/providers/:id", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const paramsParsed = UpdateProviderParams.safeParse({ id: Number(req.params.id) });
    if (!paramsParsed.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [existing] = await db
      .select({
        id: providersTable.id,
        clerkUserId: providersTable.clerkUserId,
        categorySlug: providersTable.categorySlug,
        qualifications: providersTable.qualifications,
        approvalStatus: providersTable.approvalStatus,
      })
      .from(providersTable)
      .where(eq(providersTable.id, paramsParsed.data.id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    if (existing.clerkUserId !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const bodyParsed = UpdateProviderBody.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: bodyParsed.error.message });
      return;
    }
    const d = bodyParsed.data;
    const updateData: Record<string, unknown> = {};
    if (d.displayName !== undefined) updateData.displayName = d.displayName;
    if (d.bio !== undefined) updateData.bio = d.bio;

    // Determine effective category config for qualifications validation:
    // - If category is changing, use the new category's config.
    // - If only qualifications are changing, use the existing category's config.
    let effectiveQualConfig: QualificationsConfig | null = null;
    let resolvedNewCategory: ResolvedCategory | null = null;
    if (d.category !== undefined) {
      resolvedNewCategory = await resolveCategory(d.category);
      if (!resolvedNewCategory) {
        res.status(400).json({ error: `Unbekannte Branche: ${d.category}` });
        return;
      }
      updateData.category = resolvedNewCategory.name;
      updateData.categorySlug = resolvedNewCategory.slug;
      effectiveQualConfig = resolvedNewCategory.qualifications;
    } else if (d.qualifications !== undefined && existing.categorySlug) {
      const cur = await resolveCategory(existing.categorySlug);
      if (!cur) {
        res.status(409).json({ error: "Aktuelle Branche des Profils konnte nicht aufgelöst werden" });
        return;
      }
      effectiveQualConfig = cur.qualifications;
    }

    if (d.qualifications !== undefined || d.category !== undefined) {
      // When category changes, drop any prior qualifications client did not re-supply
      // (prevents cross-category contamination); when only quals change, validate the new payload.
      const incoming = d.qualifications !== undefined
        ? d.qualifications
        : (d.category !== undefined ? null : existing.qualifications);
      const qualCheck = validateQualifications(effectiveQualConfig, incoming);
      if (!qualCheck.ok) {
        res.status(400).json({ error: qualCheck.error });
        return;
      }
      updateData.qualifications = qualCheck.data;
    }
    if (d.city !== undefined) updateData.city = d.city;
    if (d.zip !== undefined) updateData.zip = d.zip;
    if (d.address !== undefined) updateData.address = d.address;
    if (d.phone !== undefined) updateData.phone = d.phone;
    if (d.website !== undefined) updateData.website = d.website;
    if (d.avatarUrl !== undefined) updateData.avatarUrl = d.avatarUrl;
    if (d.logoUrl !== undefined) updateData.logoUrl = d.logoUrl;
    if (d.yearsExperience !== undefined) updateData.yearsExperience = d.yearsExperience;
    if (d.companyLegalName !== undefined) updateData.companyLegalName = d.companyLegalName;
    if (d.taxId !== undefined) updateData.taxId = d.taxId;
    if (d.responseTime !== undefined) updateData.responseTime = d.responseTime;
    if (d.consultationMode !== undefined) updateData.consultationMode = d.consultationMode;
    if (d.certificates !== undefined) updateData.certificates = d.certificates;
    if (d.bafaNummer !== undefined) updateData.bafaNummer = d.bafaNummer || null;
    if (d.kapazitaetStundenProWoche !== undefined)
      updateData.kapazitaetStundenProWoche = d.kapazitaetStundenProWoche ?? null;
    if (d.externalIcalUrl !== undefined)
      updateData.externalIcalUrl = d.externalIcalUrl || null;

    // A rejected provider editing their profile re-enters the approval queue
    // (matches the Dashboard hint that changes are reviewed again). Approved
    // profiles stay live; edits never un-publish an approved Berater.
    if (existing.approvalStatus === "rejected") {
      updateData.approvalStatus = "pending";
      updateData.rejectionReason = null;
      updateData.reviewedAt = null;
    }

    const [updated] = await db
      .update(providersTable)
      .set(updateData)
      .where(eq(providersTable.id, paramsParsed.data.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update provider");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
