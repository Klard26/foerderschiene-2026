import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { reviewsTable, bookingsTable, providersTable } from "@workspace/db";
import {
  CreateReviewBody,
  ListProviderReviewsParams,
} from "@workspace/api-zod";
import { eq, avg } from "drizzle-orm";
import { getAuth, clerkClient } from "@clerk/express";
import { canViewProvider } from "../lib/providerVisibility";

const router: IRouter = Router();

router.get("/providers/:id/reviews", async (req, res): Promise<void> => {
  try {
    const parsed = ListProviderReviewsParams.safeParse({ id: Number(req.params.id) });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    if (!(await canViewProvider(req, parsed.data.id))) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    const reviews = await db
      .select()
      .from(reviewsTable)
      .where(eq(reviewsTable.providerId, parsed.data.id))
      .orderBy(reviewsTable.createdAt);
    res.json(reviews);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch reviews");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/reviews", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = CreateReviewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;

    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, d.bookingId))
      .limit(1);

    if (!booking) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }

    // Verified-only reviews: must be the customer who booked, and the booking
    // must be completed (or at least past + confirmed).
    if (booking.customerId !== userId) {
      res.status(403).json({ error: "Sie können nur eigene Buchungen bewerten." });
      return;
    }
    const allowedStatuses = new Set(["completed", "confirmed"]);
    const isPast = booking.scheduledAt && new Date(booking.scheduledAt).getTime() < Date.now();
    if (!allowedStatuses.has(booking.status) || !isPast) {
      res.status(400).json({
        error: "Bewertungen sind nur nach einem stattgefundenen Termin möglich.",
      });
      return;
    }

    // Block duplicate reviews per booking.
    const [existing] = await db
      .select()
      .from(reviewsTable)
      .where(eq(reviewsTable.bookingId, d.bookingId))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "Für diese Buchung existiert bereits eine Bewertung." });
      return;
    }

    let customerName: string | null = booking.customerName ?? null;
    if (!customerName) {
      try {
        const u = await clerkClient.users.getUser(userId);
        customerName =
          [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || null;
      } catch {
        // ignore
      }
    }

    const [review] = await db
      .insert(reviewsTable)
      .values({
        bookingId: d.bookingId,
        customerId: userId,
        customerName,
        providerId: booking.providerId,
        rating: d.rating,
        comment: d.comment,
      })
      .returning();

    const ratingResult = await db
      .select({ avgRating: avg(reviewsTable.rating) })
      .from(reviewsTable)
      .where(eq(reviewsTable.providerId, booking.providerId));

    const newRating = parseFloat(ratingResult[0]?.avgRating ?? "0");
    const countResult = await db
      .select()
      .from(reviewsTable)
      .where(eq(reviewsTable.providerId, booking.providerId));

    await db
      .update(providersTable)
      .set({
        rating: newRating,
        reviewCount: countResult.length,
      })
      .where(eq(providersTable.id, booking.providerId));

    res.status(201).json(review);
  } catch (err) {
    req.log.error({ err }, "Failed to create review");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
