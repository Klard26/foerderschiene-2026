import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  foerderLeadsTable,
  foerderUpdateLogTable,
  bookingsTable,
  providersTable,
  categoriesTable,
  reviewsTable,
  invoicesTable,
  emailLogTable,
  foerderschieneReportsTable,
  energieausweisOrdersTable,
  gebaeudecheckOrdersTable,
} from "@workspace/db";
import { getAuth } from "@clerk/express";
import { sql, desc, eq, and, gte } from "drizzle-orm";
import { UpdateAdminProviderApprovalBody } from "@workspace/api-zod";
import { requireAdmin, isAdminUserId } from "../lib/adminAuth";
import { isResendConfigured } from "../lib/resendClient";
import {
  sendProviderWelcome,
  checkEmailDeliveryHealth,
  CRITICAL_TRANSACTIONAL_EMAIL_TEMPLATE_IDS,
} from "../lib/email";
import { runFoerderUpdate } from "../lib/foerderUpdate";

const router: IRouter = Router();

/**
 * Shared column selection + row mapping for the admin provider rows, used by
 * both the list endpoint and the approve/reject mutation so the response shape
 * (AdminProviderRow) stays in lockstep.
 */
const adminProviderColumns = {
  id: providersTable.id,
  displayName: providersTable.displayName,
  email: providersTable.email,
  category: providersTable.category,
  categorySlug: providersTable.categorySlug,
  city: providersTable.city,
  subscriptionTier: providersTable.subscriptionTier,
  verified: providersTable.verified,
  approvalStatus: providersTable.approvalStatus,
  rejectionReason: providersTable.rejectionReason,
  reviewedAt: providersTable.reviewedAt,
  rating: providersTable.rating,
  reviewCount: providersTable.reviewCount,
  createdAt: providersTable.createdAt,
  bookingCount: sql<number>`(
    select count(*)::int from ${bookingsTable}
    where ${bookingsTable.providerId} = ${providersTable.id}
  )`,
  paidRevenueCents: sql<number>`(
    select coalesce(sum(${bookingsTable.totalPrice} * 100), 0)::bigint from ${bookingsTable}
    where ${bookingsTable.providerId} = ${providersTable.id}
      and ${bookingsTable.paymentStatus} = 'paid'
  )`,
  distinctCustomers: sql<number>`(
    select count(distinct ${bookingsTable.customerId})::int from ${bookingsTable}
    where ${bookingsTable.providerId} = ${providersTable.id}
  )`,
};

function mapAdminProviderRow<
  T extends { createdAt: Date; reviewedAt: Date | null; paidRevenueCents: number },
>(r: T) {
  return {
    ...r,
    createdAt: r.createdAt.toISOString(),
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    paidRevenueCents: Number(r.paidRevenueCents),
  };
}

/**
 * Lightweight introspection so the frontend can conditionally show the
 * "Admin" menu item without leaking the allowlist.
 */
router.get("/admin/me", (req, res): void => {
  const { userId } = getAuth(req);
  res.json({ isAdmin: isAdminUserId(userId) });
});

