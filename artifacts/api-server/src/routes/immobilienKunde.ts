import { Router, type IRouter } from "express";
import { db, immobilienKundeTable } from "@workspace/db";
import { UpsertMyImmobilienKundeBody } from "@workspace/api-zod";
import { eq } from "drizzle-orm";
import { getAuth, clerkClient } from "@clerk/express";
import { sendCustomerWelcome } from "../lib/email";

const router: IRouter = Router();

router.get("/immobilien-kunde/me", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const [row] = await db
      .select()
      .from(immobilienKundeTable)
      .where(eq(immobilienKundeTable.userId, userId))
      .limit(1);
    res.json(row ?? null);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch immobilien-kunde profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/immobilien-kunde/me", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = UpsertMyImmobilienKundeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    const values = {
      userId,
      typ: d.typ,
      firma: d.firma,
      ansprechpartner: d.ansprechpartner ?? null,
      telefon: d.telefon ?? null,
      email: d.email ?? null,
      anzahlGebaeude: d.anzahlGebaeude ?? null,
      wohneinheitenGesamt: d.wohneinheitenGesamt ?? null,
      updatedAt: new Date(),
    };

    // Atomic first-time detection: the DB resolves the race on the userId
    // unique constraint, so only the single winning insert returns a row and
    // sends the welcome email. Concurrent double-submits never double-send.
    const inserted = await db
      .insert(immobilienKundeTable)
      .values(values)
      .onConflictDoNothing({ target: immobilienKundeTable.userId })
      .returning();
    const isFirstTime = inserted.length > 0;

    let row = inserted[0];
    if (!isFirstTime) {
      [row] = await db
        .update(immobilienKundeTable)
        .set({
          typ: values.typ,
          firma: values.firma,
          ansprechpartner: values.ansprechpartner,
          telefon: values.telefon,
          email: values.email,
          anzahlGebaeude: values.anzahlGebaeude,
          wohneinheitenGesamt: values.wohneinheitenGesamt,
          updatedAt: values.updatedAt,
        })
        .where(eq(immobilienKundeTable.userId, userId))
        .returning();
    }

    // Send the welcome email only on first-time profile creation.
    if (isFirstTime && row) {
      let email = d.email ?? "";
      if (!email) {
        try {
          const u = await clerkClient.users.getUser(userId);
          email = u.primaryEmailAddress?.emailAddress ?? "";
        } catch {
          // ignore — no email, no welcome
        }
      }
      if (email) {
        void sendCustomerWelcome({
          email,
          customerName: d.ansprechpartner || d.firma,
        });
      }
    }

    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to upsert immobilien-kunde profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
