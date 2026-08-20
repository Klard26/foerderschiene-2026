import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { financePartnersTable, financeLeadsTable } from "@workspace/db";
import { eq, and, desc, type SQL } from "drizzle-orm";
import { requireAdmin } from "../lib/adminAuth";

/**
 * Förder-Affiliate admin tooling — manage finance partners and the leads they
 * receive. Mounted under `/api/finance/...`.
 *
 * Security: these endpoints expose buyer PII (the contact details that were
 * lawfully shared with partners) and configure the partners that receive leads,
 * so the whole router is gated behind `requireAdmin` (fail-closed). Like the
 * Förderpilot Vorgangs-tooling, it is hand-written and intentionally NOT part of
 * the Orval/OpenAPI contract.
 *
 * Lead creation itself happens server-side in `lib/financeAffiliate.ts` off the
 * paid-report fulfillment path; these routes only read leads and advance their
 * status (converted / rejected). They never create or share a lead.
 */

const router: IRouter = Router();

// Scope the admin guard to this router's own `/finance` prefix. The router is
// mounted path-less, so a bare `router.use(requireAdmin)` would 401/403 every
// UNMATCHED request that falls through to it, blocking later routers. Prefix-
// scoping keeps the fail-closed gate while letting non-matching paths through.
router.use("/finance", requireAdmin);

const IdParam = z.object({ id: z.coerce.number().int().positive() });

const LEAD_STATUS = ["created", "sent", "converted", "rejected"] as const;

/* --------------------------- Finance partners --------------------------- */

const PartnerBody = z.object({
  name: z.string().min(1),
  contactEmail: z.string().email(),
  contactName: z.string().min(1).nullish(),
  productTypes: z.array(z.string().min(1)).default([]),
  regions: z.array(z.string().min(1)).default([]),
  postalPrefixes: z.array(z.string().min(1)).default([]),
  minInvestmentCents: z.number().int().nonnegative().nullish(),
  maxInvestmentCents: z.number().int().nonnegative().nullish(),
  feePerLeadCents: z.number().int().nonnegative().default(0),
  active: z.boolean().default(true),
  notes: z.string().nullish(),
});

const PartnerPatchBody = PartnerBody.partial();

