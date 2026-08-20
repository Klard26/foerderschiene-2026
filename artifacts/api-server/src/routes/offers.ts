import { Router, type IRouter } from "express";
import { db, offerAcceptancesTable, providersTable, servicesTable } from "@workspace/db";
import { AcceptOfferBody } from "@workspace/api-zod";
import { eq, desc, and, inArray } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { recomputeOfferPricing } from "../lib/offerPricing";

const router: IRouter = Router();

router.post("/offers/accept", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = AcceptOfferBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;

    const [provider] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.id, d.providerId))
      .limit(1);
    if (!provider || provider.approvalStatus !== "approved") {
      res.status(404).json({ error: "Berater nicht gefunden." });
      return;
    }

    // Server-authoritative pricing: client-supplied prices are ignored. Each item
    // must reference a serviceId belonging to this provider; net/USt/brutto totals
    // are recomputed from the current catalog so the binding offer cannot be tampered.
    const serviceIds = d.items.map((it) => it.serviceId).filter((id): id is number => id != null);
    const dbServices = serviceIds.length
      ? await db
          .select()
          .from(servicesTable)
          .where(and(eq(servicesTable.providerId, d.providerId), inArray(servicesTable.id, serviceIds)))
      : [];

    const pricing = recomputeOfferPricing(d.items, dbServices);
    if (!pricing.ok) {
      res.status(400).json({
        error:
          pricing.error === "INVALID_ITEMS"
            ? "Jede Position muss eine gültige Leistung referenzieren."
            : "Eine ausgewählte Leistung gehört nicht zu diesem Berater.",
      });
      return;
    }
    const { items, totalNet, totalGross } = pricing.value;

    const [row] = await db
      .insert(offerAcceptancesTable)
      .values({
        userId,
        providerId: d.providerId,
        inquiry: d.inquiry ?? null,
        offerText: d.offerText ?? null,
        itemsJson: items,
        totalNet,
        totalGross,
        agbVersion: d.agbVersion,
        status: "accepted",
      })
      .returning();

    res.status(201).json({ ...row, items: row?.itemsJson });
  } catch (err) {
    req.log.error({ err }, "Failed to accept offer");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/offers/mine", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const rows = await db
      .select()
      .from(offerAcceptancesTable)
      .where(eq(offerAcceptancesTable.userId, userId))
      .orderBy(desc(offerAcceptancesTable.createdAt));
    res.json(rows.map((r) => ({ ...r, items: r.itemsJson })));
  } catch (err) {
    req.log.error({ err }, "Failed to list offers");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
