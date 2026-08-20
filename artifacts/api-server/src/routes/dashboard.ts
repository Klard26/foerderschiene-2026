import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { bookingsTable, reviewsTable, providersTable, categoriesTable } from "@workspace/db";
import { GetProviderDashboardParams } from "@workspace/api-zod";
import { eq, count, sum, avg } from "drizzle-orm";

const router: IRouter = Router();

router.get("/dashboard/provider/:id", async (req, res): Promise<void> => {
  try {
    const parsed = GetProviderDashboardParams.safeParse({ id: Number(req.params.id) });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const providerId = parsed.data.id;

    const allBookings = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.providerId, providerId))
      .orderBy(bookingsTable.scheduledAt);

    const pending = allBookings.filter((b) => b.status === "pending").length;
    const confirmed = allBookings.filter((b) => b.status === "confirmed").length;
    const completed = allBookings.filter((b) => b.status === "completed").length;
    const totalRevenue = allBookings
      .filter((b) => b.status === "completed")
      .reduce((sum, b) => sum + b.totalPrice, 0);

    const reviewResult = await db
      .select({ avgRating: avg(reviewsTable.rating) })
      .from(reviewsTable)
      .where(eq(reviewsTable.providerId, providerId));

    const recentBookings = allBookings.slice(-5).reverse();

    res.json({
      totalBookings: allBookings.length,
      pendingBookings: pending,
      confirmedBookings: confirmed,
      completedBookings: completed,
      totalRevenue,
      averageRating: parseFloat(reviewResult[0]?.avgRating ?? "0"),
      recentBookings,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch provider dashboard");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/stats", async (req, res): Promise<void> => {
  try {
    const [providerCount] = await db.select({ count: count() }).from(providersTable);
    const [bookingCount] = await db.select({ count: count() }).from(bookingsTable);
    const [categoryCount] = await db.select({ count: count() }).from(categoriesTable);
    const [reviewCount] = await db.select({ count: count() }).from(reviewsTable);

    res.json({
      totalProviders: providerCount?.count ?? 0,
      totalBookings: bookingCount?.count ?? 0,
      totalCategories: categoryCount?.count ?? 0,
      totalReviews: reviewCount?.count ?? 0,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch platform stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
