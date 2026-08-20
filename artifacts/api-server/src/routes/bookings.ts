import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { bookingsTable, timeSlotsTable, servicesTable, providersTable, categoriesTable, assessmentsTable, blockedSlotsTable } from "@workspace/db";
import { clerkClient } from "@clerk/express";
import {
  CreateBookingBody,
  GetBookingParams,
  UpdateBookingStatusParams,
  UpdateBookingStatusBody,
  ListProviderBookingsParams,
} from "@workspace/api-zod";
import { eq, and, inArray, lt, gt } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { claimRole, RoleConflictError } from "../lib/userRole";
import {
  sendBookingConfirmationToCustomer,
  sendNewBookingToProvider,
  sendBookingCancellation,
  type BookingEmailContext,
} from "../lib/email";
import { buildIcs } from "../lib/icsBuilder";
import { issueStornoForBooking, sendInvoiceEmail } from "../lib/invoiceService";
import {
  serviceBelongsToProvider,
  slotBelongsToProvider,
  paymentRequiredForCategory,
} from "../lib/bookingValidation";

const router: IRouter = Router();

type BookingRow = typeof bookingsTable.$inferSelect;

async function withAssessmentLabels<T extends BookingRow | undefined>(
  rows: T[],
): Promise<Array<T & { assessmentLabel: string | null }>> {
  const ids = Array.from(
    new Set(rows.flatMap((r) => (r?.assessmentId != null ? [r.assessmentId] : []))),
  );
  const labels = new Map<number, string>();
  if (ids.length > 0) {
    const found = await db
      .select({ id: assessmentsTable.id, label: assessmentsTable.label })
      .from(assessmentsTable)
      .where(inArray(assessmentsTable.id, ids));
    for (const a of found) labels.set(a.id, a.label);
  }
  return rows.map((r) => ({
    ...(r as T),
    assessmentLabel: r?.assessmentId != null ? labels.get(r.assessmentId) ?? null : null,
  })) as Array<T & { assessmentLabel: string | null }>;
}

