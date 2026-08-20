-- ============================================================================
--  FÖRDERPILOT — PostgreSQL-Schema
--  Abgeleitet aus der Klassifikationsstruktur (Blatt »Klassifikation«).
--  Stand: Juni 2026 · PostgreSQL 14+
--
--  Aufbau:
--    1. ENUM-Typen          (die 6 Klassifikationsachsen + Status)
--    2. Stammtabellen       (programme, foerdergeber)
--    3. Mehrfachzuordnungen (Kategorien, Zielgruppen, Regionen — n:m)
--    4. Anreicherungsschicht(antragsschritte, ablehnungsgruende, dokumente, berater)
--    5. Nutzer & Matching   (profile, gespeicherte Programme, Fristen)
--    6. Indizes, Trigger, Views
--    7. Seed-Beispieldaten  (auskommentiert am Ende)
--
--  Designprinzip: Amtliche Stammdaten (programme) sind sauber getrennt von der
--  redaktionellen Anreicherungsschicht — letztere ist der Burggraben und frei
--  von Dritt-Lizenzrisiken.
-- ============================================================================

BEGIN;

-- Alle Objekte leben im PUBLIC-Schema: die Replit-Publish-Pipeline kopiert
-- beim Veröffentlichen nur das public-Schema in die Produktionsdatenbank —
-- ein eigenes Schema (früher "foerderpilot") lässt den Publish-Build mit
-- pg_restore-Fehlern abbrechen. Die gesamte Datei läuft in EINER Transaktion
-- (BEGIN/COMMIT), daher hinterlässt ein Fehlschlag keine halben Objekte.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- für gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- für Volltext-/Fuzzy-Suche

-- ============================================================================
-- 1. ENUM-TYPEN — die Klassifikationsachsen
-- ============================================================================

-- Achse 1: Förderebene (wer fördert)
CREATE TYPE ebene AS ENUM ('bund', 'land', 'eu', 'kommune');

-- Achse 2: Förderart (wie wird gefördert)
CREATE TYPE foerderart AS ENUM (
    'zuschuss',
    'kredit',
    'buergschaft',
    'beteiligung',
    'beratung',
    'steuer'
);

-- Achse 6: Antrags-Timing (kritisch für Erfolgswahrscheinlichkeit)
CREATE TYPE antrags_timing AS ENUM (
    'vor_vorhabenbeginn',   -- zwingend vorab; häufigster Ablehnungsgrund
    'laufend',              -- kein Stichtag
    'stichtag_call',        -- feste Einreichfristen (v. a. EU)
    'budget_topf'           -- bis erschöpft (Windhundprinzip)
);

-- Redaktioneller Prüfstatus eines Datensatzes
CREATE TYPE pruef_status AS ENUM ('verifiziert', 'zu_pruefen', 'veraltet');

-- Die 16 Bundesländer + Sonderausprägungen (Achse 5: Region)
CREATE TYPE bundesland AS ENUM (
    'baden_wuerttemberg','bayern','berlin','brandenburg','bremen','hamburg',
    'hessen','mecklenburg_vorpommern','niedersachsen','nordrhein_westfalen',
    'rheinland_pfalz','saarland','sachsen','sachsen_anhalt','schleswig_holstein',
    'thueringen',
    'bundesweit','eu_weit','foerdergebiet_grw'
);

-- ============================================================================
-- 2. STAMMTABELLEN
-- ============================================================================

-- Achse 3: Förderbereich / Kategorie — als Tabelle (erweiterbar ohne Migration)
CREATE TABLE kategorie (
    id          SMALLSERIAL PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,         -- z. B. 'energie_gebaeude'
    name        TEXT NOT NULL,                -- z. B. 'Energie & Gebäude'
    beschreibung TEXT
);

-- Achse 4: Zielgruppe / Berufsgruppe — ebenfalls als Tabelle
CREATE TABLE zielgruppe (
    id          SMALLSERIAL PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,         -- z. B. 'kmu_klein'
    name        TEXT NOT NULL,
    beschreibung TEXT
);

