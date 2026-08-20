import { Router, type IRouter } from "express";
import {
  db,
  verwalteteKundenTable,
  immobilienPortfolioObjekteTable,
} from "@workspace/db";
import {
  CreateVerwalteterKundeBody,
  UpdateVerwalteterKundeBody,
} from "@workspace/api-zod";
import { and, eq, desc } from "drizzle-orm";
import { getAuth } from "@clerk/express";

const router: IRouter = Router();

/**
 * Verwaltete/betreute Kunden CRUD for COMMERCIAL Förderschiene customers.
 * Strictly scoped to the authenticated Clerk userId (never from the body). When
 * a managed client links to a portfolio object, that object must belong to the
 * SAME user — cross-user links are rejected.
 */

type KundeBody =
  | typeof CreateVerwalteterKundeBody._type
  | typeof UpdateVerwalteterKundeBody._type;

function kundeColumns(d: KundeBody) {
  return {
    name: d.name,
    typ: d.typ ?? null,
    ansprechpartner: d.ansprechpartner ?? null,
    telefon: d.telefon ?? null,
    email: d.email ?? null,
    notiz: d.notiz ?? null,
    portfolioObjektId: d.portfolioObjektId ?? null,
  };
}

async function portfolioObjektBelongsToUser(
  id: number,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: immobilienPortfolioObjekteTable.id })
    .from(immobilienPortfolioObjekteTable)
    .where(
      and(
        eq(immobilienPortfolioObjekteTable.id, id),
        eq(immobilienPortfolioObjekteTable.userId, userId),
      ),
    )
    .limit(1);
  return !!row;
}

router.get("/verwaltete-kunden", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const rows = await db
      .select()
      .from(verwalteteKundenTable)
      .where(eq(verwalteteKundenTable.userId, userId))
      .orderBy(desc(verwalteteKundenTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list managed clients");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/verwaltete-kunden", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = CreateVerwalteterKundeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const cols = kundeColumns(parsed.data);
    if (
      cols.portfolioObjektId != null &&
      !(await portfolioObjektBelongsToUser(cols.portfolioObjektId, userId))
    ) {
      res.status(400).json({ error: "Verknüpftes Objekt nicht gefunden" });
      return;
    }
    const [row] = await db
      .insert(verwalteteKundenTable)
      .values({ userId, ...cols, updatedAt: new Date() })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create managed client");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/verwaltete-kunden/:id", async (req, res): Promise<void> => {
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
    const parsed = UpdateVerwalteterKundeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const cols = kundeColumns(parsed.data);
    if (
      cols.portfolioObjektId != null &&
      !(await portfolioObjektBelongsToUser(cols.portfolioObjektId, userId))
    ) {
      res.status(400).json({ error: "Verknüpftes Objekt nicht gefunden" });
      return;
    }
    const [row] = await db
      .update(verwalteteKundenTable)
      .set({ ...cols, updatedAt: new Date() })
      .where(
        and(
          eq(verwalteteKundenTable.id, id),
          eq(verwalteteKundenTable.userId, userId),
        ),
      )
      .returning();
    if (!row) {
      res.status(404).json({ error: "Kunde nicht gefunden" });
      return;
    }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update managed client");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/verwaltete-kunden/:id", async (req, res): Promise<void> => {
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
    const deleted = await db
      .delete(verwalteteKundenTable)
      .where(
        and(
          eq(verwalteteKundenTable.id, id),
          eq(verwalteteKundenTable.userId, userId),
        ),
      )
      .returning({ id: verwalteteKundenTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Kunde nicht gefunden" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete managed client");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
