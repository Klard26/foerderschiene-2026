import { Router, type IRouter } from "express";
import {
  db,
  immobilienPortfolioObjekteTable,
  verwalteteKundenTable,
} from "@workspace/db";
import {
  CreateImmobilienPortfolioObjektBody,
  UpdateImmobilienPortfolioObjektBody,
} from "@workspace/api-zod";
import { and, eq, desc } from "drizzle-orm";
import { getAuth } from "@clerk/express";

const router: IRouter = Router();

/**
 * Immobilienportfolio CRUD for COMMERCIAL Förderschiene customers. Every
 * endpoint is strictly scoped to the authenticated Clerk userId: the userId is
 * NEVER read from the request body, and every read/update/delete is filtered by
 * both the row id AND the owner userId to prevent IDOR/PII leakage.
 */

type ObjektBody =
  | typeof CreateImmobilienPortfolioObjektBody._type
  | typeof UpdateImmobilienPortfolioObjektBody._type;

function objektColumns(d: ObjektBody) {
  return {
    bezeichnung: d.bezeichnung,
    strasse: d.strasse ?? null,
    hausnummer: d.hausnummer ?? null,
    plz: d.plz ?? null,
    ort: d.ort ?? null,
    gebaeudetyp: d.gebaeudetyp ?? null,
    baujahr: d.baujahr ?? null,
    wohnflaeche: d.wohnflaeche ?? null,
    wohneinheiten: d.wohneinheiten ?? null,
    heizung: d.heizung ?? null,
    notiz: d.notiz ?? null,
  };
}

router.get("/immobilien-portfolio/objekte", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const rows = await db
      .select()
      .from(immobilienPortfolioObjekteTable)
      .where(eq(immobilienPortfolioObjekteTable.userId, userId))
      .orderBy(desc(immobilienPortfolioObjekteTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list portfolio objects");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/immobilien-portfolio/objekte", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = CreateImmobilienPortfolioObjektBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [row] = await db
      .insert(immobilienPortfolioObjekteTable)
      .values({ userId, ...objektColumns(parsed.data), updatedAt: new Date() })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create portfolio object");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/immobilien-portfolio/objekte/:id", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Ungültige ID" });
      return;
    }
    const parsed = UpdateImmobilienPortfolioObjektBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [row] = await db
      .update(immobilienPortfolioObjekteTable)
      .set({ ...objektColumns(parsed.data), updatedAt: new Date() })
      .where(
        and(
          eq(immobilienPortfolioObjekteTable.id, id),
          eq(immobilienPortfolioObjekteTable.userId, userId),
        ),
      )
      .returning();
    if (!row) {
      res.status(404).json({ error: "Objekt nicht gefunden" });
      return;
    }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update portfolio object");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/immobilien-portfolio/objekte/:id", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Ungültige ID" });
      return;
    }
    let deletedCount = 0;
    await db.transaction(async (tx) => {
      // Detach this user's managed clients that referenced the object so the
      // foreign reference never dangles (link column is nullable by design).
      await tx
        .update(verwalteteKundenTable)
        .set({ portfolioObjektId: null, updatedAt: new Date() })
        .where(
          and(
            eq(verwalteteKundenTable.userId, userId),
            eq(verwalteteKundenTable.portfolioObjektId, id),
          ),
        );
      const deleted = await tx
        .delete(immobilienPortfolioObjekteTable)
        .where(
          and(
            eq(immobilienPortfolioObjekteTable.id, id),
            eq(immobilienPortfolioObjekteTable.userId, userId),
          ),
        )
        .returning({ id: immobilienPortfolioObjekteTable.id });
      deletedCount = deleted.length;
    });
    if (deletedCount === 0) {
      res.status(404).json({ error: "Objekt nicht gefunden" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete portfolio object");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
