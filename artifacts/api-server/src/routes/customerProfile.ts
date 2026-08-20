import { Router, type IRouter } from "express";
import { db, customerProfileTable } from "@workspace/db";
import { UpsertMyCustomerProfileBody } from "@workspace/api-zod";
import { eq } from "drizzle-orm";
import { getAuth, clerkClient } from "@clerk/express";
import { sendCustomerWelcome } from "../lib/email";
import { claimRole, RoleConflictError } from "../lib/userRole";

const router: IRouter = Router();

router.get("/customer-profile/me", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const [row] = await db
      .select()
      .from(customerProfileTable)
      .where(eq(customerProfileTable.userId, userId))
      .limit(1);
    res.json(row ?? null);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch customer profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/customer-profile/me", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    // Enforce strict role separation: a Berater account may not create or edit
    // a customer profile (mirrors booking creation).
    try {
      await claimRole(userId, "customer");
    } catch (err) {
      if (err instanceof RoleConflictError) {
        res.status(403).json({
          error: "Dieses Konto ist ein Berater-Konto und kann kein Kundenprofil anlegen.",
        });
        return;
      }
      throw err;
    }
    const parsed = UpsertMyCustomerProfileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    const values = {
      userId,
      strasse: d.strasse,
      hausnummer: d.hausnummer,
      plz: d.plz,
      ort: d.ort,
      interessen: (d.interessen ?? []).slice(0, 3),
      quelle: d.quelle ?? null,
      updatedAt: new Date(),
    };

    // Atomic first-time detection: the DB resolves the race on the userId
    // unique constraint, so only the single winning insert returns a row and
    // sends the welcome email. Concurrent double-submits never double-send.
    const inserted = await db
      .insert(customerProfileTable)
      .values(values)
      .onConflictDoNothing({ target: customerProfileTable.userId })
      .returning();
    const isFirstTime = inserted.length > 0;

    let row = inserted[0];
    if (!isFirstTime) {
      [row] = await db
        .update(customerProfileTable)
        .set({
          strasse: values.strasse,
          hausnummer: values.hausnummer,
          plz: values.plz,
          ort: values.ort,
          interessen: values.interessen,
          quelle: values.quelle,
          updatedAt: values.updatedAt,
        })
        .where(eq(customerProfileTable.userId, userId))
        .returning();
    }

    // Send the welcome email only on first-time profile creation.
    if (isFirstTime && row) {
      try {
        const u = await clerkClient.users.getUser(userId);
        const email = u.primaryEmailAddress?.emailAddress ?? "";
        if (email) {
          void sendCustomerWelcome({
            email,
            customerName:
              [u.firstName, u.lastName].filter(Boolean).join(" ") || email,
          });
        }
      } catch {
        // ignore — no email, no welcome
      }
    }

    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to upsert customer profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