-- Fördergeber (BAFA, KfW, IBB, EU/CINEA …)
CREATE TABLE foerdergeber (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    kurzname    TEXT,
    ebene       ebene NOT NULL,
    website     TEXT
);

-- Zentrale Programmtabelle (amtliche Stammdaten)
CREATE TABLE programm (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titel               TEXT NOT NULL,
    foerdergeber_id     INTEGER NOT NULL REFERENCES foerdergeber(id),

    -- Klassifikationsachsen (Einzelwerte)
    ebene               ebene NOT NULL,
    art                 foerderart NOT NULL,
    timing              antrags_timing NOT NULL,

    -- Förderkonditionen
    foerderquote_text   TEXT,                 -- frei: "30 % + Boni, max. 70 %"
    quote_min           NUMERIC(5,2),         -- maschinell filterbar: 30.00
    quote_max           NUMERIC(5,2),         -- 70.00
    max_betrag_text     TEXT,                 -- "max. 30.000 €/WE → 21.000 € Zuschuss"
    max_betrag_eur      BIGINT,               -- maschinell: 21000 (für Sortierung/Filter)

    -- Inhalt
    kurzbeschreibung    TEXT,
    besonderheit        TEXT,                  -- Hinweise, Fallstricke auf Programmebene

    -- Quelle & Vertrauen (Transparenzpflicht aus dem Konzept)
    quelle_url          TEXT,
    quelle_stand        DATE,                  -- Stand der Angaben
    status              pruef_status NOT NULL DEFAULT 'zu_pruefen',

    aktiv               BOOLEAN NOT NULL DEFAULT TRUE,  -- Programm noch offen?
    erstellt_am         TIMESTAMPTZ NOT NULL DEFAULT now(),
    aktualisiert_am     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT quote_logik CHECK (quote_min IS NULL OR quote_max IS NULL OR quote_min <= quote_max)
);

COMMENT ON TABLE  programm IS 'Amtliche Förderprogramm-Stammdaten. Anreicherung in separaten Tabellen.';
COMMENT ON COLUMN programm.status IS 'verifiziert = web-/quellengeprüft; zu_pruefen = aus Fachwissen, vor Nutzung prüfen.';

-- ============================================================================
-- 3. MEHRFACHZUORDNUNGEN (n:m) — ein Programm kann mehrere
--    Kategorien, Zielgruppen und Regionen abdecken
-- ============================================================================

CREATE TABLE programm_kategorie (
    programm_id  UUID NOT NULL REFERENCES programm(id) ON DELETE CASCADE,
    kategorie_id SMALLINT NOT NULL REFERENCES kategorie(id),
    PRIMARY KEY (programm_id, kategorie_id)
);

-- Zielgruppe mit optionaler Eignungsstufe (entspricht ●/○ der Matrix)
CREATE TYPE eignung AS ENUM ('voll', 'eingeschraenkt');
CREATE TABLE programm_zielgruppe (
    programm_id   UUID NOT NULL REFERENCES programm(id) ON DELETE CASCADE,
    zielgruppe_id SMALLINT NOT NULL REFERENCES zielgruppe(id),
    eignung       eignung NOT NULL DEFAULT 'voll',
    PRIMARY KEY (programm_id, zielgruppe_id)
);

CREATE TABLE programm_region (
    programm_id UUID NOT NULL REFERENCES programm(id) ON DELETE CASCADE,
    region      bundesland NOT NULL,
    PRIMARY KEY (programm_id, region)
);

-- ============================================================================
-- 4. ANREICHERUNGSSCHICHT (der Burggraben)
-- ============================================================================

-- Geführter Antragspfad: geordnete Schritte je Programm
CREATE TABLE antragsschritt (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programm_id     UUID NOT NULL REFERENCES programm(id) ON DELETE CASCADE,
    reihenfolge     SMALLINT NOT NULL,
    titel           TEXT NOT NULL,
    beschreibung    TEXT NOT NULL,
    aufwand_text    TEXT,                      -- "30 Min.", "1–2 Tage"
    frist_bezug     TEXT,                      -- "vor Antrag", "nach Abschluss"
    erfordert_dokument_typ TEXT,               -- referenziert dokumentvorlage.dokument_typ
    erfordert_berater BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (programm_id, reihenfolge)
);