router.get("/admin/stats", requireAdmin, async (req, res): Promise<void> => {
  try {
    // Booking counts by status + revenue
    const bookingAgg = await db
      .select({
        status: bookingsTable.status,
        paymentStatus: bookingsTable.paymentStatus,
        cnt: sql<number>`count(*)::int`,
        revenue: sql<number>`coalesce(sum(${bookingsTable.totalPrice}), 0)::float`,
      })
      .from(bookingsTable)
      .groupBy(bookingsTable.status, bookingsTable.paymentStatus);

    let total = 0;
    let pending = 0;
    let confirmed = 0;
    let completed = 0;
    let cancelled = 0;
    let revenueAll = 0;
    let revenuePaid = 0;
    for (const r of bookingAgg) {
      total += r.cnt;
      revenueAll += r.revenue;
      if (r.paymentStatus === "paid") revenuePaid += r.revenue;
      if (r.status === "pending") pending += r.cnt;
      else if (r.status === "confirmed") confirmed += r.cnt;
      else if (r.status === "completed") completed += r.cnt;
      else if (r.status === "cancelled") cancelled += r.cnt;
    }

    const [providersAgg] = await db
      .select({
        total: sql<number>`count(*)::int`,
        premium: sql<number>`count(*) filter (where ${providersTable.subscriptionTier} = 'premium')::int`,
        verified: sql<number>`count(*) filter (where ${providersTable.verified} = true)::int`,
        pending: sql<number>`count(*) filter (where ${providersTable.approvalStatus} = 'pending')::int`,
        approved: sql<number>`count(*) filter (where ${providersTable.approvalStatus} = 'approved')::int`,
        rejected: sql<number>`count(*) filter (where ${providersTable.approvalStatus} = 'rejected')::int`,
      })
      .from(providersTable);

    const [customersAgg] = await db
      .select({
        total: sql<number>`count(distinct ${bookingsTable.customerId})::int`,
      })
      .from(bookingsTable);

    const [categoriesAgg] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(categoriesTable);

    const [reviewsAgg] = await db
      .select({
        total: sql<number>`count(*)::int`,
        avgRating: sql<number>`coalesce(avg(${reviewsTable.rating}), 0)::float`,
      })
      .from(reviewsTable);

    const [invoicesAgg] = await db
      .select({
        total: sql<number>`count(*) filter (where ${invoicesTable.kind} = 'invoice')::int`,
        storno: sql<number>`count(*) filter (where ${invoicesTable.kind} = 'storno')::int`,
        totalCents: sql<number>`coalesce(sum(${invoicesTable.totalCents}) filter (where ${invoicesTable.kind} = 'invoice'), 0)::bigint`,
      })
      .from(invoicesTable);

    res.json({
      bookings: {
        total,
        pending,
        confirmed,
        completed,
        cancelled,
        revenueAll: Math.round(revenueAll * 100),
        revenuePaidCents: Math.round(revenuePaid * 100),
      },
      providers: {
        total: providersAgg?.total ?? 0,
        premium: providersAgg?.premium ?? 0,
        verified: providersAgg?.verified ?? 0,
        pending: providersAgg?.pending ?? 0,
        approved: providersAgg?.approved ?? 0,
        rejected: providersAgg?.rejected ?? 0,
      },
      customers: {
        total: customersAgg?.total ?? 0,
      },
      categories: {
        total: categoriesAgg?.total ?? 0,
      },
      reviews: {
        total: reviewsAgg?.total ?? 0,
        averageRating: Number(reviewsAgg?.avgRating ?? 0),
      },
      invoices: {
        total: invoicesAgg?.total ?? 0,
        storno: invoicesAgg?.storno ?? 0,
        totalCents: Number(invoicesAgg?.totalCents ?? 0),
      },
    });
  } catch (err) {
    req.log.error({ err }, "Admin stats failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Daily time-series of bookings and paid revenue for the last `days` days.
 */
router.get("/admin/timeseries", requireAdmin, async (req, res): Promise<void> => {
  try {
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${bookingsTable.createdAt}), 'YYYY-MM-DD')`,
        bookings: sql<number>`count(*)::int`,
        paidRevenue: sql<number>`coalesce(sum(${bookingsTable.totalPrice}) filter (where ${bookingsTable.paymentStatus} = 'paid'), 0)::float`,
      })
      .from(bookingsTable)
      .where(gte(bookingsTable.createdAt, since))
      .groupBy(sql`date_trunc('day', ${bookingsTable.createdAt})`)
      .orderBy(sql`date_trunc('day', ${bookingsTable.createdAt})`);

    res.json(
      rows.map((r) => ({
        day: r.day,
        bookings: r.bookings,
        paidRevenueCents: Math.round(r.paidRevenue * 100),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Admin timeseries failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/providers", requireAdmin, async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select(adminProviderColumns)
      .from(providersTable)
      .orderBy(
        // Pending (then rejected) first so admins can action reviews quickly.
        sql`case ${providersTable.approvalStatus} when 'pending' then 0 when 'rejected' then 1 else 2 end`,
        desc(providersTable.createdAt),
      );
    res.json(rows.map(mapAdminProviderRow));
  } catch (err) {
    req.log.error({ err }, "Admin providers list failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch(
  "/admin/providers/:id/approval",
  requireAdmin,
  async (req, res): Promise<void> => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "Ungültige Anbieter-ID" });
        return;
      }
      const parsed = UpdateAdminProviderApprovalBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      const { status } = parsed.data;
      const rejectionReason = parsed.data.rejectionReason?.trim() || null;
      if (status === "rejected" && !rejectionReason) {
        res.status(400).json({ error: "Bitte geben Sie einen Ablehnungsgrund an." });
        return;
      }
      const [updated] = await db
        .update(providersTable)
        .set({
          approvalStatus: status,
          // Clear any prior rejection note when approving.
          rejectionReason: status === "rejected" ? rejectionReason : null,
          reviewedAt: new Date(),
        })
        .where(eq(providersTable.id, id))
        .returning({ id: providersTable.id });
      if (!updated) {
        res.status(404).json({ error: "Anbieter nicht gefunden" });
        return;
      }
      const [row] = await db
        .select(adminProviderColumns)
        .from(providersTable)
        .where(eq(providersTable.id, id))
        .limit(1);
      if (!row) {
        res.status(404).json({ error: "Anbieter nicht gefunden" });
        return;
      }
      res.json(mapAdminProviderRow(row));
    } catch (err) {
      req.log.error({ err }, "Admin provider approval update failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.get("/admin/customers", requireAdmin, async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select({
        customerId: bookingsTable.customerId,
        customerName: sql<string | null>`max(${bookingsTable.customerName})`,
        customerEmail: sql<string | null>`max(${bookingsTable.customerEmail})`,
        bookingCount: sql<number>`count(*)::int`,
        paidCount: sql<number>`count(*) filter (where ${bookingsTable.paymentStatus} = 'paid')::int`,
        totalSpentCents: sql<number>`coalesce(sum(${bookingsTable.totalPrice} * 100) filter (where ${bookingsTable.paymentStatus} = 'paid'), 0)::bigint`,
        firstBooking: sql<Date>`min(${bookingsTable.createdAt})`,
        lastBooking: sql<Date>`max(${bookingsTable.createdAt})`,
      })
      .from(bookingsTable)
      .groupBy(bookingsTable.customerId)
      .orderBy(sql`count(*) desc`);
    res.json(
      rows.map((r) => ({
        customerId: r.customerId,
        customerName: r.customerName,
        customerEmail: r.customerEmail,
        bookingCount: r.bookingCount,
        paidCount: r.paidCount,
        totalSpentCents: Number(r.totalSpentCents),
        firstBooking: new Date(r.firstBooking).toISOString(),
        lastBooking: new Date(r.lastBooking).toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Admin customers list failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/bookings", requireAdmin, async (req, res): Promise<void> => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
    const allowedStatuses = new Set(["pending", "confirmed", "completed", "cancelled"]);
    const rawStatus = typeof req.query.status === "string" ? req.query.status : null;
    if (rawStatus && !allowedStatuses.has(rawStatus)) {
      res.status(400).json({ error: "Ungültiger Statusfilter" });
      return;
    }
    const conditions = rawStatus ? [eq(bookingsTable.status, rawStatus)] : [];
    const rows = await db
      .select()
      .from(bookingsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(bookingsTable.createdAt))
      .limit(limit);
    res.json(
      rows.map((b) => ({
        id: b.id,
        customerId: b.customerId,
        customerName: b.customerName,
        customerEmail: b.customerEmail,
        providerId: b.providerId,
        providerName: b.providerName,
        serviceName: b.serviceName,
        status: b.status,
        paymentStatus: b.paymentStatus,
        totalPrice: b.totalPrice,
        scheduledAt: b.scheduledAt.toISOString(),
        createdAt: b.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Admin bookings list failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * A unified, support-facing view of refunded checkout purchases. Only refunded
 * rows are returned so refunds cannot be mistaken for live fulfilment work.
 */
router.get("/admin/refunded-orders", requireAdmin, async (req, res): Promise<void> => {
  try {
    const [reports, energieausweise, gebaeudecheckOrders] = await Promise.all([
      db
        .select({
          id: foerderschieneReportsTable.id,
          buyerEmail: foerderschieneReportsTable.email,
          amountCents: foerderschieneReportsTable.amountCents,
          createdAt: foerderschieneReportsTable.createdAt,
          refundedAt: foerderschieneReportsTable.refundedAt,
        })
        .from(foerderschieneReportsTable)
        .where(eq(foerderschieneReportsTable.status, "refunded")),
      db
        .select({
          id: energieausweisOrdersTable.id,
          buyerEmail: energieausweisOrdersTable.kontaktEmail,
          amountCents: energieausweisOrdersTable.amountCents,
          createdAt: energieausweisOrdersTable.createdAt,
          refundedAt: energieausweisOrdersTable.refundedAt,
        })
        .from(energieausweisOrdersTable)
        .where(eq(energieausweisOrdersTable.status, "refunded")),
      db
        .select({
          id: gebaeudecheckOrdersTable.sessionId,
          credits: gebaeudecheckOrdersTable.credits,
          creditsDeducted: gebaeudecheckOrdersTable.creditsDeducted,
          amountCents: gebaeudecheckOrdersTable.amountCents,
          createdAt: gebaeudecheckOrdersTable.createdAt,
          refundedAt: gebaeudecheckOrdersTable.refundedAt,
        })
        .from(gebaeudecheckOrdersTable)
        .where(eq(gebaeudecheckOrdersTable.status, "refunded")),
    ]);

    const rows = [
      ...reports.map((order) => ({
        id: String(order.id),
        product: "Gebäudereport",
        buyerEmail: order.buyerEmail,
        status: "refunded" as const,
        amountCents: order.amountCents,
        createdAt: order.createdAt.toISOString(),
        refundedAt: order.refundedAt?.toISOString() ?? null,
      })),
      ...energieausweise.map((order) => ({
        id: String(order.id),
        product: "Energieausweis",
        buyerEmail: order.buyerEmail,
        status: "refunded" as const,
        amountCents: order.amountCents,
        createdAt: order.createdAt.toISOString(),
        refundedAt: order.refundedAt?.toISOString() ?? null,
      })),
      ...gebaeudecheckOrders.map((order) => ({
        id: order.id,
        product: "Gebäudecheck-Guthaben",
        buyerEmail: null,
        status: "refunded" as const,
        amountCents: order.amountCents,
        /** Total credits in the refunded package. */
        credits: order.credits,
        /** Credits reclaimed from the buyer's balance at refund time (unused credits). */
        creditsDeducted: order.creditsDeducted,
        /** Credits that had already been spent on reports before the refund. */
        creditsAlreadyUsed: order.credits - order.creditsDeducted,
        createdAt: order.createdAt.toISOString(),
        refundedAt: order.refundedAt?.toISOString() ?? null,
      })),
    ].sort(
      (a, b) =>
        new Date(b.refundedAt ?? b.createdAt).getTime() -
        new Date(a.refundedAt ?? a.createdAt).getTime(),
    );

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list refunded checkout orders");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/categories", requireAdmin, async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select({
        slug: categoriesTable.slug,
        name: categoriesTable.name,
        requiresDirectBilling: categoriesTable.requiresDirectBilling,
        providerCount: sql<number>`(
          select count(*)::int from ${providersTable}
          where ${providersTable.categorySlug} = ${categoriesTable.slug}
        )`,
        bookingCount: sql<number>`(
          select count(*)::int from ${bookingsTable}
          join ${providersTable} on ${providersTable.id} = ${bookingsTable.providerId}
          where ${providersTable.categorySlug} = ${categoriesTable.slug}
        )`,
        paidRevenueCents: sql<number>`(
          select coalesce(sum(${bookingsTable.totalPrice} * 100), 0)::bigint from ${bookingsTable}
          join ${providersTable} on ${providersTable.id} = ${bookingsTable.providerId}
          where ${providersTable.categorySlug} = ${categoriesTable.slug}
            and ${bookingsTable.paymentStatus} = 'paid'
        )`,
      })
      .from(categoriesTable)
      .orderBy(categoriesTable.name);
    res.json(
      rows.map((r) => ({ ...r, paidRevenueCents: Number(r.paidRevenueCents) })),
    );
  } catch (err) {
    req.log.error({ err }, "Admin categories list failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /admin/email-test
 * Send a test email to verify Resend is configured and email_log tracking works.
 * Body: { to: string } — the recipient address.
 */
/**
 * GET /admin/email-health
 * Returns recent failed email_log rows for all critical transactional email
 * templates. An empty `failures` array means delivery is healthy within the
 * window.
 */
router.get("/admin/email-health", requireAdmin, async (req, res): Promise<void> => {
  try {
    const windowHours = Math.max(1, Math.min(720, Number(req.query.windowHours) || 24));
    const failures = await checkEmailDeliveryHealth(windowHours);
    res.json({
      healthy: failures.length === 0,
      windowHours,
      monitoredTemplateIds: CRITICAL_TRANSACTIONAL_EMAIL_TEMPLATE_IDS,
      failedCount: failures.length,
      failures: failures.map((r) => ({
        id: r.id,
        templateId: r.templateId,
        recipient: r.recipient,
        error: r.error,
        sentAt: r.sentAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Admin email-health check failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/email-test", requireAdmin, async (req, res): Promise<void> => {
  try {
    const body = (req.body ?? {}) as { to?: unknown };
    const to = typeof body.to === "string" ? body.to.trim() : "";
    if (!to || !to.includes("@")) {
      res.status(400).json({ error: "Valid recipient email (to) required" });
      return;
    }
    const configured = await isResendConfigured();
    if (!configured) {
      res.status(503).json({
        error: "Resend ist nicht erreichbar. Bitte prüfen Sie die Replit-Resend-Integration und die verifizierte Absender-Domain.",
        configured: false,
      });
      return;
    }
    // Re-use the provider welcome template as a generic test email.
    await sendProviderWelcome({ email: to, displayName: "Test-Empfänger" });
    // Confirm the email_log row was written.
    const [logRow] = await db
      .select({ id: emailLogTable.id, status: emailLogTable.status, sentAt: emailLogTable.sentAt })
      .from(emailLogTable)
      .where(eq(emailLogTable.recipient, to))
      .orderBy(desc(emailLogTable.sentAt))
      .limit(1);
    res.json({ ok: true, configured: true, logRow: logRow ?? null });
  } catch (err) {
    req.log.error({ err }, "Admin email-test failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get(
  "/admin/foerder-leads",
  requireAdmin,
  async (req, res): Promise<void> => {
    try {
      const leads = await db
        .select()
        .from(foerderLeadsTable)
        .orderBy(desc(foerderLeadsTable.createdAt))
        .limit(500);
      res.json(leads);
    } catch (err) {
      req.log.error({ err }, "Failed to list foerder leads");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── Förderprogramm-Aktualisierung ────────────────────────────────────────────

router.post(
  "/admin/foerder-update",
  requireAdmin,
  async (req, res): Promise<void> => {
    try {
      const logs = await runFoerderUpdate();
      res.json(logs);
    } catch (err) {
      req.log.error({ err }, "Manual foerder update failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.get(
  "/admin/foerder-update-log",
  requireAdmin,
  async (req, res): Promise<void> => {
    try {
      const logs = await db
        .select()
        .from(foerderUpdateLogTable)
        .orderBy(desc(foerderUpdateLogTable.gestartetAm))
        .limit(100);
      res.json(logs);
    } catch (err) {
      req.log.error({ err }, "Failed to list foerder update log");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
