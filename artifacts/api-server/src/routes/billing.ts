import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { providersTable, bookingsTable, categoriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import {
  getUncachableStripeClient,
  isStripeConfigured,
  STRIPE_CONFIG,
  premiumConfigForWorld,
} from "../lib/stripeClient";
import {
  isConnectSplitEligible,
  computeApplicationFeeCents,
} from "../lib/commission";
import {
  getCategoryClassification,
  allowsBooking,
} from "../lib/providerClassification";
import {
  grantLeadCredits,
  revokeMonthlyPremiumGrants,
  LEAD_GRANT_SOURCES,
  ONE_TIME_PERIOD,
  PREMIUM_ACTIVATION_LEADS,
} from "../lib/leadGrants";

const router: IRouter = Router();

function getBaseUrl(req: import("express").Request): string {
  const host = req.get("host");
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  return `${proto}://${host}`;
}

router.get("/providers/me/subscription", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const [provider] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.clerkUserId, userId))
      .limit(1);
    if (!provider) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    const { worldId } = await getCategoryClassification(provider.categorySlug);
    res.json({
      tier: provider.subscriptionTier,
      status: provider.stripeSubscriptionId ? "active" : null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      priceEur: premiumConfigForWorld(worldId).priceEur,
      world: worldId,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load subscription");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/providers/me/subscription/checkout",
  async (req, res): Promise<void> => {
    try {
      const { userId } = getAuth(req);
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const stripe = await getUncachableStripeClient();
      if (!stripe) {
        res.status(503).json({
          error:
            "Stripe ist noch nicht verbunden. Bitte aktivieren Sie die Stripe-Integration im Replit-Workspace.",
        });
        return;
      }
      const [provider] = await db
        .select()
        .from(providersTable)
        .where(eq(providersTable.clerkUserId, userId))
        .limit(1);
      if (!provider) {
        res.status(404).json({ error: "Provider profile not found" });
        return;
      }
      if (provider.subscriptionTier === "premium") {
        res.status(400).json({ error: "Already premium" });
        return;
      }

      // World-aware Premium: each world has its own Stripe product (unique name
      // + metadata) and monthly price (pro 89 € / alltag 69 €).
      const { worldId } = await getCategoryClassification(provider.categorySlug);
      const premium = premiumConfigForWorld(worldId);

      const search = await stripe.products.search({
        query: `name:'${premium.productName}'`,
      });
      let productId = search.data[0]?.id;
      let priceId: string | undefined = undefined;
      if (!productId) {
        const product = await stripe.products.create({
          name: premium.productName,
          description: "Premium-Mitgliedschaft für Berater auf Klard",
          metadata: { kind: "subscription", tier: "premium", worldId },
        });
        productId = product.id;
      }
      const prices = await stripe.prices.list({ product: productId, active: true, limit: 10 });
      const monthly = prices.data.find(
        (p) => p.recurring?.interval === "month" && p.unit_amount === premium.priceEur * 100,
      );
      if (monthly) {
        priceId = monthly.id;
      } else {
        const price = await stripe.prices.create({
          product: productId,
          unit_amount: premium.priceEur * 100,
          currency: STRIPE_CONFIG.currency,
          recurring: { interval: "month" },
        });
        priceId = price.id;
      }

      let customerId = provider.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: provider.email || undefined,
          name: provider.displayName,
          metadata: { providerId: String(provider.id), clerkUserId: userId },
        });
        customerId = customer.id;
        await db
          .update(providersTable)
          .set({ stripeCustomerId: customerId })
          .where(eq(providersTable.id, provider.id));
      }

      const baseUrl = getBaseUrl(req);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/dashboard?subscription=success`,
        cancel_url: `${baseUrl}/dashboard?subscription=cancelled`,
        metadata: { providerId: String(provider.id), kind: "subscription", worldId },
      });
      res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
      req.log.error({ err }, "Failed to create subscription checkout");
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  },
);

router.delete("/providers/me/subscription", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const stripe = await getUncachableStripeClient();
    if (!stripe) {
      res.status(503).json({ error: "Stripe nicht konfiguriert" });
      return;
    }
    const [provider] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.clerkUserId, userId))
      .limit(1);
    if (!provider?.stripeSubscriptionId) {
      res.status(404).json({ error: "Keine aktive Subscription" });
      return;
    }
    await stripe.subscriptions.update(provider.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    const { worldId } = await getCategoryClassification(provider.categorySlug);
    res.json({
      tier: provider.subscriptionTier,
      status: "active",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: true,
      priceEur: premiumConfigForWorld(worldId).priceEur,
      world: worldId,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to cancel subscription");
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/bookings/:id/payment/checkout", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, id))
      .limit(1);
    if (!booking || booking.customerId !== userId) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }
    if (!booking.paymentRequired) {
      res.status(400).json({
        error:
          "Diese Buchung wird direkt mit dem Berater abgerechnet (z. B. Anwalt/Steuerberater).",
      });
      return;
    }
    if (booking.paymentStatus === "paid") {
      res.status(400).json({ error: "Bereits bezahlt" });
      return;
    }
    const stripe = await getUncachableStripeClient();
    if (!stripe) {
      res.status(503).json({ error: "Stripe nicht konfiguriert" });
      return;
    }
    const [provider] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.id, booking.providerId))
      .limit(1);

    // Model B: booking commission applies to booking categories only (now /
    // hybrid). Lead-only categories never charge a booking commission — reject
    // a booking payment for them rather than silently mischarging.
    const classification = await getCategoryClassification(provider?.categorySlug);
    if (!allowsBooking(classification.pricingModel)) {
      res.status(400).json({
        error:
          "Diese Kategorie rechnet über Pay-per-Lead ab und kann nicht per Buchung bezahlt werden.",
      });
      return;
    }

    const baseUrl = getBaseUrl(req);
    const totalCents = Math.round(booking.totalPrice * 100);

    // Marketplace payout split: when the provider has completed Stripe Connect
    // onboarding, route the charge as a destination charge — Stripe transfers
    // the net to the provider and keeps the platform commission as an
    // application fee. Without Connect, the platform collects the full amount
    // (legacy behaviour) and settles with the provider out of band.
    const connected = isConnectSplitEligible(provider);
    const splitData =
      connected && provider
        ? {
            application_fee_amount: computeApplicationFeeCents(
              provider,
              classification.worldId,
              totalCents,
            ),
            transfer_data: { destination: provider.stripeAccountId! },
          }
        : {};

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: STRIPE_CONFIG.currency,
            unit_amount: totalCents,
            product_data: {
              name: `${booking.serviceName} – ${provider?.displayName ?? booking.providerName}`,
            },
          },
          quantity: 1,
        },
      ],
      customer_email: booking.customerEmail ?? undefined,
      success_url: `${baseUrl}/bookings?payment=success`,
      cancel_url: `${baseUrl}/bookings/${booking.id}?payment=cancelled`,
      metadata: { bookingId: String(booking.id), kind: "booking" },
      payment_intent_data: {
        metadata: { bookingId: String(booking.id), kind: "booking" },
        ...splitData,
      },
    });

    await db
      .update(bookingsTable)
      .set({
        stripeCheckoutSessionId: session.id,
        paymentStatus: "pending",
      })
      .where(eq(bookingsTable.id, booking.id));

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    req.log.error({ err }, "Failed to create booking checkout");
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/billing/health", async (_req, res): Promise<void> => {
  const configured = await isStripeConfigured();
  res.json({ stripeConfigured: configured });
});

// Reconcile state after Stripe Checkout success redirect.
// Frontend calls this on the success page; safer than trusting URL params and
// works even before a webhook is wired.
router.post("/billing/reconcile", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const stripe = await getUncachableStripeClient();
    if (!stripe) {
      res.status(503).json({ error: "Stripe nicht konfiguriert" });
      return;
    }
    const [provider] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.clerkUserId, userId))
      .limit(1);
    if (!provider) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }

    let updated = false;

    // Subscription reconciliation: list active subs by customer and flip tier
    if (provider.stripeCustomerId) {
      const subs = await stripe.subscriptions.list({
        customer: provider.stripeCustomerId,
        status: "active",
        limit: 5,
      });
      const sub = subs.data[0];
      if (sub && provider.subscriptionTier !== "premium") {
        await db.transaction(async (tx) => {
          await tx
            .update(providersTable)
            .set({
              subscriptionTier: "premium",
              stripeSubscriptionId: sub.id,
              premiumSince: new Date(),
            })
            .where(eq(providersTable.id, provider.id));
          // Activation bonus: 5 free leads, once ever. Idempotent, so reconcile
          // re-runs (and a prior webhook grant) never double-grant.
          await grantLeadCredits(tx, {
            providerId: provider.id,
            source: LEAD_GRANT_SOURCES.premiumActivation,
            periodMonth: ONE_TIME_PERIOD,
            count: PREMIUM_ACTIVATION_LEADS,
            expiresAt: null,
          });
        });
        updated = true;
      } else if (!sub && provider.subscriptionTier === "premium") {
        // Flip to basic AND revoke unused monthly free leads atomically (no
        // window where a downgraded provider can still spend monthly free leads).
        await db.transaction(async (tx) => {
          await tx
            .update(providersTable)
            .set({
              subscriptionTier: "basic",
              stripeSubscriptionId: null,
            })
            .where(eq(providersTable.id, provider.id));
          await revokeMonthlyPremiumGrants(tx, provider.id);
        });
        updated = true;
      }
    }

    // Booking payment reconciliation: any booking session for this user that
    // shows as paid in Stripe should be flipped to paid.
    const myBookings = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.customerId, userId));
    for (const b of myBookings) {
      if (b.paymentStatus === "paid" || !b.stripeCheckoutSessionId) continue;
      try {
        const sess = await stripe.checkout.sessions.retrieve(b.stripeCheckoutSessionId);
        if (sess.payment_status === "paid") {
          await db
            .update(bookingsTable)
            .set({ paymentStatus: "paid" })
            .where(eq(bookingsTable.id, b.id));
          updated = true;
        }
      } catch {
        // ignore individual session errors
      }
    }

    res.json({ updated });
  } catch (err) {
    req.log.error({ err }, "Failed to reconcile billing");
    res.status(500).json({ error: "Failed" });
  }
});

// Re-export for index registration
export { categoriesTable };
export default router;
