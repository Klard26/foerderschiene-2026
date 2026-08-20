import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { providersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { getUncachableStripeClient } from "../lib/stripeClient";

const router: IRouter = Router();

function getBaseUrl(req: import("express").Request): string {
  const host = req.get("host");
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  return `${proto}://${host}`;
}

/**
 * GET /providers/me/connect — payout (Stripe Connect Express) status for the
 * signed-in provider. Reports whether an account exists, whether onboarding is
 * complete, and live capability flags pulled from Stripe.
 */
router.get("/providers/me/connect", async (req, res): Promise<void> => {
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

    if (!provider.stripeAccountId) {
      res.json({
        hasAccount: false,
        onboarded: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
      });
      return;
    }

    const stripe = await getUncachableStripeClient();
    if (!stripe) {
      // Account exists in our DB but we can't reach Stripe to refresh flags.
      res.json({
        hasAccount: true,
        onboarded: !!provider.stripeOnboardedAt,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
      });
      return;
    }

    const account = await stripe.accounts.retrieve(provider.stripeAccountId);
    const onboarded = !!account.charges_enabled && !!account.details_submitted;

    // Keep our cached onboarding timestamp in sync (webhook also does this).
    if (onboarded && !provider.stripeOnboardedAt) {
      await db
        .update(providersTable)
        .set({ stripeOnboardedAt: new Date() })
        .where(eq(providersTable.id, provider.id));
    } else if (!onboarded && provider.stripeOnboardedAt) {
      await db
        .update(providersTable)
        .set({ stripeOnboardedAt: null })
        .where(eq(providersTable.id, provider.id));
    }

    res.json({
      hasAccount: true,
      onboarded,
      chargesEnabled: !!account.charges_enabled,
      payoutsEnabled: !!account.payouts_enabled,
      detailsSubmitted: !!account.details_submitted,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load connect status");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /providers/me/connect/onboard — creates a Stripe Connect Express account
 * for the provider if one does not exist, then returns an account onboarding
 * link the provider opens to complete KYC/payout setup.
 */
router.post("/providers/me/connect/onboard", async (req, res): Promise<void> => {
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

    let accountId = provider.stripeAccountId;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "DE",
        email: provider.email || undefined,
        business_type: "individual",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { providerId: String(provider.id), clerkUserId: userId },
      });
      accountId = account.id;
      await db
        .update(providersTable)
        .set({ stripeAccountId: accountId })
        .where(eq(providersTable.id, provider.id));
    }

    const baseUrl = getBaseUrl(req);
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${baseUrl}/dashboard?connect=refresh`,
      return_url: `${baseUrl}/dashboard?connect=return`,
      type: "account_onboarding",
    });

    res.json({ url: link.url });
  } catch (err) {
    req.log.error({ err }, "Failed to create connect onboarding link");
    res.status(500).json({ error: "Failed to create onboarding link" });
  }
});

export default router;
