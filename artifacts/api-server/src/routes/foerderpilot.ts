import { Router, type IRouter } from "express";
import { z } from "zod";
import { fpQuery, fpQueryOne } from "../lib/foerderpilotDb";

/**
 * Förderpilot — the imported standalone funding catalog, ported from Fastify to
 * Express. Mounted under `/api/foerderpilot/...` so it never collides with the
 * existing Förderschiene routes (`/api/foerderschiene/...`). All SQL is
 * parameterized; the data lives in the standard `public` schema (Replit's
 * publish pipeline only supports `public`, so no custom schema is used).
 */

const router: IRouter = Router();

type ProgrammVoll = {
  id: string;
  titel: string;
  foerdergeber: string;
  ebene: string;
  art: string;
  timing: string;
  foerderquote_text: string | null;
  quote_min: number | null;
  quote_max: number | null;
  max_betrag_text: string | null;
  max_betrag_eur: number | null;
  kurzbeschreibung: string | null;
  besonderheit: string | null;
  quelle_url: string | null;
  quelle_stand: string | null;
  status: string;
  aktiv: boolean;
  kategorien: string[];
  zielgruppen: string[];
  regionen: string[];
  erfolgsquote: number | null;
};

/* ----------------------------- Finder ----------------------------- */

const FinderQuery = z.object({
  ebene: z.enum(["bund", "land", "eu", "kommune"]).optional(),
  art: z
    .enum(["zuschuss", "kredit", "buergschaft", "beteiligung", "beratung", "steuer"])
    .optional(),
  timing: z
    .enum(["vor_vorhabenbeginn", "laufend", "stichtag_call", "budget_topf"])
    .optional(),
  status: z.enum(["verifiziert", "zu_pruefen", "veraltet"]).optional(),
  kategorie: z.string().optional(),
  zielgruppe: z.string().optional(),
  region: z.string().optional(),
  suche: z.string().optional(),
  nur_aktiv: z.union([z.literal("true"), z.literal("false")]).optional().default("true"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get("/foerderpilot/programme", async (req, res): Promise<void> => {
  const parsed = FinderQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültige Filter", details: parsed.error.issues });
    return;
  }
  const f = parsed.data;

  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  if (f.nur_aktiv === "true") where.push("vp.aktiv");
  if (f.ebene) where.push(`vp.ebene = ${p(f.ebene)}`);
  if (f.art) where.push(`vp.art = ${p(f.art)}`);
  if (f.timing) where.push(`vp.timing = ${p(f.timing)}`);
  if (f.status) where.push(`vp.status = ${p(f.status)}`);
  // kategorie/zielgruppe filters arrive as SLUGS, but v_programm_voll aggregates
  // display NAMES — so resolve slugs via the junction tables instead of the view.
  if (f.kategorie) {
    where.push(
      `vp.id IN (SELECT pk.programm_id FROM programm_kategorie pk
                 JOIN kategorie k ON k.id = pk.kategorie_id WHERE k.slug = ${p(f.kategorie)})`,
    );
  }
  if (f.zielgruppe) {
    where.push(
      `vp.id IN (SELECT pz.programm_id FROM programm_zielgruppe pz
                 JOIN zielgruppe zg ON zg.id = pz.zielgruppe_id WHERE zg.slug = ${p(f.zielgruppe)})`,
    );
  }
  if (f.region)
    where.push(
      `(${p(f.region)} = ANY(vp.regionen) OR 'bundesweit' = ANY(vp.regionen))`,
    );
  if (f.suche) {
    where.push(
      `(vp.titel ILIKE '%' || ${p(f.suche)} || '%' OR vp.kurzbeschreibung ILIKE '%' || ${p(
        f.suche,
      )} || '%')`,
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const countRows = await fpQuery<{ total: string }>(
      `SELECT count(*)::text AS total FROM v_programm_voll vp ${whereSql}`,
      params,
    );
    const total = Number(countRows[0]?.total ?? 0);

    const rows = await fpQuery<ProgrammVoll>(
      `SELECT * FROM v_programm_voll vp
       ${whereSql}
       ORDER BY (vp.status = 'verifiziert') DESC,
                vp.erfolgsquote DESC NULLS LAST,
                vp.titel ASC
       LIMIT ${p(f.limit)} OFFSET ${p(f.offset)}`,
      params,
    );

    res.json({ total, limit: f.limit, offset: f.offset, anzahl: rows.length, programme: rows });
  } catch (err) {
    req.log.error({ err }, "foerderpilot finder failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/foerderpilot/filter-optionen", async (req, res): Promise<void> => {
  // Optional category scope: when given, the Zielgruppen are restricted to groups
  // that can actually apply to an ACTIVE program WITHIN that category — so the
  // dropdown never offers a target group with zero matching programs (e.g. an
  // imported group like `makler` that no program is assigned to).
  const kategorie = typeof req.query.kategorie === "string" ? req.query.kategorie : undefined;
  const zielgruppenSql = kategorie
    ? `SELECT DISTINCT zg.slug, zg.name
         FROM zielgruppe zg
         JOIN programm_zielgruppe pz ON pz.zielgruppe_id = zg.id
         JOIN programm pr ON pr.id = pz.programm_id AND pr.aktiv
         JOIN programm_kategorie pk ON pk.programm_id = pr.id
         JOIN kategorie k ON k.id = pk.kategorie_id AND k.slug = $1
        ORDER BY zg.name`
    : `SELECT DISTINCT zg.slug, zg.name
         FROM zielgruppe zg
         JOIN programm_zielgruppe pz ON pz.zielgruppe_id = zg.id
         JOIN programm pr ON pr.id = pz.programm_id AND pr.aktiv
        ORDER BY zg.name`;
  try {
    const [kategorien, zielgruppen, regionRows] = await Promise.all([
      fpQuery<{ slug: string; name: string }>("SELECT slug, name FROM kategorie ORDER BY name"),
      fpQuery<{ slug: string; name: string }>(zielgruppenSql, kategorie ? [kategorie] : []),
      fpQuery<{ region: string }>(
        "SELECT DISTINCT region::text AS region FROM programm_region ORDER BY 1",
      ),
    ]);
    res.json({
      ebene: ["bund", "land", "eu", "kommune"],
      art: ["zuschuss", "kredit", "buergschaft", "beteiligung", "beratung", "steuer"],
      timing: ["vor_vorhabenbeginn", "laufend", "stichtag_call", "budget_topf"],
      status: ["verifiziert", "zu_pruefen", "veraltet"],
      kategorien,
      zielgruppen,
      regionen: regionRows.map((r) => r.region),
    });
  } catch (err) {
    req.log.error({ err }, "foerderpilot filter-optionen failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ----------------------------- Detail ----------------------------- */

const IdParam = z.object({ id: z.string().uuid() });

router.get("/foerderpilot/programme/:id", async (req, res): Promise<void> => {
  const parsed = IdParam.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültige Programm-ID" });
    return;
  }
  const { id } = parsed.data;

  try {
    const programm = await fpQueryOne<ProgrammVoll>(
      "SELECT * FROM v_programm_voll WHERE id = $1",
      [id],
    );
    if (!programm) {
      res.status(404).json({ error: "Programm nicht gefunden" });
      return;
    }

    const [schritte, faktoren, unterlagen, berater] = await Promise.all([
      fpQuery(
        `SELECT reihenfolge, titel, beschreibung, aufwand_text, frist_bezug,
                erfordert_dokument_typ, erfordert_berater
         FROM antragsschritt WHERE programm_id = $1 ORDER BY reihenfolge`,
        [id],
      ),
      fpQuery<{ typ: string; text: string; gewicht: number }>(
        `SELECT typ, text, gewicht FROM erfolgsfaktor
         WHERE programm_id = $1 ORDER BY gewicht DESC`,
        [id],
      ),
      fpQuery(`SELECT bezeichnung, pflicht FROM pflichtunterlage WHERE programm_id = $1`, [id]),
      fpQuery(
        `SELECT b.id, b.name, b.qualifikation, b.region::text, b.bewertung
         FROM berater b
         JOIN berater_programm bp ON bp.berater_id = b.id
         WHERE bp.programm_id = $1 AND b.aktiv
         ORDER BY b.bewertung DESC NULLS LAST`,
        [id],
      ),
    ]);

    res.json({
      ...programm,
      antragspfad: schritte,
      erfolgsfaktoren: faktoren.filter((fk) => fk.typ === "erfolgsfaktor"),
      ablehnungsgruende: faktoren.filter((fk) => fk.typ === "ablehnungsgrund"),
      pflichtunterlagen: unterlagen,
      berater,
    });
  } catch (err) {
    req.log.error({ err }, "foerderpilot detail failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/foerderpilot/programme/:id/antragspfad", async (req, res): Promise<void> => {
  const parsed = IdParam.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültige Programm-ID" });
    return;
  }
  try {
    const schritte = await fpQuery(
      `SELECT reihenfolge, titel, beschreibung, aufwand_text, frist_bezug,
              erfordert_dokument_typ, erfordert_berater
       FROM antragsschritt WHERE programm_id = $1 ORDER BY reihenfolge`,
      [parsed.data.id],
    );
    res.json({ programm_id: parsed.data.id, schritte });
  } catch (err) {
    req.log.error({ err }, "foerderpilot antragspfad failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* --------------------------- Matching ----------------------------- */

const MatchBody = z.object({
  zielgruppe: z.string().optional(),
  region: z.string().optional(),
  kategorien: z.array(z.string()).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

router.post("/foerderpilot/match", async (req, res): Promise<void> => {
  const parsed = MatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültiges Profil", details: parsed.error.issues });
    return;
  }
  const { zielgruppe, region, kategorien, limit } = parsed.data;

  const where: string[] = ["vp.aktiv"];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  if (zielgruppe) {
    // zielgruppe arrives as a SLUG — resolve via the junction table (the view
    // aggregates display NAMES, so `= ANY(vp.zielgruppen)` on a slug never matches).
    where.push(
      `vp.id IN (SELECT pz.programm_id FROM programm_zielgruppe pz
                 JOIN zielgruppe zg ON zg.id = pz.zielgruppe_id WHERE zg.slug = ${p(zielgruppe)})`,
    );
  }
  if (region) {
    where.push(`(${p(region)} = ANY(vp.regionen) OR 'bundesweit' = ANY(vp.regionen))`);
  }
  if (kategorien && kategorien.length > 0) {
    // kategorien arrive as SLUGS — resolve via the junction table (view stores names).
    where.push(
      `vp.id IN (SELECT pk.programm_id FROM programm_kategorie pk
                 JOIN kategorie k ON k.id = pk.kategorie_id WHERE k.slug = ANY(${p(kategorien)}::text[]))`,
    );
  }

  try {
    const rows = await fpQuery<ProgrammVoll>(
      `SELECT * FROM v_programm_voll vp
       WHERE ${where.join(" AND ")}
       ORDER BY (vp.status = 'verifiziert') DESC,
                vp.erfolgsquote DESC NULLS LAST,
                vp.titel ASC
       LIMIT ${p(limit)}`,
      params,
    );
    res.json({ profil: { zielgruppe, region, kategorien }, anzahl: rows.length, treffer: rows });
  } catch (err) {
    req.log.error({ err }, "foerderpilot match failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
