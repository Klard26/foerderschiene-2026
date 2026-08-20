import { Router, type IRouter } from "express";
import {
  db,
  verwalterTable,
  objektTable,
  zaehlpunktTable,
  vertragTable,
  vollmachtTable,
  wechselvorgangTable,
  auditLogTable,
  tarifAngebotTable,
} from "@workspace/db";
import {
  CreateMyVerwalterBody,
  UpdateMyVerwalterBody,
  CreateObjektBody,
  DeleteObjektParams,
  CreateZaehlpunktBody,
  DeleteZaehlpunktParams,
  CreateVertragBody,
  CreateVollmachtBody,
  UpdateVollmachtStatusParams,
  UpdateVollmachtStatusBody,
  StarteAnalyseBody,
  FreigebenWechselParams,
  AblehnenWechselParams,
  WidersprechenWechselParams,
  ListTarifeQueryParams,
} from "@workspace/api-zod";
import {
  vollmachtUebergangErlaubt,
  wechselUebergangErlaubt,
  darfWechseln,
  nachEmpfehlung,
  vergleicheTarife,
  type TarifAngebot as TarifAngebotDto,
  type Sparte,
} from "@workspace/energie-wechsel";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import Anthropic from "@anthropic-ai/sdk";

const router: IRouter = Router();

import { anthropic } from "../lib/anthropicClient";

/** Resolve the Verwalter row owned by the current Clerk user. */
async function getVerwalter(userId: string) {
  const [row] = await db
    .select()
    .from(verwalterTable)
    .where(eq(verwalterTable.clerkUserId, userId))
    .limit(1);
  return row ?? null;
}

async function audit(entry: {
  verwalterId?: number | null;
  vollmachtId?: number | null;
  wechselId?: number | null;
  akteur: string;
  aktion: string;
  details?: unknown;
}): Promise<void> {
  await db.insert(auditLogTable).values({
    verwalterId: entry.verwalterId ?? null,
    vollmachtId: entry.vollmachtId ?? null,
    wechselId: entry.wechselId ?? null,
    akteur: entry.akteur,
    aktion: entry.aktion,
    details: (entry.details ?? null) as object | null,
  });
}

// ---------------------------------------------------------------------------
// Verwalter onboarding / profile
// ---------------------------------------------------------------------------

