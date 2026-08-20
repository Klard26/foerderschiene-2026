import { Router, type IRouter } from "express";
import { z } from "zod";
import { fpQuery, fpQueryOne } from "../lib/foerderpilotDb";
import { requireAdmin } from "../lib/adminAuth";
import type {
  Vorgang,
  VorgangUebersicht,
  Dokument,
  Expose,
} from "../lib/vorgangTypes";

/**
 * Förderschiene — Vorgangs-/Dokument-/Exposé-Erweiterung (Facilioo- &
 * PLANFLUX-Muster), ported from the standalone Fastify reference to Express.
 *
 * Lives in the standard `public` schema (dedicated pool, see
 * lib/foerderpilotDb.ts) and is mounted under `/api/foerderpilot/...` — NOT part
 * of the Orval/OpenAPI contract, consistent with the rest of the Förderpilot
 * integration.
 *
 * Security: unlike the public read-only funding finder, these endpoints create
 * and read business data + contact details (Vorgänge, Nachrichten, Dokument-
 * Metadaten, Exposés). The `foerderpilot` schema has no Clerk↔nutzer mapping for
 * per-tenant ownership, so the whole router is gated behind `requireAdmin`
 * (fail-closed) by default. Open it up to a dedicated B2B2C professional role
 * once that role + ownership model exists.
 */

const router: IRouter = Router();

// Gate every endpoint in this router (B2B2C management tooling, handles PII).
// Scope the guard to this router's own `/foerderpilot` prefix: because the
// router is mounted path-less, a bare `router.use(requireAdmin)` would also
// 401/403 every UNMATCHED request that falls through to it (swallowing later
// routers like requests/offers/account). Prefix-scoping keeps the gate while
// letting non-matching paths fall through untouched.
router.use("/foerderpilot", requireAdmin);

const IdParam = z.object({ id: z.string().uuid() });

/** Gültige Vorgangs-Status — single source of truth für Body UND Filter. */
const VORGANG_STATUS = [
  "neu",
  "in_pruefung",
  "unterlagen_offen",
  "antrag_gestellt",
  "bewilligt",
  "abgelehnt",
  "abgeschlossen",
] as const;

/**
 * Akzeptiert ISO-Datum/-Datetime und weist Müll mit 400 ab, damit ungültige
 * Werte nicht erst als Postgres-Cast-Fehler (500) auffallen.
 */
const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "Ungültiges Datum");

/* ----------------------------- Vorgänge ----------------------------- */

const VorgangBody = z.object({
  organisation_id: z.string().uuid().optional(),
  objekt_id: z.string().uuid().optional(),
  programm_id: z.string().uuid().optional(),
  nutzer_id: z.string().uuid().optional(),
  berater_id: z.string().uuid().optional(),
  titel: z.string().min(1),
  faellig_am: isoDate.optional(),
});

const StatusBody = z.object({
  status: z.enum(VORGANG_STATUS),
});

const NachrichtBody = z.object({
  kanal: z.enum(["web", "email", "whatsapp", "telefon", "post", "intern"]),
  richtung: z.enum(["eingehend", "ausgehend"]).default("eingehend"),
  von: z.string().optional(),
  inhalt: z.string().min(1),
});

const DokumentBody = z.object({
  dateiname: z.string().min(1),
  mime_typ: z.string().optional(),
  speicher_pfad: z.string().optional(),
  ebene: z
    .enum(["organisation", "objekt", "vorgang", "antragsschritt", "pflichtunterlage"])
    .default("vorgang"),
  objekt_id: z.string().uuid().optional(),
  antragsschritt_id: z.string().uuid().optional(),
  pflichtunterlage_id: z.string().uuid().optional(),
  freigabe_rolle: z.string().optional(),
});