-- Erfolgsfaktoren & typische Ablehnungsgründe
CREATE TYPE faktor_typ AS ENUM ('erfolgsfaktor', 'ablehnungsgrund');
CREATE TABLE erfolgsfaktor (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programm_id   UUID NOT NULL REFERENCES programm(id) ON DELETE CASCADE,
    typ           faktor_typ NOT NULL,
    text          TEXT NOT NULL,
    gewicht       SMALLINT DEFAULT 1           -- für Erfolgsquoten-Heuristik
);

-- Redaktionelle Erfolgswahrscheinlichkeit (klar getrennt von amtlichen Fakten)
CREATE TABLE erfolgseinschaetzung (
    programm_id   UUID PRIMARY KEY REFERENCES programm(id) ON DELETE CASCADE,
    quote_prozent SMALLINT CHECK (quote_prozent BETWEEN 0 AND 100),
    begruendung   TEXT,
    ist_redaktionell BOOLEAN NOT NULL DEFAULT TRUE,  -- Transparenz-Flag
    stand         DATE DEFAULT CURRENT_DATE
);

-- Pflichtunterlagen-Checkliste je Programm
CREATE TABLE pflichtunterlage (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programm_id   UUID NOT NULL REFERENCES programm(id) ON DELETE CASCADE,
    bezeichnung   TEXT NOT NULL,
    pflicht       BOOLEAN NOT NULL DEFAULT TRUE
);

-- Vorlagen für den Dokumenten-Assistenten
CREATE TABLE dokumentvorlage (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programm_id   UUID REFERENCES programm(id) ON DELETE CASCADE,
    dokument_typ  TEXT NOT NULL,               -- 'businessplan','vorhabenbeschreibung','de_minimis'
    titel         TEXT NOT NULL,
    felder        JSONB NOT NULL DEFAULT '[]', -- Eingabefelder für den Assistenten
    prompt_vorlage TEXT                         -- LLM-Prompt-Gerüst
);

