import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { timeSlotsTable, blockedSlotsTable } from "@workspace/db";
import {
  ListAvailabilityParams,
  CreateTimeSlotBody,
  DeleteTimeSlotQueryParams,
} from "@workspace/api-zod";
import { eq, and } from "drizzle-orm";
import { canViewProvider } from "../lib/providerVisibility";

const router: IRouter = Router();

router.get("/providers/:id/availability", async (req, res): Promise<void> => {
  try {
    const parsed = ListAvailabilityParams.safeParse({ id: Number(req.params.id) });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    if (!(await canViewProvider(req, parsed.data.id))) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    const providerId = parsed.data.id;
    const [slots, blocked] = await Promise.all([
      db
        .select()
        .from(timeSlotsTable)
        .where(
          and(
            eq(timeSlotsTable.providerId, providerId),
            eq(timeSlotsTable.isAvailable, true),
          ),
        )
        .orderBy(timeSlotsTable.startTime),
      db
        .select({
          startTime: blockedSlotsTable.startTime,
          endTime: blockedSlotsTable.endTime,
        })
        .from(blockedSlotsTable)
        .where(eq(blockedSlotsTable.providerId, providerId)),
    ]);

    // Hide any open slot that overlaps an external-calendar busy interval.
    // Overlap: slot.start < blocked.end && slot.end > blocked.start.
    const visible = slots.filter(
      (s) =>
        !blocked.some(
          (b) => s.startTime < b.endTime && s.endTime > b.startTime,
        ),
    );
    res.json(visible);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch availability");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/availability", async (req, res): Promise<void> => {
  try {
    const parsed = CreateTimeSlotBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    const [slot] = await db
      .insert(timeSlotsTable)
      .values({
        providerId: d.providerId,
        startTime: new Date(d.startTime),
        endTime: new Date(d.endTime),
        isAvailable: true,
      })
      .returning();
    res.status(201).json(slot);
  } catch (err) {
    req.log.error({ err }, "Failed to create time slot");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/availability", async (req, res): Promise<void> => {
  try {
    const parsed = DeleteTimeSlotQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid slotId" });
      return;
    }
    await db.delete(timeSlotsTable).where(eq(timeSlotsTable.id, parsed.data.slotId));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete time slot");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
