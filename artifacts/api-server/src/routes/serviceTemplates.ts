import { Router, type IRouter } from "express";
import { db, serviceTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/service-templates", async (req, res): Promise<void> => {
  try {
    const category = typeof req.query.category === "string" ? req.query.category : "";
    if (!category) {
      res.status(400).json({ error: "category query param required" });
      return;
    }
    const rows = await db
      .select()
      .from(serviceTemplatesTable)
      .where(eq(serviceTemplatesTable.categorySlug, category))
      .orderBy(serviceTemplatesTable.sortOrder);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list service templates");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