router.post("/bookings", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      await claimRole(userId, "customer");
    } catch (err) {
      if (err instanceof RoleConflictError) {
        res.status(403).json({
          error: "Dieses Konto ist ein Berater-Konto und kann keine Buchungen vornehmen.",
        });
        return;
      }
      throw err;
    }
    const parsed = CreateBookingBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;

    const [service] = await db
      .select()
      .from(servicesTable)
      .where(eq(servicesTable.id, d.serviceId))
      .limit(1);

    if (!service) {
      res.status(404).json({ error: "Service not found" });
      return;
    }
    if (!serviceBelongsToProvider(service, d.providerId)) {
      res.status(400).json({ error: "Leistung gehört nicht zu diesem Berater." });
      return;
    }

    const [provider] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.id, d.providerId))
      .limit(1);

    if (!provider || provider.approvalStatus !== "approved") {
      // Non-approved providers are hidden from the marketplace and cannot be
      // booked, even via a direct API call with known IDs (defense-in-depth).
      res.status(404).json({ error: "Provider not found" });
      return;
    }

    const [category] = await db
      .select()
      .from(categoriesTable)
      .where(eq(categoriesTable.slug, provider.categorySlug))
      .limit(1);

    const paymentRequired = paymentRequiredForCategory(category);

    let linkedAssessmentId: number | null = null;
    if (d.assessmentId != null) {
      const [a] = await db
        .select()
        .from(assessmentsTable)
        .where(eq(assessmentsTable.id, d.assessmentId))
        .limit(1);
      if (!a || a.userId !== userId) {
        res.status(403).json({ error: "Diese Analyse gehört nicht zu Ihrem Konto." });
        return;
      }
      linkedAssessmentId = a.id;
    }

    let customerName: string | null = null;
    let customerEmail: string | null = null;
    try {
      const u = await clerkClient.users.getUser(userId);
      customerName =
        [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || null;
      customerEmail = u.primaryEmailAddress?.emailAddress ?? null;
    } catch (e) {
      req.log.warn({ err: e }, "Failed to load Clerk user for booking");
    }

    // Atomic: re-check slot availability inside a transaction and lock it
    // so two concurrent bookings can't grab the same slot.
    const booking = await db.transaction(async (tx) => {
      const [slot] = await tx
        .select()
        .from(timeSlotsTable)
        .where(
          and(eq(timeSlotsTable.id, d.slotId), eq(timeSlotsTable.isAvailable, true)),
        )
        .for("update")
        .limit(1);

      if (!slot) {
        throw new Error("SLOT_TAKEN");
      }
      if (!slotBelongsToProvider(slot, d.providerId)) {
        throw new Error("SLOT_PROVIDER_MISMATCH");
      }

      // Reject if the slot overlaps an external-calendar busy interval (the
      // provider is blocked elsewhere). Mirrors the availability filter so a
      // stale client can't book over an imported event.
      const conflicts = await tx
        .select({ id: blockedSlotsTable.id })
        .from(blockedSlotsTable)
        .where(
          and(
            eq(blockedSlotsTable.providerId, d.providerId),
            lt(blockedSlotsTable.startTime, slot.endTime),
            gt(blockedSlotsTable.endTime, slot.startTime),
          ),
        )
        .limit(1);
      if (conflicts.length > 0) {
        throw new Error("SLOT_BLOCKED");
      }

      const [b] = await tx
        .insert(bookingsTable)
        .values({
          customerId: userId,
          customerName,
          customerEmail,
          providerId: d.providerId,
          providerName: provider.displayName,
          serviceId: d.serviceId,
          serviceName: service.name,
          slotId: d.slotId,
          status: "pending",
          totalPrice: service.price,
          scheduledAt: slot.startTime,
          notes: d.notes,
          paymentRequired,
          paymentStatus: paymentRequired ? "pending" : "not_required",
          assessmentId: linkedAssessmentId,
        })
        .returning();

      await tx
        .update(timeSlotsTable)
        .set({ isAvailable: false })
        .where(eq(timeSlotsTable.id, d.slotId));

      return b;
    });

    if (booking) {
      const ctx: BookingEmailContext = {
        bookingId: booking.id,
        scheduledAt: booking.scheduledAt,
        serviceName: booking.serviceName,
        providerName: booking.providerName,
        customerName: booking.customerName,
        customerEmail: booking.customerEmail,
        providerEmail: provider.email,
        totalPrice: booking.totalPrice,
        paymentRequired: booking.paymentRequired,
        notes: booking.notes,
        durationMinutes: service.durationMinutes ?? 60,
        location: provider.address ?? `${provider.zip ?? ""} ${provider.city}`.trim(),
        providerTier: provider.subscriptionTier,
      };
      const ics = buildIcs(
        [
          {
            uid: `booking-${booking.id}@klard`,
            summary: `Termin: ${booking.serviceName} bei ${booking.providerName}`,
            description: `Buchung #${booking.id}\nPreis: ${booking.totalPrice} EUR`,
            start: booking.scheduledAt,
            durationMinutes: service.durationMinutes ?? 60,
            location: provider.address ?? `${provider.zip ?? ""} ${provider.city}`.trim(),
          },
        ],
        `Klard Termin #${booking.id}`,
      );
      void sendBookingConfirmationToCustomer(ctx, ics);
      void sendNewBookingToProvider(ctx);
    }

    res.status(201).json(booking);
  } catch (err) {
    if (err instanceof Error && err.message === "SLOT_TAKEN") {
      res.status(409).json({ error: "Dieser Termin wurde gerade gebucht. Bitte wählen Sie einen anderen." });
      return;
    }
    if (err instanceof Error && err.message === "SLOT_PROVIDER_MISMATCH") {
      res.status(400).json({ error: "Termin gehört nicht zu diesem Berater." });
      return;
    }
    if (err instanceof Error && err.message === "SLOT_BLOCKED") {
      res.status(409).json({ error: "Dieser Termin ist im Kalender des Beraters nicht mehr verfügbar. Bitte wählen Sie einen anderen." });
      return;
    }
    req.log.error({ err }, "Failed to create booking");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/bookings", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const bookings = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.customerId, userId))
      .orderBy(bookingsTable.scheduledAt);
    res.json(await withAssessmentLabels(bookings));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch bookings");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/bookings/:id", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = GetBookingParams.safeParse({ id: Number(req.params.id) });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, parsed.data.id))
      .limit(1);

    if (!booking) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }

    // Allow either the customer who booked, or the provider receiving the booking.
    if (booking.customerId !== userId) {
      const [provider] = await db
        .select()
        .from(providersTable)
        .where(eq(providersTable.id, booking.providerId))
        .limit(1);
      if (!provider || provider.clerkUserId !== userId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }

    const [withLabel] = await withAssessmentLabels([booking]);
    res.json(withLabel);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch booking");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/bookings/:id/status", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const paramsParsed = UpdateBookingStatusParams.safeParse({ id: Number(req.params.id) });
    if (!paramsParsed.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const bodyParsed = UpdateBookingStatusBody.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: bodyParsed.error.message });
      return;
    }

    const [existing] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, paramsParsed.data.id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }

    // Authorization rules:
    //   - Customer may only cancel their own booking.
    //   - Provider (owner of providerId) may set any status on incoming bookings.
    const newStatus = bodyParsed.data.status;
    const isCustomer = existing.customerId === userId;
    let isProviderOwner = false;
    const [providerRow] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.id, existing.providerId))
      .limit(1);
    if (providerRow && providerRow.clerkUserId === userId) {
      isProviderOwner = true;
    }

    if (!isCustomer && !isProviderOwner) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (isCustomer && !isProviderOwner && newStatus !== "cancelled") {
      res.status(403).json({ error: "Sie können diesen Termin nur stornieren." });
      return;
    }

    const [updated] = await db
      .update(bookingsTable)
      .set({ status: newStatus })
      .where(eq(bookingsTable.id, paramsParsed.data.id))
      .returning();

    if (newStatus === "cancelled" && updated) {
      await db
        .update(timeSlotsTable)
        .set({ isAvailable: true })
        .where(eq(timeSlotsTable.id, updated.slotId));

      void sendBookingCancellation(
        {
          bookingId: updated.id,
          scheduledAt: updated.scheduledAt,
          serviceName: updated.serviceName,
          providerName: updated.providerName,
          customerName: updated.customerName,
          customerEmail: updated.customerEmail,
          providerEmail: providerRow?.email ?? null,
          totalPrice: updated.totalPrice,
          paymentRequired: updated.paymentRequired,
        },
        isProviderOwner ? "provider" : "customer",
      );

      // If an invoice was already issued for this booking, auto-issue a
      // Stornorechnung. Fire-and-forget — never block the status response.
      if (updated.paymentStatus === "paid") {
        void (async () => {
          try {
            const storno = await issueStornoForBooking(updated.id);
            if (storno && providerRow) {
              await sendInvoiceEmail({ invoice: storno, provider: providerRow, booking: updated });
            }
          } catch (err) {
            req.log.error({ err, bookingId: updated.id }, "Storno issue failed");
          }
        })();
      }
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update booking status");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/providers/:id/bookings", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = ListProviderBookingsParams.safeParse({ id: Number(req.params.id) });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [provider] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.id, parsed.data.id))
      .limit(1);
    if (!provider) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    if (provider.clerkUserId !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const bookings = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.providerId, parsed.data.id))
      .orderBy(bookingsTable.scheduledAt);
    res.json(await withAssessmentLabels(bookings));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch provider bookings");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
