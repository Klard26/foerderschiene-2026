import { Router, type IRouter } from "express";
import {
  db,
  providersTable,
  servicesTable,
  timeSlotsTable,
  bookingsTable,
  reviewsTable,
  immobilienKundeTable,
  immobilienPortfolioObjekteTable,
  verwalteteKundenTable,
  customerProfileTable,
  verwalterTable,
  assessmentsTable,
  offerAcceptancesTable,
  gebaeudecheckCreditsTable,
  gebaeudecheckOrdersTable,
  foerderschieneReportsTable,
  energieausweisOrdersTable,
  userRolesTable,
  invoicesTable,
  emailLogTable,
  requestsTable,
  requestMatchesTable,
  requestOffersTable,
  leadFeesTable,
  providerWalletTable,
  walletTransactionsTable,
  leadUsageTable,
} from "@workspace/db";
import { eq, or, inArray } from "drizzle-orm";
import { getAuth, clerkClient } from "@clerk/express";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { getRole, claimRole, RoleConflictError, type UserRole } from "../lib/userRole";

const router: IRouter = Router();

/** Read the current user's role (customer | provider), or null if none claimed. */
router.get("/account/role", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const role = await getRole(userId);
  res.status(200).json({ role });
});

/**
 * Claim a role for the current user. Enforces strict separation: if the account
 * already holds the OTHER role, this returns 409 instead of switching. Idempotent
 * when the same role is re-claimed.
 */
