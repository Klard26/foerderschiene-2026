import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { worldsTable, areasTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/classification", async (req, res): Promise<void> => {
  try {
    const [worlds, areas] = await Promise.all([
      db.select().from(worldsTable).orderBy(worldsTable.displayOrder),
      db.select().from(areasTable).orderBy(areasTable.displayOrder),
    ]);
    res.json({ worlds, areas });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch classification");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
