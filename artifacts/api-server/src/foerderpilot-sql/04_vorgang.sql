-- ============================================================================
--  FÖRDERSCHIENE — Erweiterung: Vorgänge, Dokumente, B2B2C, Exposé
--  (intern weiterhin Schema "foerderpilot")
--
--  Übernimmt die cleversten Muster der Plattform Facilioo und überträgt sie
--  auf den Förder-Funnel:
--    • Multi-Channel-Eingang in EINEN Vorgang (E-Mail/WhatsApp/Telefon/Web)
--    • automatische, kontextbezogene Dokumentenzuordnung (Objekt/Vorgang/Schritt)
--    • Vorgangsmanagement mit Status & Freigabe
--    • B2B2C-Organisationsebene (Hausverwaltung/Bestandshalter/Makler) mit
--      vielen Objekten und vielen parallelen Förder-Vorgängen
--    • Makler-Exposé-Anbindung (PLANFLUX-Stil) als eigener Baustein
--
--  Voraussetzung: 01_schema.sql ist eingespielt (Basis-Katalog in `public`).
--  Idempotent: legt Typen/Tabellen nur an, wenn nicht vorhanden.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. B2B2C-ORGANISATIONEN (Hausverwaltung, Bestandshalter, Makler)
--    Die wiederkehrenden Profi-Nutzer mit vielen Objekten/Vorgängen.
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE organisation_typ AS ENUM (
    'hausverwaltung', 'bestandshalter', 'makler', 'energieberatung', 'sonstige'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS organisation (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    typ           organisation_typ NOT NULL,
    region        bundesland,
    -- Anzahl verwalteter Einheiten (für Funnel-/Volumeneinschätzung)
    einheiten_ca  INTEGER,
    aktiv         BOOLEAN NOT NULL DEFAULT TRUE,
    erstellt_am   TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE organisation IS 'B2B2C-Profikunden: Hausverwaltungen, Bestandshalter, Makler. Wiederkehrende Nutzer mit vielen Vorgängen.';

-- Nutzer können zu einer Organisation gehören (Mitarbeiter der Verwaltung etc.)
ALTER TABLE nutzer ADD COLUMN IF NOT EXISTS organisation_id UUID REFERENCES organisation(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 2. OBJEKTE (Immobilien der Organisation)
--    Eine Hausverwaltung/ein Makler bündelt Förder-Vorgänge je Objekt.
--    Verknüpfbar mit dem energieausweis.gebaeude (falls Modul vorhanden).
-- ----------------------------------------------------------------------------
-- Heißt "foerderobjekt" (nicht "objekt"), weil im public-Schema bereits die
-- enerwatt24-Tabelle "objekt" existiert — Namenskollision vermeiden.
CREATE TABLE IF NOT EXISTS foerderobjekt (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID REFERENCES organisation(id) ON DELETE CASCADE,
    bezeichnung     TEXT NOT NULL,              -- z. B. "MFH Kanzlerstr. 8"
    strasse         TEXT, plz TEXT, ort TEXT,
    bundesland      bundesland,
    baujahr         INTEGER,
    wohneinheiten   INTEGER,
    -- optionale Brücke zum Energieausweis-Modul
    gebaeude_id     UUID,                       -- energieausweis.gebaeude(id), lose gekoppelt
    erstellt_am     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_foerderobjekt_org ON foerderobjekt(organisation_id);

-- ----------------------------------------------------------------------------
-- 3. VORGANG (zentrale Facilioo-Übernahme)
--    Ein Förder-Vorgang bündelt: Programm + (optional) Objekt + Beteiligte +
--    Multi-Channel-Nachrichten + Dokumente + Status. Ersetzt nicht
--    nutzer_programm, sondern hebt es auf B2B2C-Niveau (mit Objektbezug).
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE vorgang_status AS ENUM (
    'neu', 'in_pruefung', 'unterlagen_offen', 'antrag_gestellt',
    'bewilligt', 'abgelehnt', 'abgeschlossen'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS vorgang (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID REFERENCES organisation(id) ON DELETE SET NULL,
    objekt_id       UUID REFERENCES foerderobjekt(id) ON DELETE SET NULL,
    programm_id     UUID REFERENCES programm(id) ON DELETE SET NULL,
    nutzer_id       UUID REFERENCES nutzer(id) ON DELETE SET NULL,  -- verantwortlich
    berater_id      UUID REFERENCES berater(id) ON DELETE SET NULL, -- zugeordnet
    titel           TEXT NOT NULL,
    status          vorgang_status NOT NULL DEFAULT 'neu',
    faellig_am      DATE,
    erstellt_am     TIMESTAMPTZ NOT NULL DEFAULT now(),
    aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vorgang_org ON vorgang(organisation_id);
CREATE INDEX IF NOT EXISTS idx_vorgang_status ON vorgang(status);
CREATE INDEX IF NOT EXISTS idx_vorgang_objekt ON vorgang(objekt_id);
COMMENT ON TABLE vorgang IS 'Förder-Vorgang als zentrale Einheit (Facilioo-Muster): bündelt Programm, Objekt, Beteiligte, Nachrichten, Dokumente, Status.';

-- ----------------------------------------------------------------------------
-- 4. MULTI-CHANNEL-NACHRICHTEN (alle Kanäle in EINEN Vorgang)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE nachricht_kanal AS ENUM ('web', 'email', 'whatsapp', 'telefon', 'post', 'intern');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS vorgang_nachricht (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vorgang_id    UUID NOT NULL REFERENCES vorgang(id) ON DELETE CASCADE,
    kanal         nachricht_kanal NOT NULL,
    richtung      TEXT NOT NULL DEFAULT 'eingehend' CHECK (richtung IN ('eingehend','ausgehend')),
    von           TEXT,                         -- Absenderkennung (E-Mail/Telefonnr.)
    inhalt        TEXT,
    erstellt_am   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nachricht_vorgang ON vorgang_nachricht(vorgang_id);
COMMENT ON TABLE vorgang_nachricht IS 'Multi-Channel-Eingang: E-Mail/WhatsApp/Telefon/Post/Web laufen in EINEN Vorgang (Facilioo-Muster).';

-- ----------------------------------------------------------------------------
-- 5. DOKUMENTE MIT KONTEXTZUORDNUNG (Facilioo-Kernidee)
--    Jedes Dokument wird automatisch der richtigen Ebene zugeordnet:
--    Organisation / Objekt / Vorgang / konkreter Antragsschritt /
--    Pflichtunterlage. Rollenbasierte Freigabe + Prüfstatus.
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE dokument_ebene AS ENUM ('organisation', 'objekt', 'vorgang', 'antragsschritt', 'pflichtunterlage');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS dokument (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vorgang_id       UUID REFERENCES vorgang(id) ON DELETE CASCADE,
    -- Kontext-Zuordnung: auf welcher Ebene "hängt" das Dokument?
    ebene            dokument_ebene NOT NULL DEFAULT 'vorgang',
    objekt_id        UUID REFERENCES foerderobjekt(id) ON DELETE SET NULL,
    antragsschritt_id UUID REFERENCES antragsschritt(id) ON DELETE SET NULL,
    pflichtunterlage_id UUID REFERENCES pflichtunterlage(id) ON DELETE SET NULL,
    -- Datei
    dateiname        TEXT NOT NULL,
    mime_typ         TEXT,
    speicher_pfad    TEXT,                       -- URL/Pfad zum Blob-Storage
    -- Workflow
    geprueft         BOOLEAN NOT NULL DEFAULT FALSE,
    freigabe_rolle   TEXT,                       -- welche Rolle darf sehen ('eigentuemer','berater','alle')
    erstellt_am      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dokument_vorgang ON dokument(vorgang_id);
CREATE INDEX IF NOT EXISTS idx_dokument_pflicht ON dokument(pflichtunterlage_id);
COMMENT ON TABLE dokument IS 'Kontextbezogene Dokumentenzuordnung (Facilioo-Muster): Dokument hängt an Objekt/Vorgang/Schritt/Pflichtunterlage, mit Prüfstatus und rollenbasierter Freigabe.';

-- ----------------------------------------------------------------------------
-- 6. MAKLER-EXPOSÉ (PLANFLUX-Stil)
--    Eigener Baustein für die Zielgruppe Makler: aus Objektdaten ein
--    strukturiertes Exposé erzeugen. Lose an objekt gekoppelt.
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE expose_status AS ENUM ('entwurf', 'fertig', 'veroeffentlicht');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS expose (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    objekt_id       UUID REFERENCES foerderobjekt(id) ON DELETE CASCADE,
    organisation_id UUID REFERENCES organisation(id) ON DELETE SET NULL,
    titel           TEXT NOT NULL,
    status          expose_status NOT NULL DEFAULT 'entwurf',
    -- Eckdaten (teils aus objekt/energieausweis übernommen)
    wohnflaeche_m2  NUMERIC(10,2),
    zimmer          NUMERIC(4,1),
    kaufpreis_eur   NUMERIC(12,2),
    -- energetische Felder (Pflichtangaben in Immobilienanzeigen!)
    energie_kennwert_kwh_m2a NUMERIC(8,2),
    energie_klasse  TEXT,
    energietraeger  TEXT,
    -- generierter Fließtext (z. B. via Dokument-Assistent)
    beschreibung    TEXT,
    erstellt_am     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expose_objekt ON expose(objekt_id);
COMMENT ON TABLE expose IS 'Makler-Exposé (PLANFLUX-Stil): strukturiertes Exposé aus Objektdaten inkl. energetischer Pflichtangaben.';

-- ----------------------------------------------------------------------------
-- 7. TRIGGER: aktualisiert_am beim Vorgang pflegen
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_vorgang_aktualisiert() RETURNS trigger AS $$
BEGIN NEW.aktualisiert_am = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vorgang_update ON vorgang;
CREATE TRIGGER trg_vorgang_update
    BEFORE UPDATE ON vorgang
    FOR EACH ROW EXECUTE FUNCTION set_vorgang_aktualisiert();

-- ----------------------------------------------------------------------------
-- 8. VIEW: Vorgangs-Übersicht mit Dokument-Vollständigkeit
--    Der wunde Punkt im Förderprozess: sind alle Pflichtunterlagen da?
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_vorgang_uebersicht AS
SELECT
    v.id, v.titel, v.status, v.faellig_am,
    o.name AS organisation, o.typ AS organisation_typ,
    ob.bezeichnung AS objekt,
    p.titel AS programm,
    -- Pflichtunterlagen-Soll (aus dem Programm)
    (SELECT count(*) FROM pflichtunterlage pu WHERE pu.programm_id = v.programm_id AND pu.pflicht) AS pflicht_soll,
    -- Pflichtunterlagen-Ist (geprüfte Dokumente, die einer Pflichtunterlage zugeordnet sind)
    (SELECT count(DISTINCT d.pflichtunterlage_id) FROM dokument d
       WHERE d.vorgang_id = v.id AND d.pflichtunterlage_id IS NOT NULL AND d.geprueft) AS pflicht_ist,
    (SELECT count(*) FROM vorgang_nachricht n WHERE n.vorgang_id = v.id) AS nachrichten,
    v.aktualisiert_am
FROM vorgang v
LEFT JOIN organisation o ON o.id = v.organisation_id
LEFT JOIN foerderobjekt ob ON ob.id = v.objekt_id
LEFT JOIN programm p ON p.id = v.programm_id;

-- ----------------------------------------------------------------------------
-- 9. SEED-BEISPIEL: eine Hausverwaltung mit Objekt + Vorgang
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_org UUID; v_obj UUID; v_prog UUID; v_vorg UUID;
BEGIN
  -- nur seeden, wenn noch keine Organisation existiert
  IF NOT EXISTS (SELECT 1 FROM organisation LIMIT 1) THEN
    INSERT INTO organisation (name, typ, region, einheiten_ca)
    VALUES ('Muster Hausverwaltung GmbH', 'hausverwaltung', 'nordrhein_westfalen', 850)
    RETURNING id INTO v_org;

    INSERT INTO foerderobjekt (organisation_id, bezeichnung, strasse, plz, ort, bundesland, baujahr, wohneinheiten)
    VALUES (v_org, 'MFH Kanzlerstr. 8', 'Kanzlerstr. 8', '47119', 'Duisburg', 'nordrhein_westfalen', NULL, 6)
    RETURNING id INTO v_obj;

    SELECT id INTO v_prog FROM programm WHERE titel ILIKE 'BEG%Gebäudehülle%' LIMIT 1;

    INSERT INTO vorgang (organisation_id, objekt_id, programm_id, titel, status)
    VALUES (v_org, v_obj, v_prog, 'Fassadendämmung Kanzlerstr. 8', 'unterlagen_offen')
    RETURNING id INTO v_vorg;

    INSERT INTO vorgang_nachricht (vorgang_id, kanal, richtung, von, inhalt) VALUES
      (v_vorg, 'email', 'eingehend', 'eigentuemer@example.com', 'Bitte um Förderprüfung für die Fassade.'),
      (v_vorg, 'whatsapp', 'eingehend', '+49170...', 'Anbei das Foto der Außenwand.');
  END IF;
END $$;

-- ============================================================================
--  Beispielabfragen:
--   SELECT * FROM v_vorgang_uebersicht;          -- Vorgänge inkl. Doku-Vollständigkeit
--   SELECT typ, count(*) FROM organisation GROUP BY typ;
-- ============================================================================