router.post("/account/role", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const wanted = (req.body as { role?: string })?.role;
  if (wanted !== "customer" && wanted !== "provider") {
    res.status(400).json({ error: "role must be 'customer' or 'provider'" });
    return;
  }
  try {
    const role = await claimRole(userId, wanted as UserRole);
    res.status(200).json({ role });
  } catch (err) {
    if (err instanceof RoleConflictError) {
      res.status(409).json({
        error:
          err.current === "provider"
            ? "Dieses Konto ist ein Berater-Konto und kann nicht als Kunde verwendet werden."
            : "Dieses Konto ist ein Kunden-Konto und kann nicht als Berater verwendet werden.",
        current: err.current,
      });
      return;
    }
    req.log.error({ err }, "Failed to claim role");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Permanently delete the authenticated user's entire Klard account — provider
 * profile (Berater), customer profile (Kunde), all bookings, reviews and the
 * Energiewechsel (enerwatt24) portfolio — and the Clerk auth user.
 *
 * This is the standard self-service "Konto löschen" flow: it removes every
 * trace of the user across roles, then deletes the login itself so they are
 * fully signed out and cannot log back in. The action is irreversible.
 */
router.delete("/account/me", async (req, res): Promise<void> => {
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

    // Collect every email_log identifier tied to this user BEFORE the rows it
    // references are deleted. email_log is keyed by recipient address +
    // relatedId (booking id / invoice number / recipient email), NOT by the
    // Clerk user id, so for a GDPR-clean deletion we gather the set of the
    // user's email addresses and domain ids, then purge matching audit rows
    // inside the deletion transaction below.
    const emailLogIdentifiers = new Set<string>();
    const addIdentifier = (value: string | number | null | undefined): void => {
      if (value == null) return;
      const s = String(value).trim();
      if (s) emailLogIdentifiers.add(s);
    };

    // The user's own email addresses (recipients of welcome / activation /
    // booking / invoice mail). welcome_* templates also key relatedId on the
    // recipient email, so the same value covers both columns.
    addIdentifier(provider?.email);

    // Best-effort: the Clerk account's primary/verified email addresses, which
    // are the recipient of the customer welcome mail and may not appear in any
    // local table. Never block deletion on a Clerk lookup failure.
    try {
      const clerkUser = await clerkClient.users.getUser(userId);
      for (const e of clerkUser.emailAddresses ?? []) addIdentifier(e?.emailAddress);
    } catch (err) {
      req.log.warn({ err }, "Clerk email lookup for email_log purge failed; continuing");
    }

    // Bookings the user made (as customer): booking ids + the customer email
    // recorded on each (relatedId of booking/reminder mail, recipient of it).
    const customerBookings = await db
      .select({ id: bookingsTable.id, email: bookingsTable.customerEmail })
      .from(bookingsTable)
      .where(eq(bookingsTable.customerId, userId));
    for (const b of customerBookings) {
      addIdentifier(b.id);
      addIdentifier(b.email);
    }

    if (provider) {
      // Bookings received by the provider: booking ids (relatedId of the
      // provider-facing booking/reminder mail; recipient is provider.email).
      const providerBookings = await db
        .select({ id: bookingsTable.id })
        .from(bookingsTable)
        .where(eq(bookingsTable.providerId, provider.id));
      for (const b of providerBookings) addIdentifier(b.id);

      // Invoice numbers (relatedId of invoice-ready / payment mail).
      const providerInvoices = await db
        .select({ invoiceNumber: invoicesTable.invoiceNumber })
        .from(invoicesTable)
        .where(eq(invoicesTable.providerId, provider.id));
      for (const inv of providerInvoices) addIdentifier(inv.invoiceNumber);
    }

    // Energieausweis order contact email (recipient of any related mail).
    const energieausweisContacts = await db
      .select({ email: energieausweisOrdersTable.kontaktEmail })
      .from(energieausweisOrdersTable)
      .where(eq(energieausweisOrdersTable.userId, userId));
    for (const o of energieausweisContacts) addIdentifier(o.email);

    // Pay-per-Lead (RfQ) request contact email — recipient of the offer-received
    // mail and may differ from the Clerk account email, so gather it explicitly.
    const requestContacts = await db
      .select({ email: requestsTable.customerEmail })
      .from(requestsTable)
      .where(eq(requestsTable.customerId, userId));
    for (const r of requestContacts) addIdentifier(r.email);

    // Best-effort: stop any active Stripe subscription immediately so the user
    // is not billed after deletion. Never block account deletion on Stripe.
    if (provider?.stripeSubscriptionId) {
      try {
        const stripe = await getUncachableStripeClient();
        if (stripe) {
          await stripe.subscriptions.cancel(provider.stripeSubscriptionId);
        }
      } catch (err) {
        req.log.warn({ err, providerId: provider.id }, "Stripe subscription cancel on account deletion failed");
      }
    }

    // Remove all DB data in a single transaction. Provider-owned tables
    // (services, time_slots, bookings, reviews) have no FK cascade, so they are
    // deleted explicitly; blocked_slots and invoices cascade off the provider
    // row, and the verwalter cascade clears the whole Energiewechsel portfolio.
    await db.transaction(async (tx) => {
      if (provider) {
        await tx.delete(servicesTable).where(eq(servicesTable.providerId, provider.id));
        await tx.delete(timeSlotsTable).where(eq(timeSlotsTable.providerId, provider.id));
        await tx.delete(reviewsTable).where(eq(reviewsTable.providerId, provider.id));
        await tx.delete(bookingsTable).where(eq(bookingsTable.providerId, provider.id));
        // Pay-per-Lead (RfQ) provider-keyed data (no FK cascade): wallet ledger,
        // wallet, lead fees, offers, matches, and monthly usage counter.
        await tx
          .delete(walletTransactionsTable)
          .where(eq(walletTransactionsTable.providerId, provider.id));
        await tx.delete(providerWalletTable).where(eq(providerWalletTable.providerId, provider.id));
        await tx.delete(leadFeesTable).where(eq(leadFeesTable.providerId, provider.id));
        await tx.delete(requestOffersTable).where(eq(requestOffersTable.providerId, provider.id));
        await tx.delete(requestMatchesTable).where(eq(requestMatchesTable.providerId, provider.id));
        await tx.delete(leadUsageTable).where(eq(leadUsageTable.providerId, provider.id));
        await tx.delete(providersTable).where(eq(providersTable.id, provider.id));
      }
      // All user-keyed data (keyed by the Clerk user id across both roles).
      await tx.delete(reviewsTable).where(eq(reviewsTable.customerId, userId));
      // Pay-per-Lead requests created by this customer hold their contact PII.
      await tx.delete(requestsTable).where(eq(requestsTable.customerId, userId));
      await tx.delete(bookingsTable).where(eq(bookingsTable.customerId, userId));
      await tx.delete(immobilienKundeTable).where(eq(immobilienKundeTable.userId, userId));
      // Commercial Förderschiene data: managed clients reference portfolio
      // objects, so delete the clients BEFORE their objects.
      await tx.delete(verwalteteKundenTable).where(eq(verwalteteKundenTable.userId, userId));
      await tx
        .delete(immobilienPortfolioObjekteTable)
        .where(eq(immobilienPortfolioObjekteTable.userId, userId));
      await tx.delete(customerProfileTable).where(eq(customerProfileTable.userId, userId));
      await tx.delete(offerAcceptancesTable).where(eq(offerAcceptancesTable.userId, userId));
      await tx.delete(assessmentsTable).where(eq(assessmentsTable.userId, userId));
      await tx.delete(gebaeudecheckOrdersTable).where(eq(gebaeudecheckOrdersTable.userId, userId));
      await tx.delete(gebaeudecheckCreditsTable).where(eq(gebaeudecheckCreditsTable.userId, userId));
      // Förderschiene (Gebäudereport + Energieausweis) orders/reports.
      await tx.delete(foerderschieneReportsTable).where(eq(foerderschieneReportsTable.userId, userId));
      await tx.delete(energieausweisOrdersTable).where(eq(energieausweisOrdersTable.userId, userId));
      // Energiewechsel (enerwatt24) portfolio cascades off verwalter.
      await tx.delete(verwalterTable).where(eq(verwalterTable.clerkUserId, userId));
      // Strict-role-separation record (claimed customer | provider role).
      await tx.delete(userRolesTable).where(eq(userRolesTable.clerkUserId, userId));
      // GDPR: purge email_log audit rows holding this user's personal data
      // (recipient address) or referencing their now-deleted bookings/invoices
      // (relatedId). Keyed by value, not user id, hence the gathered set above.
      if (emailLogIdentifiers.size > 0) {
        const ids = Array.from(emailLogIdentifiers);
        await tx
          .delete(emailLogTable)
          .where(or(inArray(emailLogTable.recipient, ids), inArray(emailLogTable.relatedId, ids)));
      }
    });

    // Finally, delete the Clerk login itself. The DB deletes above are
    // idempotent (deleting already-removed rows is a no-op), so if this call
    // fails the client can safely retry: the second attempt finds the data
    // already gone and just re-tries the Clerk deletion. A "user not found"
    // result means a prior attempt already deleted the login — treat as success.
    try {
      await clerkClient.users.deleteUser(userId);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status !== 404) {
        req.log.error({ err }, "Clerk user deletion failed after data removal; client should retry");
        res.status(500).json({ error: "Konto-Daten entfernt, aber der Zugang konnte nicht gelöscht werden. Bitte erneut versuchen." });
        return;
      }
    }

    res.status(200).json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete account");
    res.status(500).json({ error: "Konto konnte nicht gelöscht werden." });
  }
});

export default router;