router.get("/energie/verwalter/me", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const row = await getVerwalter(userId);
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch Verwalter");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/energie/verwalter/me", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = CreateMyVerwalterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const existing = await getVerwalter(userId);
    if (existing) {
      res.status(409).json({ error: "Verwalter-Konto besteht bereits." });
      return;
    }
    const d = parsed.data;
    const [row] = await db
      .insert(verwalterTable)
      .values({
        clerkUserId: userId,
        firma: d.firma,
        typ: d.typ,
        handelsregisterNr: d.handelsregisterNr ?? null,
        ustId: d.ustId ?? null,
        erlaubnis34c: d.erlaubnis34c ?? false,
        strasse: d.strasse ?? null,
        plz: d.plz ?? null,
        ort: d.ort ?? null,
        email: d.email ?? null,
        telefon: d.telefon ?? null,
        provisionsmodell: d.provisionsmodell ?? "saas_flat",
      })
      .returning();
    if (row) {
      await audit({
        verwalterId: row.id,
        akteur: userId,
        aktion: "verwalter_erstellt",
        details: { firma: row.firma, typ: row.typ },
      });
    }
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create Verwalter");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/energie/verwalter/me", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = UpdateMyVerwalterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const existing = await getVerwalter(userId);
    if (!existing) {
      res.status(404).json({ error: "Kein Verwalter-Konto." });
      return;
    }
    const d = parsed.data;
    const [row] = await db
      .update(verwalterTable)
      .set({
        firma: d.firma,
        typ: d.typ,
        handelsregisterNr: d.handelsregisterNr ?? null,
        ustId: d.ustId ?? null,
        erlaubnis34c: d.erlaubnis34c ?? false,
        strasse: d.strasse ?? null,
        plz: d.plz ?? null,
        ort: d.ort ?? null,
        email: d.email ?? null,
        telefon: d.telefon ?? null,
        provisionsmodell: d.provisionsmodell ?? "saas_flat",
        updatedAt: new Date(),
      })
      .where(eq(verwalterTable.id, existing.id))
      .returning();
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update Verwalter");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Portfolio overview (KPIs + tree)
// ---------------------------------------------------------------------------

router.get("/energie/portfolio", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const verwalter = await getVerwalter(userId);
    if (!verwalter) {
      res.status(404).json({ error: "Kein Verwalter-Konto." });
      return;
    }

    const objekte = await db
      .select()
      .from(objektTable)
      .where(eq(objektTable.verwalterId, verwalter.id))
      .orderBy(objektTable.bezeichnung);

    const objektIds = objekte.map((o) => o.id);
    const zaehlpunkte = objektIds.length
      ? await db
          .select()
          .from(zaehlpunktTable)
          .where(inArray(zaehlpunktTable.objektId, objektIds))
      : [];

    const zpIds = zaehlpunkte.map((z) => z.id);
    const vertraege = zpIds.length
      ? await db
          .select()
          .from(vertragTable)
          .where(
            and(
              inArray(vertragTable.zaehlpunktId, zpIds),
              eq(vertragTable.istAktiv, true),
            ),
          )
      : [];
    const vertragByZp = new Map(vertraege.map((v) => [v.zaehlpunktId, v]));

    // Realised savings from completed switches in this portfolio.
    const wechsel = zpIds.length
      ? await db
          .select()
          .from(wechselvorgangTable)
          .where(inArray(wechselvorgangTable.zaehlpunktId, zpIds))
      : [];
    const realisierteErsparnisEur = wechsel
      .filter((w) => w.status === "aktiv")
      .reduce((s, w) => s + (w.ersparnisEurJahr ?? 0), 0);
    const potenzialErsparnisEur = wechsel
      .filter((w) =>
        ["empfehlung", "wartet_freigabe", "freigegeben"].includes(w.status),
      )
      .reduce((s, w) => s + (w.ersparnisEurJahr ?? 0), 0);

    const in60 = new Date();
    in60.setDate(in60.getDate() + 60);
    const kuendigungen60Tage = vertraege.filter((v) => {
      if (!v.naechsterKuendigungstermin) return false;
      const d = new Date(v.naechsterKuendigungstermin);
      return d >= new Date() && d <= in60;
    }).length;

    const tree = objekte.map((o) => ({
      objekt: o,
      zaehlpunkte: zaehlpunkte
        .filter((z) => z.objektId === o.id)
        .map((z) => ({
          zaehlpunkt: z,
          vertrag: vertragByZp.get(z.id) ?? null,
        })),
    }));

    res.json({
      kpi: {
        anzahlObjekte: objekte.length,
        anzahlZaehlpunkte: zaehlpunkte.length,
        aktiveVertraege: vertraege.length,
        kuendigungen60Tage,
        realisierteErsparnisEur: Math.round(realisierteErsparnisEur * 100) / 100,
        potenzialErsparnisEur: Math.round(potenzialErsparnisEur * 100) / 100,
      },
      objekte: tree,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load portfolio");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Objekt CRUD
// ---------------------------------------------------------------------------

router.post("/energie/objekte", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const verwalter = await getVerwalter(userId);
    if (!verwalter) {
      res.status(404).json({ error: "Kein Verwalter-Konto." });
      return;
    }
    const parsed = CreateObjektBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    const [row] = await db
      .insert(objektTable)
      .values({
        verwalterId: verwalter.id,
        bezeichnung: d.bezeichnung,
        strasse: d.strasse,
        plz: d.plz,
        ort: d.ort,
        wegBeschluss: d.wegBeschluss ?? false,
        wegBeschlussDatum: d.wegBeschlussDatum ?? null,
        notiz: d.notiz ?? null,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create Objekt");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/energie/objekte/:id", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const verwalter = await getVerwalter(userId);
    if (!verwalter) {
      res.status(404).json({ error: "Kein Verwalter-Konto." });
      return;
    }
    const parsed = DeleteObjektParams.safeParse({ id: Number(req.params.id) });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const result = await db
      .delete(objektTable)
      .where(
        and(
          eq(objektTable.id, parsed.data.id),
          eq(objektTable.verwalterId, verwalter.id),
        ),
      )
      .returning({ id: objektTable.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to delete Objekt");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Zaehlpunkt CRUD
// ---------------------------------------------------------------------------

/** Verify the given objekt belongs to the verwalter. */
async function ownsObjekt(verwalterId: number, objektId: number) {
  const [o] = await db
    .select()
    .from(objektTable)
    .where(
      and(eq(objektTable.id, objektId), eq(objektTable.verwalterId, verwalterId)),
    )
    .limit(1);
  return o ?? null;
}

/** Verify the given zaehlpunkt belongs to the verwalter (via its objekt). */
async function ownsZaehlpunkt(verwalterId: number, zaehlpunktId: number) {
  const [row] = await db
    .select({ zp: zaehlpunktTable, objekt: objektTable })
    .from(zaehlpunktTable)
    .innerJoin(objektTable, eq(zaehlpunktTable.objektId, objektTable.id))
    .where(
      and(
        eq(zaehlpunktTable.id, zaehlpunktId),
        eq(objektTable.verwalterId, verwalterId),
      ),
    )
    .limit(1);
  return row ?? null;
}

router.post("/energie/zaehlpunkte", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const verwalter = await getVerwalter(userId);
    if (!verwalter) {
      res.status(404).json({ error: "Kein Verwalter-Konto." });
      return;
    }
    const parsed = CreateZaehlpunktBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    if (!(await ownsObjekt(verwalter.id, d.objektId))) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Objekt." });
      return;
    }
    const [row] = await db
      .insert(zaehlpunktTable)
      .values({
        objektId: d.objektId,
        sparte: d.sparte,
        art: d.art ?? "allgemeinstrom",
        maloId: d.maloId ?? null,
        zaehlernummer: d.zaehlernummer ?? null,
        jahresverbrauchKwh: d.jahresverbrauchKwh ?? null,
        jahresverbrauchLiter: d.jahresverbrauchLiter ?? null,
        netzbetreiber: d.netzbetreiber ?? null,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create Zaehlpunkt");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/energie/zaehlpunkte/:id", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const verwalter = await getVerwalter(userId);
    if (!verwalter) {
      res.status(404).json({ error: "Kein Verwalter-Konto." });
      return;
    }
    const parsed = DeleteZaehlpunktParams.safeParse({
      id: Number(req.params.id),
    });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    if (!(await ownsZaehlpunkt(verwalter.id, parsed.data.id))) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db
      .delete(zaehlpunktTable)
      .where(eq(zaehlpunktTable.id, parsed.data.id));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to delete Zaehlpunkt");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Vertrag (current contract per metering point)
// ---------------------------------------------------------------------------

router.post("/energie/vertraege", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const verwalter = await getVerwalter(userId);
    if (!verwalter) {
      res.status(404).json({ error: "Kein Verwalter-Konto." });
      return;
    }
    const parsed = CreateVertragBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    if (!(await ownsZaehlpunkt(verwalter.id, d.zaehlpunktId))) {
      res.status(403).json({ error: "Kein Zugriff auf diesen Zählpunkt." });
      return;
    }
    // Deactivate any previous active contract on this metering point.
    await db
      .update(vertragTable)
      .set({ istAktiv: false })
      .where(
        and(
          eq(vertragTable.zaehlpunktId, d.zaehlpunktId),
          eq(vertragTable.istAktiv, true),
        ),
      );
    const [row] = await db
      .insert(vertragTable)
      .values({
        zaehlpunktId: d.zaehlpunktId,
        versorger: d.versorger,
        tarifname: d.tarifname ?? null,
        arbeitspreisCtKwh: d.arbeitspreisCtKwh ?? null,
        grundpreisEurJahr: d.grundpreisEurJahr ?? null,
        vertragsbeginn: d.vertragsbeginn ?? null,
        erstlaufzeitEnde: d.erstlaufzeitEnde ?? null,
        kuendigungsfristTage: d.kuendigungsfristTage ?? 30,
        naechsterKuendigungstermin: d.naechsterKuendigungstermin ?? null,
        preisgarantieBis: d.preisgarantieBis ?? null,
        istAktiv: true,
        quelle: "manuell",
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create Vertrag");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Vollmacht (power of attorney) – compliance core
// ---------------------------------------------------------------------------

router.get("/energie/vollmachten", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const verwalter = await getVerwalter(userId);
    if (!verwalter) {
      res.status(404).json({ error: "Kein Verwalter-Konto." });
      return;
    }
    const rows = await db
      .select()
      .from(vollmachtTable)
      .where(eq(vollmachtTable.verwalterId, verwalter.id))
      .orderBy(desc(vollmachtTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list Vollmachten");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/energie/vollmachten", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const verwalter = await getVerwalter(userId);
    if (!verwalter) {
      res.status(404).json({ error: "Kein Verwalter-Konto." });
      return;
    }
    const parsed = CreateVollmachtBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    if (d.objektId != null && !(await ownsObjekt(verwalter.id, d.objektId))) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Objekt." });
      return;
    }
    const [row] = await db
      .insert(vollmachtTable)
      .values({
        verwalterId: verwalter.id,
        objektId: d.objektId ?? null,
        sparte: d.sparte ?? null,
        status: "entwurf",
        modus: d.modus,
        darfKuendigen: d.darfKuendigen ?? true,
        darfAbschliessen: d.darfAbschliessen ?? true,
        darfSonderkuendigung: d.darfSonderkuendigung ?? true,
        darfDatenAbfragen: d.darfDatenAbfragen ?? true,
        darfBankdatenWeitergeben: d.darfBankdatenWeitergeben ?? true,
        widerspruchsfristTage: d.widerspruchsfristTage ?? 7,
        gueltigAb: d.gueltigAb ?? null,
        gueltigBis: d.gueltigBis ?? null,
      })
      .returning();
    if (row) {
      await audit({
        verwalterId: verwalter.id,
        vollmachtId: row.id,
        akteur: userId,
        aktion: "vollmacht_erstellt",
        details: { modus: row.modus, sparte: row.sparte },
      });
    }
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create Vollmacht");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch(
  "/energie/vollmachten/:id/status",
  async (req, res): Promise<void> => {
    try {
      const { userId } = getAuth(req);
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const verwalter = await getVerwalter(userId);
      if (!verwalter) {
        res.status(404).json({ error: "Kein Verwalter-Konto." });
        return;
      }
      const params = UpdateVollmachtStatusParams.safeParse({
        id: Number(req.params.id),
      });
      const body = UpdateVollmachtStatusBody.safeParse(req.body);
      if (!params.success || !body.success) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const [v] = await db
        .select()
        .from(vollmachtTable)
        .where(
          and(
            eq(vollmachtTable.id, params.data.id),
            eq(vollmachtTable.verwalterId, verwalter.id),
          ),
        )
        .limit(1);
      if (!v) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const ziel = body.data.status;
      if (
        !vollmachtUebergangErlaubt(
          v.status as Parameters<typeof vollmachtUebergangErlaubt>[0],
          ziel,
        )
      ) {
        res.status(409).json({
          error: `Übergang von '${v.status}' nach '${ziel}' nicht erlaubt.`,
        });
        return;
      }
      const now = new Date();
      const [row] = await db
        .update(vollmachtTable)
        .set({
          status: ziel,
          erteiltAm: ziel === "aktiv" && !v.erteiltAm ? now : v.erteiltAm,
          widerrufenAm: ziel === "widerrufen" ? now : v.widerrufenAm,
          widerrufGrund:
            ziel === "widerrufen"
              ? (body.data.widerrufGrund ?? null)
              : v.widerrufGrund,
        })
        .where(eq(vollmachtTable.id, v.id))
        .returning();
      await audit({
        verwalterId: verwalter.id,
        vollmachtId: v.id,
        akteur: userId,
        aktion: `vollmacht_${ziel}`,
        details: { von: v.status, nach: ziel },
      });
      res.json(row);
    } catch (err) {
      req.log.error({ err }, "Failed to update Vollmacht status");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ---------------------------------------------------------------------------
// Wechselvorgang (switch process) – AI recommendation + lifecycle
// ---------------------------------------------------------------------------

router.get("/energie/wechsel", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const verwalter = await getVerwalter(userId);
    if (!verwalter) {
      res.status(404).json({ error: "Kein Verwalter-Konto." });
      return;
    }
    const rows = await db
      .select({ w: wechselvorgangTable })
      .from(wechselvorgangTable)
      .innerJoin(
        zaehlpunktTable,
        eq(wechselvorgangTable.zaehlpunktId, zaehlpunktTable.id),
      )
      .innerJoin(objektTable, eq(zaehlpunktTable.objektId, objektTable.id))
      .where(eq(objektTable.verwalterId, verwalter.id))
      .orderBy(desc(wechselvorgangTable.createdAt));
    res.json(rows.map((r) => r.w));
  } catch (err) {
    req.log.error({ err }, "Failed to list Wechselvorgaenge");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/energie/wechsel/analyse", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const verwalter = await getVerwalter(userId);
    if (!verwalter) {
      res.status(404).json({ error: "Kein Verwalter-Konto." });
      return;
    }
    const parsed = StarteAnalyseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const owns = await ownsZaehlpunkt(verwalter.id, parsed.data.zaehlpunktId);
    if (!owns) {
      res.status(403).json({ error: "Kein Zugriff auf diesen Zählpunkt." });
      return;
    }
    const zp = owns.zp;
    const objekt = owns.objekt;

    // Resolve the Vollmacht to run under: explicit or best active match.
    const vollmachten = await db
      .select()
      .from(vollmachtTable)
      .where(eq(vollmachtTable.verwalterId, verwalter.id));
    let vollmacht =
      parsed.data.vollmachtId != null
        ? vollmachten.find((v) => v.id === parsed.data.vollmachtId)
        : vollmachten.find(
            (v) =>
              v.status === "aktiv" &&
              (v.objektId == null || v.objektId === zp.objektId) &&
              (v.sparte == null || v.sparte === zp.sparte),
          );
    if (!vollmacht) {
      res.status(409).json({
        error:
          "Keine passende aktive Vollmacht. Bitte zuerst eine Vollmacht aktivieren.",
      });
      return;
    }

    // Current active contract (Altvertrag).
    const [altVertrag] = await db
      .select()
      .from(vertragTable)
      .where(
        and(
          eq(vertragTable.zaehlpunktId, zp.id),
          eq(vertragTable.istAktiv, true),
        ),
      )
      .limit(1);

    const verbrauch = zp.jahresverbrauchKwh ?? 0;
    if (verbrauch <= 0) {
      res.status(400).json({
        error: "Für diesen Zählpunkt ist kein Jahresverbrauch hinterlegt.",
      });
      return;
    }

    // Real comparison against the seeded tariff feed.
    const angeboteRows = await db
      .select()
      .from(tarifAngebotTable)
      .where(eq(tarifAngebotTable.sparte, zp.sparte));
    const angebote: TarifAngebotDto[] = angeboteRows.map((a) => ({
      id: a.id,
      sparte: a.sparte as Sparte,
      versorger: a.versorger,
      tarifname: a.tarifname,
      arbeitspreisCtKwh: a.arbeitspreisCtKwh,
      grundpreisEurJahr: a.grundpreisEurJahr,
      laufzeitMonate: a.laufzeitMonate,
      preisgarantieMonate: a.preisgarantieMonate,
      oekostrom: a.oekostrom,
      minVerbrauchKwh: a.minVerbrauchKwh,
      maxVerbrauchKwh: a.maxVerbrauchKwh,
      plzGebiet: a.plzGebiet,
    }));

    const aktuell = {
      versorger: altVertrag?.versorger ?? "Grundversorgung",
      arbeitspreisCtKwh: altVertrag?.arbeitspreisCtKwh ?? 35,
      grundpreisEurJahr: altVertrag?.grundpreisEurJahr ?? 120,
    };

    const vergleich = vergleicheTarife({
      sparte: zp.sparte as Sparte,
      verbrauchKwh: verbrauch,
      plz: objekt.plz,
      aktuell,
      angebote,
    });

    // AI explanation of the neutral recommendation (real Claude call).
    let kiBegruendung =
      "Automatische Empfehlung auf Basis des günstigsten passenden Tarifs.";
    if (vergleich.bestesAngebot) {
      try {
        const best = vergleich.bestesAngebot;
        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 500,
          messages: [
            {
              role: "user",
              content: `Du bist ein neutraler Energie-Analyst für die Wohnungswirtschaft. Erkläre sachlich auf Deutsch (Sie-Form, max. 120 Wörter, keine Emojis, keine Werbung), warum der folgende Tarifwechsel empfohlen wird. Nenne die jährliche Ersparnis konkret und weise auf einen relevanten Aspekt (Preisgarantie, Laufzeit, Ökostrom) hin.

Objekt: ${objekt.bezeichnung}, ${objekt.plz} ${objekt.ort}
Sparte: ${zp.sparte}
Jahresverbrauch: ${verbrauch} kWh
Aktuell: ${aktuell.versorger}, ${aktuell.arbeitspreisCtKwh} ct/kWh, ${aktuell.grundpreisEurJahr} EUR/Jahr Grundpreis -> ${vergleich.aktuelleKostenEurJahr} EUR/Jahr
Empfehlung: ${best.versorger} – ${best.tarifname}, ${best.arbeitspreisCtKwh} ct/kWh, ${best.grundpreisEurJahr} EUR/Jahr Grundpreis -> ${vergleich.besteKostenEurJahr} EUR/Jahr${best.preisgarantieMonate ? `, ${best.preisgarantieMonate} Monate Preisgarantie` : ""}${best.oekostrom ? ", Ökostrom" : ""}
Ersparnis: ${vergleich.ersparnisEurJahr} EUR/Jahr (${vergleich.ersparnisProzent}%)
Verglichene Anbieter: ${vergleich.anzahlVerglicheneAnbieter}`,
            },
          ],
        });
        if (message.content[0]?.type === "text") {
          kiBegruendung = message.content[0].text.trim();
        }
      } catch (aiErr) {
        req.log.error({ err: aiErr }, "AI recommendation failed; using fallback");
      }
    }

    const best = vergleich.bestesAngebot;
    const naechster = best
      ? nachEmpfehlung(
          vollmacht.modus as Parameters<typeof nachEmpfehlung>[0],
          vollmacht.widerspruchsfristTage,
        )
      : { naechsterStatus: "fehlgeschlagen" as const };

    const [row] = await db
      .insert(wechselvorgangTable)
      .values({
        zaehlpunktId: zp.id,
        vollmachtId: vollmacht.id,
        altVertragId: altVertrag?.id ?? null,
        status: best ? naechster.naechsterStatus : "fehlgeschlagen",
        empfVersorger: best?.versorger ?? null,
        empfTarif: best?.tarifname ?? null,
        empfArbeitspreisCtKwh: best?.arbeitspreisCtKwh ?? null,
        empfGrundpreisEurJahr: best?.grundpreisEurJahr ?? null,
        ersparnisEurJahr: vergleich.ersparnisEurJahr,
        ersparnisProzent: vergleich.ersparnisProzent,
        anzahlVerglicheneAnbieter: vergleich.anzahlVerglicheneAnbieter,
        kiBegruendung: best ? kiBegruendung : "Kein günstigerer Tarif gefunden.",
        widerspruchBis:
          "widerspruchBis" in naechster ? naechster.widerspruchBis : null,
      })
      .returning();

    if (row) {
      await audit({
        verwalterId: verwalter.id,
        vollmachtId: vollmacht.id,
        wechselId: row.id,
        akteur: "ki-analyst",
        aktion: "analyse_durchgefuehrt",
        details: {
          ersparnisEurJahr: vergleich.ersparnisEurJahr,
          empfehlung: best?.versorger ?? null,
          status: row.status,
        },
      });
    }
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to run analysis");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** Shared helper to load a switch process the verwalter owns. */
async function ownsWechsel(verwalterId: number, wechselId: number) {
  const [row] = await db
    .select({ w: wechselvorgangTable, zp: zaehlpunktTable })
    .from(wechselvorgangTable)
    .innerJoin(
      zaehlpunktTable,
      eq(wechselvorgangTable.zaehlpunktId, zaehlpunktTable.id),
    )
    .innerJoin(objektTable, eq(zaehlpunktTable.objektId, objektTable.id))
    .where(
      and(
        eq(wechselvorgangTable.id, wechselId),
        eq(objektTable.verwalterId, verwalterId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Execute the simulated market switch (Demo): kündigen -> anmelden -> aktiv. */
async function fuehreWechselDurch(
  verwalterId: number,
  actor: string,
  wechsel: typeof wechselvorgangTable.$inferSelect,
  zaehlpunktId: number,
): Promise<typeof wechselvorgangTable.$inferSelect> {
  const now = new Date();
  // Deactivate the old contract.
  await db
    .update(vertragTable)
    .set({ istAktiv: false })
    .where(
      and(
        eq(vertragTable.zaehlpunktId, zaehlpunktId),
        eq(vertragTable.istAktiv, true),
      ),
    );
  // Create the new contract from the recommendation.
  const [neu] = await db
    .insert(vertragTable)
    .values({
      zaehlpunktId,
      versorger: wechsel.empfVersorger ?? "Neuer Versorger",
      tarifname: wechsel.empfTarif ?? null,
      arbeitspreisCtKwh: wechsel.empfArbeitspreisCtKwh ?? null,
      grundpreisEurJahr: wechsel.empfGrundpreisEurJahr ?? null,
      vertragsbeginn: now.toISOString().slice(0, 10),
      kuendigungsfristTage: 30,
      istAktiv: true,
      quelle: "wechsel",
    })
    .returning();
  const [row] = await db
    .update(wechselvorgangTable)
    .set({
      status: "aktiv",
      neuVertragId: neu?.id ?? null,
      abgeschlossenAm: now,
      updatedAt: now,
    })
    .where(eq(wechselvorgangTable.id, wechsel.id))
    .returning();
  await audit({
    verwalterId,
    vollmachtId: wechsel.vollmachtId,
    wechselId: wechsel.id,
    akteur: actor,
    aktion: "wechsel_abgeschlossen",
    details: { neuerVersorger: wechsel.empfVersorger, simuliert: true },
  });
  return row!;
}

router.post("/energie/wechsel/:id/freigeben", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const verwalter = await getVerwalter(userId);
    if (!verwalter) {
      res.status(404).json({ error: "Kein Verwalter-Konto." });
      return;
    }
    const parsed = FreigebenWechselParams.safeParse({
      id: Number(req.params.id),
    });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const owned = await ownsWechsel(verwalter.id, parsed.data.id);
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const w = owned.w;
    if (
      !wechselUebergangErlaubt(
        w.status as Parameters<typeof wechselUebergangErlaubt>[0],
        "freigegeben",
      )
    ) {
      res.status(409).json({
        error: `Freigabe im Status '${w.status}' nicht möglich.`,
      });
      return;
    }
    // Re-check the governing Vollmacht still permits switching.
    const [vollmacht] = await db
      .select()
      .from(vollmachtTable)
      .where(eq(vollmachtTable.id, w.vollmachtId))
      .limit(1);
    if (!vollmacht) {
      res.status(409).json({ error: "Vollmacht nicht gefunden." });
      return;
    }
    const check = darfWechseln({
      status: vollmacht.status as Parameters<typeof darfWechseln>[0]["status"],
      modus: vollmacht.modus as Parameters<typeof darfWechseln>[0]["modus"],
      darfKuendigen: vollmacht.darfKuendigen,
      darfAbschliessen: vollmacht.darfAbschliessen,
      gueltigAb: vollmacht.gueltigAb,
      gueltigBis: vollmacht.gueltigBis,
    });
    if (!check.erlaubt) {
      res.status(409).json({ error: check.grund ?? "Wechsel nicht erlaubt." });
      return;
    }
    await audit({
      verwalterId: verwalter.id,
      vollmachtId: w.vollmachtId,
      wechselId: w.id,
      akteur: userId,
      aktion: "wechsel_freigegeben",
    });
    const row = await fuehreWechselDurch(
      verwalter.id,
      userId,
      { ...w, status: "freigegeben", freigegebenAm: new Date() },
      owned.zp.id,
    );
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to approve switch");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/energie/wechsel/:id/ablehnen", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const verwalter = await getVerwalter(userId);
    if (!verwalter) {
      res.status(404).json({ error: "Kein Verwalter-Konto." });
      return;
    }
    const parsed = AblehnenWechselParams.safeParse({
      id: Number(req.params.id),
    });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const owned = await ownsWechsel(verwalter.id, parsed.data.id);
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const w = owned.w;
    if (
      !wechselUebergangErlaubt(
        w.status as Parameters<typeof wechselUebergangErlaubt>[0],
        "abgelehnt",
      )
    ) {
      res.status(409).json({
        error: `Ablehnung im Status '${w.status}' nicht möglich.`,
      });
      return;
    }
    const [row] = await db
      .update(wechselvorgangTable)
      .set({ status: "abgelehnt", updatedAt: new Date() })
      .where(eq(wechselvorgangTable.id, w.id))
      .returning();
    await audit({
      verwalterId: verwalter.id,
      vollmachtId: w.vollmachtId,
      wechselId: w.id,
      akteur: userId,
      aktion: "wechsel_abgelehnt",
    });
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to reject switch");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/energie/wechsel/:id/widersprechen",
  async (req, res): Promise<void> => {
    try {
      const { userId } = getAuth(req);
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const verwalter = await getVerwalter(userId);
      if (!verwalter) {
        res.status(404).json({ error: "Kein Verwalter-Konto." });
        return;
      }
      const parsed = WidersprechenWechselParams.safeParse({
        id: Number(req.params.id),
      });
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const owned = await ownsWechsel(verwalter.id, parsed.data.id);
      if (!owned) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const w = owned.w;
      if (
        !wechselUebergangErlaubt(
          w.status as Parameters<typeof wechselUebergangErlaubt>[0],
          "widersprochen",
        )
      ) {
        res.status(409).json({
          error: `Widerspruch im Status '${w.status}' nicht möglich.`,
        });
        return;
      }
      const [row] = await db
        .update(wechselvorgangTable)
        .set({ status: "widersprochen", updatedAt: new Date() })
        .where(eq(wechselvorgangTable.id, w.id))
        .returning();
      await audit({
        verwalterId: verwalter.id,
        vollmachtId: w.vollmachtId,
        wechselId: w.id,
        akteur: userId,
        aktion: "wechsel_widersprochen",
      });
      res.json(row);
    } catch (err) {
      req.log.error({ err }, "Failed to object to switch");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

router.get("/energie/audit", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const verwalter = await getVerwalter(userId);
    if (!verwalter) {
      res.status(404).json({ error: "Kein Verwalter-Konto." });
      return;
    }
    const rows = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.verwalterId, verwalter.id))
      .orderBy(desc(auditLogTable.zeitpunkt))
      .limit(200);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list audit log");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Tariff feed (transparency)
// ---------------------------------------------------------------------------

router.get("/energie/tarife", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = ListTarifeQueryParams.safeParse({
      sparte: req.query.sparte,
    });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query" });
      return;
    }
    const rows = parsed.data.sparte
      ? await db
          .select()
          .from(tarifAngebotTable)
          .where(eq(tarifAngebotTable.sparte, parsed.data.sparte))
          .orderBy(tarifAngebotTable.arbeitspreisCtKwh)
      : await db
          .select()
          .from(tarifAngebotTable)
          .orderBy(tarifAngebotTable.sparte, tarifAngebotTable.arbeitspreisCtKwh);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list tariffs");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