/** GET /api/finance/partners — list all partners (newest first). */
router.get("/finance/partners", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(financePartnersTable)
      .orderBy(desc(financePartnersTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "finance partners list failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** POST /api/finance/partners — create a finance partner. */
router.post("/finance/partners", async (req, res): Promise<void> => {
  const b = PartnerBody.safeParse(req.body);
  if (!b.success) {
    res
      .status(400)
      .json({ error: "Ungültige Partnerdaten", details: b.error.issues });
    return;
  }
  const v = b.data;
  try {
    const [partner] = await db
      .insert(financePartnersTable)
      .values({
        name: v.name,
        contactEmail: v.contactEmail,
        contactName: v.contactName ?? null,
        productTypes: v.productTypes,
        regions: v.regions,
        postalPrefixes: v.postalPrefixes,
        minInvestmentCents: v.minInvestmentCents ?? null,
        maxInvestmentCents: v.maxInvestmentCents ?? null,
        feePerLeadCents: v.feePerLeadCents,
        active: v.active,
        notes: v.notes ?? null,
      })
      .returning();
    res.status(201).json(partner);
  } catch (err) {
    req.log.error({ err }, "finance partner create failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** PATCH /api/finance/partners/:id — update a finance partner. */
router.patch("/finance/partners/:id", async (req, res): Promise<void> => {
  const pid = IdParam.safeParse(req.params);
  if (!pid.success) {
    res.status(400).json({ error: "Ungültige Partner-ID" });
    return;
  }
  const b = PartnerPatchBody.safeParse(req.body);
  if (!b.success) {
    res
      .status(400)
      .json({ error: "Ungültige Partnerdaten", details: b.error.issues });
    return;
  }
  const v = b.data;
  const set: Partial<typeof financePartnersTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (v.name !== undefined) set.name = v.name;
  if (v.contactEmail !== undefined) set.contactEmail = v.contactEmail;
  if (v.contactName !== undefined) set.contactName = v.contactName ?? null;
  if (v.productTypes !== undefined) set.productTypes = v.productTypes;
  if (v.regions !== undefined) set.regions = v.regions;
  if (v.postalPrefixes !== undefined) set.postalPrefixes = v.postalPrefixes;
  if (v.minInvestmentCents !== undefined)
    set.minInvestmentCents = v.minInvestmentCents ?? null;
  if (v.maxInvestmentCents !== undefined)
    set.maxInvestmentCents = v.maxInvestmentCents ?? null;
  if (v.feePerLeadCents !== undefined) set.feePerLeadCents = v.feePerLeadCents;
  if (v.active !== undefined) set.active = v.active;
  if (v.notes !== undefined) set.notes = v.notes ?? null;

  try {
    const [partner] = await db
      .update(financePartnersTable)
      .set(set)
      .where(eq(financePartnersTable.id, pid.data.id))
      .returning();
    if (!partner) {
      res.status(404).json({ error: "Partner nicht gefunden" });
      return;
    }
    res.json(partner);
  } catch (err) {
    req.log.error({ err }, "finance partner update failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ----------------------------- Finance leads ---------------------------- */

/**
 * GET /api/finance/leads — list leads (optionally filtered by status/partner),
 * joined with their partner for display. Newest first.
 */
router.get("/finance/leads", async (req, res): Promise<void> => {
  const q = z
    .object({
      status: z.enum(LEAD_STATUS).optional(),
      partnerId: z.coerce.number().int().positive().optional(),
    })
    .safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: "Ungültige Filter" });
    return;
  }

  const conds: SQL[] = [];
  if (q.data.status) conds.push(eq(financeLeadsTable.status, q.data.status));
  if (q.data.partnerId)
    conds.push(eq(financeLeadsTable.partnerId, q.data.partnerId));

  try {
    const rows = await db
      .select({
        lead: financeLeadsTable,
        partnerName: financePartnersTable.name,
        partnerContactEmail: financePartnersTable.contactEmail,
      })
      .from(financeLeadsTable)
      .leftJoin(
        financePartnersTable,
        eq(financeLeadsTable.partnerId, financePartnersTable.id),
      )
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(financeLeadsTable.createdAt));
    res.json(
      rows.map((r) => ({
        ...r.lead,
        partnerName: r.partnerName,
        partnerContactEmail: r.partnerContactEmail,
      })),
    );
  } catch (err) {
    req.log.error({ err }, "finance leads list failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/finance/leads/:id/convert — mark a lead as converted (the partner
 * closed the financing). The snapshotted fee becomes billable revenue.
 */
router.post("/finance/leads/:id/convert", async (req, res): Promise<void> => {
  const pid = IdParam.safeParse(req.params);
  if (!pid.success) {
    res.status(400).json({ error: "Ungültige Lead-ID" });
    return;
  }
  try {
    const [lead] = await db
      .update(financeLeadsTable)
      .set({
        status: "converted",
        convertedAt: new Date(),
        rejectedAt: null,
        rejectionReason: null,
        updatedAt: new Date(),
      })
      .where(eq(financeLeadsTable.id, pid.data.id))
      .returning();
    if (!lead) {
      res.status(404).json({ error: "Lead nicht gefunden" });
      return;
    }
    res.json(lead);
  } catch (err) {
    req.log.error({ err }, "finance lead convert failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** POST /api/finance/leads/:id/reject — mark a lead as rejected (optional reason). */
router.post("/finance/leads/:id/reject", async (req, res): Promise<void> => {
  const pid = IdParam.safeParse(req.params);
  if (!pid.success) {
    res.status(400).json({ error: "Ungültige Lead-ID" });
    return;
  }
  const b = z
    .object({ reason: z.string().max(2000).nullish() })
    .safeParse(req.body ?? {});
  if (!b.success) {
    res.status(400).json({ error: "Ungültiger Grund" });
    return;
  }
  try {
    const [lead] = await db
      .update(financeLeadsTable)
      .set({
        status: "rejected",
        rejectedAt: new Date(),
        rejectionReason: b.data.reason ?? null,
        convertedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(financeLeadsTable.id, pid.data.id))
      .returning();
    if (!lead) {
      res.status(404).json({ error: "Lead nicht gefunden" });
      return;
    }
    res.json(lead);
  } catch (err) {
    req.log.error({ err }, "finance lead reject failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