-- Berater / Dienstleister (B2B2C-Netz)
CREATE TABLE berater (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    qualifikation TEXT,                         -- z. B. 'dena-gelistet'
    region        bundesland,
    bewertung     NUMERIC(2,1) CHECK (bewertung BETWEEN 0 AND 5),
    aktiv         BOOLEAN NOT NULL DEFAULT TRUE,
    erstellt_am   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Welcher Berater ist auf welches Programm spezialisiert (n:m)
CREATE TABLE berater_programm (
    berater_id    UUID NOT NULL REFERENCES berater(id) ON DELETE CASCADE,
    programm_id   UUID NOT NULL REFERENCES programm(id) ON DELETE CASCADE,
    PRIMARY KEY (berater_id, programm_id)
);

-- ============================================================================
-- 5. NUTZER, PROFIL-MATCHING & FRISTEN
-- ============================================================================

CREATE TABLE nutzer (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    rolle         TEXT NOT NULL DEFAULT 'nutzer'  -- 'nutzer','berater','redaktion'
                  CHECK (rolle IN ('nutzer','berater','redaktion')),
    erstellt_am   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Profil: die Antworten aus dem Förder-Schnellcheck (treibt das Matching)
CREATE TABLE nutzerprofil (
    nutzer_id     UUID PRIMARY KEY REFERENCES nutzer(id) ON DELETE CASCADE,
    zielgruppe_id SMALLINT REFERENCES zielgruppe(id),
    region        bundesland,
    interessen    SMALLINT[],                   -- kategorie.id-Array
    mitarbeiterzahl INTEGER,
    aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vom Nutzer verfolgte Programme + Antragsfortschritt
CREATE TABLE nutzer_programm (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nutzer_id     UUID NOT NULL REFERENCES nutzer(id) ON DELETE CASCADE,
    programm_id   UUID NOT NULL REFERENCES programm(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'gemerkt'
                  CHECK (status IN ('gemerkt','in_bearbeitung','beantragt','bewilligt','abgelehnt')),
    notiz         TEXT,
    erstellt_am   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (nutzer_id, programm_id)
);

-- Fristen / Erinnerungen
CREATE TABLE frist (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nutzer_programm_id UUID NOT NULL REFERENCES nutzer_programm(id) ON DELETE CASCADE,
    bezeichnung   TEXT NOT NULL,
    faellig_am    DATE NOT NULL,
    erledigt      BOOLEAN NOT NULL DEFAULT FALSE
);

-- ============================================================================
-- 6. INDIZES, TRIGGER, VIEWS
-- ============================================================================

-- Filter-Indizes (die Finder-Achsen)
CREATE INDEX idx_programm_ebene   ON programm(ebene);
CREATE INDEX idx_programm_art     ON programm(art);
CREATE INDEX idx_programm_timing  ON programm(timing);
CREATE INDEX idx_programm_status  ON programm(status);
CREATE INDEX idx_programm_aktiv   ON programm(aktiv) WHERE aktiv;
CREATE INDEX idx_pk_kategorie     ON programm_kategorie(kategorie_id);
CREATE INDEX idx_pz_zielgruppe    ON programm_zielgruppe(zielgruppe_id);
CREATE INDEX idx_pr_region        ON programm_region(region);
CREATE INDEX idx_schritt_programm ON antragsschritt(programm_id);

-- Volltextsuche über Titel/Beschreibung (Trigram, tippfehlertolerant)
CREATE INDEX idx_programm_titel_trgm ON programm USING gin (titel gin_trgm_ops);
CREATE INDEX idx_programm_besch_trgm ON programm USING gin (kurzbeschreibung gin_trgm_ops);

-- aktualisiert_am automatisch pflegen
CREATE OR REPLACE FUNCTION set_aktualisiert_am() RETURNS trigger AS $$
BEGIN NEW.aktualisiert_am = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_programm_update
    BEFORE UPDATE ON programm
    FOR EACH ROW EXECUTE FUNCTION set_aktualisiert_am();

-- View: Programm mit allen Klassifikationen aggregiert (für API/Finder)
CREATE VIEW v_programm_voll AS
SELECT
    p.id, p.titel, fg.name AS foerdergeber,
    p.ebene::text AS ebene,
    p.art::text AS art,
    p.timing::text AS timing,
    p.foerderquote_text, p.quote_min, p.quote_max,
    p.max_betrag_text, p.max_betrag_eur,
    p.kurzbeschreibung, p.besonderheit,
    p.quelle_url, p.quelle_stand, p.status::text AS status, p.aktiv,
    COALESCE(array_agg(DISTINCT k.name)  FILTER (WHERE k.name  IS NOT NULL), '{}') AS kategorien,
    COALESCE(array_agg(DISTINCT zg.name) FILTER (WHERE zg.name IS NOT NULL), '{}') AS zielgruppen,
    COALESCE(array_agg(DISTINCT pr.region::text) FILTER (WHERE pr.region IS NOT NULL), '{}') AS regionen,
    es.quote_prozent AS erfolgsquote
FROM programm p
JOIN foerdergeber fg            ON fg.id = p.foerdergeber_id
LEFT JOIN programm_kategorie pk ON pk.programm_id = p.id
LEFT JOIN kategorie k           ON k.id = pk.kategorie_id
LEFT JOIN programm_zielgruppe pz ON pz.programm_id = p.id
LEFT JOIN zielgruppe zg         ON zg.id = pz.zielgruppe_id
LEFT JOIN programm_region pr     ON pr.programm_id = p.id
LEFT JOIN erfolgseinschaetzung es ON es.programm_id = p.id
GROUP BY p.id, fg.name, es.quote_prozent;

-- View: einfaches Profil-Matching (Programme passend zu einem Nutzerprofil)
CREATE OR REPLACE FUNCTION passende_programme(p_nutzer UUID)
RETURNS SETOF v_programm_voll AS $$
    SELECT DISTINCT vp.*
    FROM v_programm_voll vp
    JOIN programm_zielgruppe pz ON pz.programm_id = vp.id
    JOIN programm_region     prg ON prg.programm_id = vp.id
    JOIN nutzerprofil np ON np.nutzer_id = p_nutzer
    WHERE vp.aktiv
      AND pz.zielgruppe_id = np.zielgruppe_id
      AND (prg.region = np.region OR prg.region = 'bundesweit')
      AND (np.interessen IS NULL OR EXISTS (
            SELECT 1 FROM programm_kategorie pk
            WHERE pk.programm_id = vp.id AND pk.kategorie_id = ANY(np.interessen)));
$$ LANGUAGE sql STABLE;

-- ============================================================================
-- 7. STAMMDATEN-SEED (Klassifikation aus dem Excel-Blatt)
-- ============================================================================

INSERT INTO kategorie (slug, name, beschreibung) VALUES
 ('energie_gebaeude','Energie & Gebäude','Sanierung, Heizung, Effizienz, erneuerbare Energien'),
 ('digitalisierung','Digitalisierung','Software, IT-Sicherheit, Digitalprozesse'),
 ('forschung_innovation','Forschung & Innovation','FuE-Projekte, Technologieentwicklung'),
 ('existenzgruendung','Existenzgründung','Gründung, Nachfolge, Selbstständigkeit'),
 ('wachstum_investition','Wachstum & Investition','Betriebsmittel, Anlagen, Expansion'),
 ('aussenwirtschaft','Außenwirtschaft / Export','Messen, Markterschließung Ausland'),
 ('qualifizierung','Qualifizierung & Personal','Weiterbildung, Einstellung, Ausbildung'),
 ('umwelt_klima','Umwelt & Klimaschutz','Ressourceneffizienz, Emissionsminderung'),
 ('regionale_entwicklung','Regionale Entwicklung','Strukturschwache Regionen, GRW'),
 ('kultur_kreativ','Kultur & Kreativwirtschaft','Film, Medien, Design, Verlag'),
 ('landwirtschaft','Landwirtschaft & Ernährung','Agrar, ländliche Räume'),
 ('soziales_gesundheit','Soziales & Gesundheit','Pflege, Inklusion, Gemeinwohl');

INSERT INTO zielgruppe (slug, name, beschreibung) VALUES
 ('kleinst_solo','Kleinstunternehmen / Solo','< 10 MA, < 2 Mio. € Umsatz'),
 ('kmu_klein','Kleine Unternehmen','< 50 MA, < 10 Mio. €'),
 ('kmu_mittel','Mittlere Unternehmen','< 250 MA, < 50 Mio. €'),
 ('mittelstand_gross','Große / Mittelstand bis 999','nur teils, oft nur in Kooperation'),
 ('gruender','Existenzgründer / Start-ups','vor/kurz nach Gründung'),
 ('freie_berufe','Freie Berufe','Ärzte, Anwälte, Architekten, Ingenieure'),
 ('handwerk','Handwerksbetriebe','zulassungspflichtig/-frei'),
 ('landwirte','Landwirte','Agrarbetriebe'),
 ('privat','Privatpersonen / Eigentümer','v. a. Gebäudesanierung'),
 ('forschung','Forschungseinrichtungen','Hochschulen, Institute'),
 ('kommune','Kommunen / öffentl. Träger','Gebietskörperschaften'),
 ('npo','Vereine / NPO / Stiftungen','Gemeinnützige Organisationen');

INSERT INTO foerdergeber (name, kurzname, ebene, website) VALUES
 ('Bundesamt für Wirtschaft und Ausfuhrkontrolle','BAFA','bund','https://www.bafa.de'),
 ('KfW Bankengruppe','KfW','bund','https://www.kfw.de'),
 ('Bundesministerium für Wirtschaft und Energie','BMWE','bund','https://www.bmwk.de'),
 ('Investitionsbank Berlin','IBB','land','https://www.ibb.de'),
 ('Europäische Kommission (CINEA)','CINEA','eu','https://cinea.ec.europa.eu');

-- ----------------------------------------------------------------------------
-- Beispiel: ein vollständig angereichertes Programm (BEG Heizungstausch)
-- Zeigt, wie Stammdaten + Anreicherung zusammenspielen.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_prog UUID;
    v_bafa INTEGER;
BEGIN
    SELECT id INTO v_bafa FROM foerdergeber WHERE kurzname = 'BAFA';

    INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
        foerderquote_text, quote_min, quote_max,
        max_betrag_text, max_betrag_eur, kurzbeschreibung, besonderheit,
        quelle_url, quelle_stand, status)
    VALUES ('BEG Einzelmaßnahmen – Heizungstausch', v_bafa, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
        '30 % Grundförderung + Boni, gedeckelt bei 70 %', 30, 70,
        'max. 30.000 € förderf. Kosten/WE → bis 21.000 € Zuschuss', 21000,
        'Zuschuss für den Austausch fossiler Heizungen durch klimafreundliche Systeme.',
        'Antrag auch durch Heizungsbauer möglich; Einkommensbonus 30 % bis 40.000 € zvE.',
        'https://www.bafa.de', DATE '2026-01-15', 'verifiziert')
    RETURNING id INTO v_prog;

    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude';
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein');
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit');

    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES
        (v_prog, 1, 'Förderfähigkeit prüfen','Erfüllt Gebäude/Maßnahme die technischen Mindestanforderungen?','30 Min.','vor Antrag', FALSE),
        (v_prog, 2, 'Energieeffizienz-Experten einbinden','Für viele Maßnahmen verpflichtend (dena-Liste).','1–2 Tage','vor Antrag', TRUE),
        (v_prog, 3, 'Antrag VOR Auftragsvergabe stellen','Kritischster Schritt – sonst Totalausfall der Förderung.','1 Std.','zwingend vorab', FALSE),
        (v_prog, 4, 'Maßnahme umsetzen','Durchführung durch Fachbetrieb im Bewilligungszeitraum.','projektabh.','i. d. R. 24 Mon.', FALSE),
        (v_prog, 5, 'Verwendungsnachweis einreichen','Rechnungen + Fachunternehmererklärung → Auszahlung.','2 Std.','nach Abschluss', FALSE);

    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES
        (v_prog, 'ablehnungsgrund','Auftrag VOR Antragstellung vergeben', 3),
        (v_prog, 'ablehnungsgrund','Fehlende/fehlerhafte Fachunternehmererklärung', 2),
        (v_prog, 'ablehnungsgrund','Technische Mindestanforderungen nicht erfüllt', 2),
        (v_prog, 'erfolgsfaktor','Vollständige Unterlagen + förderfähige Maßnahme', 3);

    INSERT INTO erfolgseinschaetzung (programm_id, quote_prozent, begruendung) VALUES
        (v_prog, 78, 'Hohe Quote bei vollständigen Unterlagen und förderfähigen Maßnahmen.');

    INSERT INTO pflichtunterlage (programm_id, bezeichnung) VALUES
        (v_prog, 'Rechnung(en) des Fachbetriebs'),
        (v_prog, 'Fachunternehmererklärung'),
        (v_prog, 'ggf. Bestätigung Energieeffizienz-Experte'),
        (v_prog, 'Nachweis der Zahlung');

    INSERT INTO dokumentvorlage (programm_id, dokument_typ, titel, felder) VALUES
        (v_prog, 'vorhabenbeschreibung','Vorhabenbeschreibung Heizungstausch',
         '[{"feld":"projektname","label":"Projektname"},{"feld":"beschreibung","label":"Kurzbeschreibung"},{"feld":"summe","label":"Investitionssumme (€)"}]'::jsonb);
END $$;

COMMIT;

-- ============================================================================
--  ENDE. Nützliche Beispielabfragen:
--
--  -- Alle aktiven Energie-Zuschüsse des Bundes, bundesweit:
--  SELECT titel, foerderquote_text, status FROM v_programm_voll
--   WHERE ebene='bund' AND art='zuschuss' AND 'Energie & Gebäude' = ANY(kategorien)
--     AND 'bundesweit' = ANY(regionen) AND aktiv;
--
--  -- Antragspfad eines Programms in Reihenfolge:
--  SELECT reihenfolge, titel, frist_bezug FROM antragsschritt
--   WHERE programm_id = '<UUID>' ORDER BY reihenfolge;
--
--  -- Passende Programme für einen Nutzer:
--  SELECT titel, erfolgsquote FROM passende_programme('<nutzer-UUID>');
-- ============================================================================