/** POST /api/foerderpilot/vorgaenge — neuen Förder-Vorgang anlegen */
router.post("/foerderpilot/vorgaenge", async (req, res): Promise<void> => {
  const b = VorgangBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: "Ungültige Vorgangsdaten", details: b.error.issues });
    return;
  }
  const v = b.data;
  try {
    const vorgang = await fpQueryOne<Vorgang>(
      `INSERT INTO vorgang (organisation_id, objekt_id, programm_id, nutzer_id, berater_id, titel, faellig_am)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        v.organisation_id ?? null,
        v.objekt_id ?? null,
        v.programm_id ?? null,
        v.nutzer_id ?? null,
        v.berater_id ?? null,
        v.titel,
        v.faellig_am ?? null,
      ],
    );
    res.status(201).json(vorgang);
  } catch (err) {
    req.log.error({ err }, "foerderpilot vorgang create failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/foerderpilot/vorgaenge — Übersicht (optional je Organisation/Status),
 * inkl. Dokument-Vollständigkeit (Pflichtunterlagen Soll/Ist).
 */
router.get("/foerderpilot/vorgaenge", async (req, res): Promise<void> => {
  const q = z
    .object({
      organisation_id: z.string().uuid().optional(),
      status: z.enum(VORGANG_STATUS).optional(),
    })
    .safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: "Ungültige Filter" });
    return;
  }

  const where: string[] = [];
  const params: unknown[] = [];
  const p = (x: unknown) => {
    params.push(x);
    return `$${params.length}`;
  };
  if (q.data.organisation_id)
    where.push(
      `v.id IN (SELECT id FROM vorgang WHERE organisation_id = ${p(q.data.organisation_id)})`,
    );
  if (q.data.status) where.push(`v.status = ${p(q.data.status)}`);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const rows = await fpQuery<VorgangUebersicht>(
      `SELECT * FROM v_vorgang_uebersicht v ${whereSql} ORDER BY v.aktualisiert_am DESC`,
      params,
    );
    res.json({ anzahl: rows.length, vorgaenge: rows });
  } catch (err) {
    req.log.error({ err }, "foerderpilot vorgaenge list failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /api/foerderpilot/vorgaenge/:id — Detail mit Nachrichten und Dokumenten */
router.get("/foerderpilot/vorgaenge/:id", async (req, res): Promise<void> => {
  const pid = IdParam.safeParse(req.params);
  if (!pid.success) {
    res.status(400).json({ error: "Ungültige Vorgang-ID" });
    return;
  }

  try {
    const vorgang = await fpQueryOne<VorgangUebersicht>(
      "SELECT * FROM v_vorgang_uebersicht WHERE id = $1",
      [pid.data.id],
    );
    if (!vorgang) {
      res.status(404).json({ error: "Vorgang nicht gefunden" });
      return;
    }

    const [nachrichten, dokumente] = await Promise.all([
      fpQuery(
        "SELECT kanal, richtung, von, inhalt, erstellt_am FROM vorgang_nachricht WHERE vorgang_id = $1 ORDER BY erstellt_am",
        [pid.data.id],
      ),
      fpQuery<Dokument>(
        "SELECT id, ebene, dateiname, mime_typ, geprueft, pflichtunterlage_id FROM dokument WHERE vorgang_id = $1 ORDER BY erstellt_am",
        [pid.data.id],
      ),
    ]);
    res.json({ ...vorgang, nachrichten, dokumente });
  } catch (err) {
    req.log.error({ err }, "foerderpilot vorgang detail failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** PATCH /api/foerderpilot/vorgaenge/:id/status — Statuswechsel (Workflow) */
router.patch("/foerderpilot/vorgaenge/:id/status", async (req, res): Promise<void> => {
  const pid = IdParam.safeParse(req.params);
  const b = StatusBody.safeParse(req.body);
  if (!pid.success) {
    res.status(400).json({ error: "Ungültige Vorgang-ID" });
    return;
  }
  if (!b.success) {
    res.status(400).json({ error: "Ungültiger Status", details: b.error.issues });
    return;
  }
  try {
    const updated = await fpQueryOne<Vorgang>(
      "UPDATE vorgang SET status = $2 WHERE id = $1 RETURNING *",
      [pid.data.id, b.data.status],
    );
    if (!updated) {
      res.status(404).json({ error: "Vorgang nicht gefunden" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "foerderpilot vorgang status failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/foerderpilot/vorgaenge/:id/nachrichten — Multi-Channel-Eingang.
 * Jeder Kanal (E-Mail/WhatsApp/Telefon/Post/Web) landet im selben Vorgang.
 */
router.post("/foerderpilot/vorgaenge/:id/nachrichten", async (req, res): Promise<void> => {
  const pid = IdParam.safeParse(req.params);
  const b = NachrichtBody.safeParse(req.body);
  if (!pid.success) {
    res.status(400).json({ error: "Ungültige Vorgang-ID" });
    return;
  }
  if (!b.success) {
    res.status(400).json({ error: "Ungültige Nachricht", details: b.error.issues });
    return;
  }

  try {
    const exists = await fpQueryOne<{ id: string }>("SELECT id FROM vorgang WHERE id = $1", [
      pid.data.id,
    ]);
    if (!exists) {
      res.status(404).json({ error: "Vorgang nicht gefunden" });
      return;
    }

    const n = b.data;
    const nachricht = await fpQueryOne(
      `INSERT INTO vorgang_nachricht (vorgang_id, kanal, richtung, von, inhalt)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [pid.data.id, n.kanal, n.richtung, n.von ?? null, n.inhalt],
    );
    res.status(201).json(nachricht);
  } catch (err) {
    req.log.error({ err }, "foerderpilot vorgang nachricht failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/foerderpilot/vorgaenge/:id/dokumente — Dokument mit Kontextzuordnung.
 * Das Facilioo-Kernmuster: das Dokument wird automatisch der richtigen Ebene
 * zugeordnet (Objekt/Vorgang/Schritt/Pflichtunterlage), mit Prüfstatus.
 */
router.post("/foerderpilot/vorgaenge/:id/dokumente", async (req, res): Promise<void> => {
  const pid = IdParam.safeParse(req.params);
  const b = DokumentBody.safeParse(req.body);
  if (!pid.success) {
    res.status(400).json({ error: "Ungültige Vorgang-ID" });
    return;
  }
  if (!b.success) {
    res.status(400).json({ error: "Ungültiges Dokument", details: b.error.issues });
    return;
  }

  try {
    const exists = await fpQueryOne<{ id: string }>("SELECT id FROM vorgang WHERE id = $1", [
      pid.data.id,
    ]);
    if (!exists) {
      res.status(404).json({ error: "Vorgang nicht gefunden" });
      return;
    }

    const d = b.data;
    const dok = await fpQueryOne<Dokument>(
      `INSERT INTO dokument (vorgang_id, ebene, objekt_id, antragsschritt_id, pflichtunterlage_id,
                             dateiname, mime_typ, speicher_pfad, freigabe_rolle)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, vorgang_id, ebene, dateiname, mime_typ, geprueft, pflichtunterlage_id`,
      [
        pid.data.id,
        d.ebene,
        d.objekt_id ?? null,
        d.antragsschritt_id ?? null,
        d.pflichtunterlage_id ?? null,
        d.dateiname,
        d.mime_typ ?? null,
        d.speicher_pfad ?? null,
        d.freigabe_rolle ?? null,
      ],
    );
    res.status(201).json(dok);
  } catch (err) {
    req.log.error({ err }, "foerderpilot vorgang dokument failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** PATCH /api/foerderpilot/dokumente/:id/pruefen — Dokument als geprüft markieren */
router.patch("/foerderpilot/dokumente/:id/pruefen", async (req, res): Promise<void> => {
  const pid = IdParam.safeParse(req.params);
  if (!pid.success) {
    res.status(400).json({ error: "Ungültige Dokument-ID" });
    return;
  }
  try {
    const dok = await fpQueryOne<Dokument>(
      "UPDATE dokument SET geprueft = TRUE WHERE id = $1 RETURNING id, vorgang_id, ebene, dateiname, mime_typ, geprueft, pflichtunterlage_id",
      [pid.data.id],
    );
    if (!dok) {
      res.status(404).json({ error: "Dokument nicht gefunden" });
      return;
    }
    res.json(dok);
  } catch (err) {
    req.log.error({ err }, "foerderpilot dokument pruefen failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/foerderpilot/vorgaenge/:id/checkliste — Pflichtunterlagen-Abgleich.
 * Zeigt, welche Pflichtunterlagen des Programms noch fehlen.
 */
router.get("/foerderpilot/vorgaenge/:id/checkliste", async (req, res): Promise<void> => {
  const pid = IdParam.safeParse(req.params);
  if (!pid.success) {
    res.status(400).json({ error: "Ungültige Vorgang-ID" });
    return;
  }

  try {
    const rows = await fpQuery<{
      id: string;
      bezeichnung: string;
      pflicht: boolean;
      vorhanden: boolean;
      geprueft: boolean;
    }>(
      `SELECT pu.id, pu.bezeichnung, pu.pflicht,
              EXISTS(SELECT 1 FROM dokument d WHERE d.vorgang_id = $1 AND d.pflichtunterlage_id = pu.id) AS vorhanden,
              EXISTS(SELECT 1 FROM dokument d WHERE d.vorgang_id = $1 AND d.pflichtunterlage_id = pu.id AND d.geprueft) AS geprueft
       FROM pflichtunterlage pu
       JOIN vorgang v ON v.programm_id = pu.programm_id
       WHERE v.id = $1
       ORDER BY pu.pflicht DESC, pu.bezeichnung`,
      [pid.data.id],
    );
    const offen = rows.filter((r) => r.pflicht && !r.geprueft).length;
    res.json({ ausweis_vollstaendig: offen === 0, offen, unterlagen: rows });
  } catch (err) {
    req.log.error({ err }, "foerderpilot vorgang checkliste failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ----------------------------- Exposé ----------------------------- */

const ExposeBody = z.object({
  objekt_id: z.string().uuid().optional(),
  organisation_id: z.string().uuid().optional(),
  titel: z.string().min(1),
  wohnflaeche_m2: z.number().nonnegative().optional(),
  zimmer: z.number().nonnegative().optional(),
  kaufpreis_eur: z.number().nonnegative().optional(),
  energie_kennwert_kwh_m2a: z.number().nonnegative().optional(),
  energie_klasse: z.string().optional(),
  energietraeger: z.string().optional(),
  beschreibung: z.string().optional(),
});

/**
 * Erzeugt einen einfachen, sachlichen Exposé-Fließtext aus den Eckdaten.
 * Bewusst regelbasiert (kein LLM nötig).
 */
function baueBeschreibung(e: z.infer<typeof ExposeBody>): string {
  const teile: string[] = [];
  teile.push(`${e.titel}.`);
  if (e.wohnflaeche_m2)
    teile.push(
      `Die Wohnfläche beträgt ca. ${e.wohnflaeche_m2} m²${e.zimmer ? ` auf ${e.zimmer} Zimmer` : ""}.`,
    );
  if (e.kaufpreis_eur)
    teile.push(`Der Kaufpreis liegt bei ${e.kaufpreis_eur.toLocaleString("de-DE")} €.`);
  if (e.energie_kennwert_kwh_m2a || e.energie_klasse) {
    const k = e.energie_kennwert_kwh_m2a ? `${e.energie_kennwert_kwh_m2a} kWh/(m²·a)` : "";
    const kl = e.energie_klasse ? `Effizienzklasse ${e.energie_klasse}` : "";
    teile.push(
      `Energetische Angaben: ${[k, kl].filter(Boolean).join(", ")}${
        e.energietraeger ? `, Energieträger ${e.energietraeger}` : ""
      }.`,
    );
  }
  return teile.join(" ");
}

/**
 * POST /api/foerderpilot/expose — Exposé anlegen. Erzeugt automatisch einen
 * Beschreibungstext, falls keiner mitgegeben wird. Energetische Pflichtangaben
 * werden mit erfasst.
 */
router.post("/foerderpilot/expose", async (req, res): Promise<void> => {
  const b = ExposeBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: "Ungültige Exposé-Daten", details: b.error.issues });
    return;
  }
  const e = b.data;

  // Pflichtangaben-Hinweis: Energieausweis-Kennwerte sind in Immobilienanzeigen vorgeschrieben.
  const fehlendePflicht: string[] = [];
  if (!e.energie_kennwert_kwh_m2a && !e.energie_klasse)
    fehlendePflicht.push("Energiekennwert/Effizienzklasse");
  if (!e.energietraeger) fehlendePflicht.push("wesentlicher Energieträger");

  const beschreibung = e.beschreibung ?? baueBeschreibung(e);

  try {
    const expose = await fpQueryOne<Expose>(
      `INSERT INTO expose (objekt_id, organisation_id, titel, wohnflaeche_m2, zimmer,
                           kaufpreis_eur, energie_kennwert_kwh_m2a, energie_klasse,
                           energietraeger, beschreibung)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, objekt_id, titel, status, wohnflaeche_m2, zimmer, kaufpreis_eur,
                 energie_kennwert_kwh_m2a, energie_klasse, energietraeger, beschreibung`,
      [
        e.objekt_id ?? null,
        e.organisation_id ?? null,
        e.titel,
        e.wohnflaeche_m2 ?? null,
        e.zimmer ?? null,
        e.kaufpreis_eur ?? null,
        e.energie_kennwert_kwh_m2a ?? null,
        e.energie_klasse ?? null,
        e.energietraeger ?? null,
        beschreibung,
      ],
    );

    res.status(201).json({
      expose,
      pflichtangaben_hinweis: fehlendePflicht.length
        ? `Achtung: In Immobilienanzeigen sind diese Angaben vorgeschrieben und fehlen noch: ${fehlendePflicht.join(", ")}.`
        : "Alle energetischen Pflichtangaben vorhanden.",
    });
  } catch (err) {
    req.log.error({ err }, "foerderpilot expose create failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /api/foerderpilot/expose/:id — Exposé abrufen */
router.get("/foerderpilot/expose/:id", async (req, res): Promise<void> => {
  const pid = IdParam.safeParse(req.params);
  if (!pid.success) {
    res.status(400).json({ error: "Ungültige Exposé-ID" });
    return;
  }
  try {
    const expose = await fpQueryOne<Expose>(
      `SELECT id, objekt_id, titel, status, wohnflaeche_m2, zimmer, kaufpreis_eur,
              energie_kennwert_kwh_m2a, energie_klasse, energietraeger, beschreibung
       FROM expose WHERE id = $1`,
      [pid.data.id],
    );
    if (!expose) {
      res.status(404).json({ error: "Exposé nicht gefunden" });
      return;
    }
    res.json(expose);
  } catch (err) {
    req.log.error({ err }, "foerderpilot expose detail failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/foerderpilot/expose/aus-objekt/:objektId — Exposé direkt aus einem
 * Objekt vorbefüllen. Brücke Objekt → Exposé.
 */
router.post("/foerderpilot/expose/aus-objekt/:objektId", async (req, res): Promise<void> => {
  const p = z.object({ objektId: z.string().uuid() }).safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Ungültige Objekt-ID" });
    return;
  }

  try {
    const objekt = await fpQueryOne<{
      bezeichnung: string;
      wohneinheiten: number | null;
      organisation_id: string | null;
    }>("SELECT bezeichnung, wohneinheiten, organisation_id FROM foerderobjekt WHERE id = $1", [
      p.data.objektId,
    ]);
    if (!objekt) {
      res.status(404).json({ error: "Objekt nicht gefunden" });
      return;
    }

    const titel = `${objekt.bezeichnung} — Exposé`;
    const beschreibung = baueBeschreibung({ titel });
    const expose = await fpQueryOne<Expose>(
      `INSERT INTO expose (objekt_id, organisation_id, titel, beschreibung)
       VALUES ($1,$2,$3,$4)
       RETURNING id, objekt_id, titel, status, wohnflaeche_m2, zimmer, kaufpreis_eur,
                 energie_kennwert_kwh_m2a, energie_klasse, energietraeger, beschreibung`,
      [p.data.objektId, objekt.organisation_id, titel, beschreibung],
    );
    res.status(201).json({
      expose,
      hinweis:
        "Exposé-Entwurf aus Objektdaten erstellt. Energetische Pflichtangaben vor Veröffentlichung ergänzen.",
    });
  } catch (err) {
    req.log.error({ err }, "foerderpilot expose aus-objekt failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
