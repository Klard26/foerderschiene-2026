import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { gebaeudecheckOrdersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { getUncachableStripeClient, STRIPE_CONFIG } from "../lib/stripeClient";
import {
  GEBAEUDECHECK_PACKAGES,
  getPackage,
  getCreditBalance,
  fulfillOrder,
} from "../lib/gebaeudecheck";

const router: IRouter = Router();

function getBaseUrl(req: import("express").Request): string {
  const host = req.get("host");
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  return `${proto}://${host}`;
}

const PACKAGES_PUBLIC = GEBAEUDECHECK_PACKAGES.map((p) => ({
  id: p.id,
  credits: p.credits,
  amountCents: p.amountCents,
  label: p.label,
}));

router.get("/gebaeudecheck/credits", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const balance = await getCreditBalance(userId);
    res.json({ balance, packages: PACKAGES_PUBLIC });
  } catch (err) {
    req.log.error({ err }, "Failed to load gebaeudecheck credits");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/gebaeudecheck/checkout", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const packageId = String((req.body as { packageId?: unknown })?.packageId ?? "");
    const pkg = getPackage(packageId);
    if (!pkg) {
      res.status(400).json({ error: "Unbekanntes Paket" });
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
    const baseUrl = getBaseUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: STRIPE_CONFIG.currency,
            unit_amount: pkg.amountCents,
            product_data: {
              name: `Gebäudecheck ${pkg.label} (${pkg.credits} Report${pkg.credits > 1 ? "s" : ""})`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/gebaeudecheck?credits=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/gebaeudecheck?credits=cancelled`,
      metadata: {
        kind: "gebaeudecheck",
        userId,
        packageId: pkg.id,
        credits: String(pkg.credits),
      },
    });

    await db.insert(gebaeudecheckOrdersTable).values({
      sessionId: session.id,
      userId,
      packageId: pkg.id,
      credits: pkg.credits,
      amountCents: pkg.amountCents,
      status: "pending",
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    req.log.error({ err }, "Failed to create gebaeudecheck checkout");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// Reconcile after the Stripe success redirect: grants credits if the session is
// paid. Idempotent via fulfillOrder (won't double-grant alongside the webhook).
router.post("/gebaeudecheck/reconcile", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const sessionId = String((req.body as { sessionId?: unknown })?.sessionId ?? "");
    if (!sessionId) {
      res.status(400).json({ error: "Missing sessionId" });
      return;
    }
    const [order] = await db
      .select()
      .from(gebaeudecheckOrdersTable)
      .where(eq(gebaeudecheckOrdersTable.sessionId, sessionId))
      .limit(1);
    if (!order || order.userId !== userId) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    const stripe = await getUncachableStripeClient();
    if (!stripe) {
      res.status(503).json({ error: "Stripe nicht konfiguriert" });
      return;
    }
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    let granted = false;
    if (session.payment_status === "paid") {
      granted = await fulfillOrder(
        sessionId,
        typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
      );
    }
    const balance = await getCreditBalance(userId);
    res.json({ granted, balance });
  } catch (err) {
    req.log.error({ err }, "Failed to reconcile gebaeudecheck order");
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
