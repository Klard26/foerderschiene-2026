-- ============================================================================
--  FÖRDERPILOT — Seed-Erweiterung: Antragspfade
--  Ergänzt foerderpilot_schema.sql um Schritt-für-Schritt-Anleitungen
--  für die wichtigsten Programme (entspricht Excel-Blatt »Antragspfade«).
--
--  Voraussetzung: foerderpilot_schema.sql wurde bereits eingespielt.
--  Anwendung:  psql -f foerderpilot_seed_antragspfade.sql
--
--  Idempotent: legt Programme nur an, falls sie noch nicht existieren,
--  und räumt zugehörige Schritte vor dem Neu-Einfügen auf.
-- ============================================================================

-- Hilfsfunktion: Programm anlegen oder vorhandenes finden, dann Schritte setzen.
-- Wir kapseln das je Programm in einen DO-Block.

-- ----------------------------------------------------------------------------
-- ZIM – Einzelprojekt (FuE)
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE kurzname = 'BMWE';

    SELECT id INTO v_prog FROM programm WHERE titel = 'ZIM – Einzelprojekt (FuE)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            kurzbeschreibung, besonderheit, quelle_url, quelle_stand, status)
        VALUES ('ZIM – Einzelprojekt (FuE)', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            '25–45 % Förderquote (je Unternehmensgröße)', 25, 45,
            'max. 690.000 € förderfähige Kosten', 690000,
            'Nicht rückzahlbarer Zuschuss für FuE-Projekte des Mittelstands.',
            'Volldigital über Förderzentrale Deutschland (zim.de); Eingangsbestätigung ist der rechtliche Zeitstempel.',
            'https://www.zim.de', DATE '2026-06-01', 'verifiziert')
        RETURNING id INTO v_prog;

        INSERT INTO programm_kategorie (programm_id, kategorie_id)
            SELECT v_prog, id FROM kategorie WHERE slug = 'forschung_innovation';
        INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
            SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein','kmu_mittel','handwerk','freie_berufe');
        INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit');
        INSERT INTO erfolgseinschaetzung (programm_id, quote_prozent, begruendung)
            VALUES (v_prog, 42, 'Wettbewerblich; Innovationshöhe und Verwertungsplan entscheiden.');
    END IF;

    DELETE FROM antragsschritt WHERE programm_id = v_prog;
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES
        (v_prog, 1, 'Innovationsgehalt & FuE-Risiko schärfen','Echte technische Neuheit über den Stand der Technik und erkennbares Entwicklungsrisiko sicherstellen.','2–3 Tage','vor Antrag', FALSE),
        (v_prog, 2, 'Mein Unternehmenskonto einrichten','Für die volldigitale Antragstellung über die FZD anlegen — Antrag erfolgt ohne Unterschrift.','1 Std.','vor Antrag', FALSE),
        (v_prog, 3, 'Projektbeschreibung & PSP erstellen','Projektstrukturplan, Arbeitspakete, Meilensteine, Personalkostenkalkulation (Anhänge 1–4).','1–2 Wochen','vor Antrag', FALSE),
        (v_prog, 4, 'Optional: Projektträger-Beratung','Kostenlose Beratung des Projektträgers (VDI/VDE-IT) oder formlose Skizze. Keine Pflicht.','1–2 Tage','vor Antrag', FALSE),
        (v_prog, 5, 'Antrag über FZD einreichen — vor Vorhabenbeginn','Volldigital einreichen. Projekt darf erst nach bestätigtem Antragseingang beginnen.','2 Tage','zwingend vorab', FALSE),
        (v_prog, 6, 'Eingangsbestätigung sichern','Schriftliche Eingangsbestätigung ist der rechtlich maßgebliche Zeitstempel; ab dann Projektstart auf eigenes Risiko.','—','nach Einreichung', FALSE),
        (v_prog, 7, 'Begutachtung & Rückfragen','Fachliche Prüfung (~3 Monate); Rückfragen zu Innovation, Risiko, Kosten, Verwertung beantworten.','reaktiv','~3 Mon.', FALSE),
        (v_prog, 8, 'Mittelabruf & Nachweise','Mittel abrufen; Stundennachweise (Vordruck) und Zwischennachweise führen.','laufend','quartalsweise', FALSE);

    DELETE FROM erfolgsfaktor WHERE programm_id = v_prog;
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES
        (v_prog, 'ablehnungsgrund','Innovationshöhe nicht überzeugend dargestellt', 3),
        (v_prog, 'ablehnungsgrund','Kein nachvollziehbarer Verwertungs-/Marktplan', 2),
        (v_prog, 'ablehnungsgrund','Vorhaben vor bestätigtem Antragseingang begonnen', 3),
        (v_prog, 'erfolgsfaktor','Sauberer PSP signalisiert Planungssicherheit', 2);
END $$;

-- ----------------------------------------------------------------------------
-- Gründungszuschuss
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    -- Fördergeber Agentur für Arbeit ggf. anlegen
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'Agentur für Arbeit';
    IF v_geber IS NULL THEN
        INSERT INTO foerdergeber (name, kurzname, ebene, website)
        VALUES ('Agentur für Arbeit', 'BA', 'bund', 'https://www.arbeitsagentur.de')
        RETURNING id INTO v_geber;
    END IF;

    SELECT id INTO v_prog FROM programm WHERE titel = 'Gründungszuschuss';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, max_betrag_text, kurzbeschreibung, besonderheit,
            quelle_url, quelle_stand, status)
        VALUES ('Gründungszuschuss', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            'ALG-I-Satz + 300 €/Monat (Phase 1, 6 Mon.), dann 300 € (9 Mon.)',
            'individuell (Ermessensleistung)',
            'Unterstützung für ALG-I-Bezieher, die sich selbstständig machen (§93 SGB III).',
            'Ermessensleistung — kein Rechtsanspruch. Restanspruch ALG I ≥ 150 Tage zwingend.',
            'https://www.arbeitsagentur.de', DATE '2026-05-01', 'verifiziert')
        RETURNING id INTO v_prog;

        INSERT INTO programm_kategorie (programm_id, kategorie_id)
            SELECT v_prog, id FROM kategorie WHERE slug = 'existenzgruendung';
        INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
            SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug = 'gruender';
        INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit');
        INSERT INTO erfolgseinschaetzung (programm_id, quote_prozent, begruendung)
            VALUES (v_prog, 48, 'Ermessensleistung; tragfähiger Businessplan + fachkundige Stellungnahme entscheidend.');
    END IF;

    DELETE FROM antragsschritt WHERE programm_id = v_prog;
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES
        (v_prog, 1, 'Restanspruch ALG I prüfen (≥ 150 Tage)','K.-o.-Kriterium: zum Gründungszeitpunkt noch ≥ 150 Tage Anspruch. Startdatum festlegen und zurückrechnen.','30 Min.','vor allem anderen', FALSE),
        (v_prog, 2, 'Businessplan erstellen','Tragfähiges Konzept mit Text- und Zahlenteil (10–20 S.), konservative, marktbelegte Prognosen.','1–2 Wochen','vor Antrag', FALSE),
        (v_prog, 3, 'Fachkundige Stellungnahme einholen','Tragfähigkeitsbescheinigung von IHK/HWK (oft kostenlos) oder StB/Beratung. Ohne sie keine Bearbeitung.','3–5 Tage','vor Antrag', TRUE),
        (v_prog, 4, 'Antrag bei der Agentur abholen — VOR Gründung','Antragsformular vor Aufnahme der Tätigkeit abholen. Rückwirkend nicht möglich; Rechtsanspruch auf Aushändigung.','1 Std.','zwingend vor Gründung', FALSE),
        (v_prog, 5, 'Antrag mit allen Unterlagen einreichen','Antrag + Businessplan + Lebenslauf + Stellungnahme + Anmeldung der Selbstständigkeit. Auf Vollständigkeit achten.','1 Std.','vor Gründung', FALSE),
        (v_prog, 6, 'Bewilligung abwarten (Ermessen)','4–8 Wochen Bearbeitung. Ermessensleistung; Überzeugung des Vermittlers zählt.','reaktiv','4–8 Wochen', FALSE),
        (v_prog, 7, 'Phase 2 beantragen (Monat 6)','Nach 6 Monaten 300 €/Monat für 9 weitere Monate mit Nachweis intensiver Geschäftstätigkeit.','1 Std.','nach Monat 6', FALSE);

    DELETE FROM erfolgsfaktor WHERE programm_id = v_prog;
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES
        (v_prog, 'ablehnungsgrund','Weniger als 150 Tage Restanspruch zum Gründungszeitpunkt', 3),
        (v_prog, 'ablehnungsgrund','Bereits gegründet vor Antragstellung', 3),
        (v_prog, 'ablehnungsgrund','Geschäftsidee zu unkonkret / Prognosen unbegründet', 2),
        (v_prog, 'erfolgsfaktor','Überzeugender, tragfähiger Businessplan', 3);

    INSERT INTO pflichtunterlage (programm_id, bezeichnung)
    SELECT v_prog, x FROM (VALUES
        ('Ausgefüllter Antrag (Formular der Agentur)'),
        ('Businessplan (Text- und Zahlenteil)'),
        ('Fachkundige Stellungnahme (Tragfähigkeit)'),
        ('Lebenslauf / Qualifikationsnachweis'),
        ('Nachweis der Anmeldung der Selbstständigkeit')
    ) AS t(x)
    WHERE NOT EXISTS (SELECT 1 FROM pflichtunterlage WHERE programm_id = v_prog);
END $$;

-- ----------------------------------------------------------------------------
-- BEG Einzelmaßnahmen – Gebäudehülle
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_prog UUID; v_bafa INTEGER;
BEGIN
    SELECT id INTO v_bafa FROM foerdergeber WHERE kurzname = 'BAFA';

    SELECT id INTO v_prog FROM programm WHERE titel = 'BEG Einzelmaßnahmen – Gebäudehülle';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            kurzbeschreibung, besonderheit, quelle_url, quelle_stand, status)
        VALUES ('BEG Einzelmaßnahmen – Gebäudehülle', v_bafa, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            '15 %, +5 % mit iSFP (= 20 %)', 15, 20,
            'max. 30.000 €/WE, mit iSFP 60.000 €', 60000,
            'Zuschuss für Dämmung, Fenster und Außentüren im Bestand.',
            'Dämmung/Fenster nur mit Energieeffizienz-Experte beantragbar.',
            'https://www.bafa.de', DATE '2026-01-15', 'verifiziert')
        RETURNING id INTO v_prog;

        INSERT INTO programm_kategorie (programm_id, kategorie_id)
            SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude';
        INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
            SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein');
        INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit');
        INSERT INTO erfolgseinschaetzung (programm_id, quote_prozent, begruendung)
            VALUES (v_prog, 75, 'Hohe Quote bei korrekter TPB und Einhaltung der U-Werte.');
    END IF;

    DELETE FROM antragsschritt WHERE programm_id = v_prog;
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES
        (v_prog, 1, 'Energieeffizienz-Experten beauftragen','dena-gelistete Fachperson erstellt die Technische Projektbeschreibung (TPB) und prüft die U-Werte.','1–2 Tage','vor Antrag', TRUE),
        (v_prog, 2, 'iSFP prüfen (5 % Bonus)','Stammt die Maßnahme aus einem individuellen Sanierungsfahrplan? Dann +5 % Bonus.','30 Min.','vor Antrag', FALSE),
        (v_prog, 3, 'Antrag VOR Vorhabenbeginn stellen','Antrag mit TPB beim BAFA stellen, bevor beauftragt wird. Beginn vor Antrag = Totalausfall.','1 Std.','zwingend vorab', FALSE),
        (v_prog, 4, 'Umsetzung & Fachunternehmererklärung','Maßnahme durch Fachbetrieb umsetzen; Einhaltung der TMA bestätigen lassen.','projektabh.','Bewilligungszeitraum', FALSE),
        (v_prog, 5, 'Verwendungsnachweis einreichen','Rechnungen, Fachunternehmererklärung und ggf. Bestätigung des Experten hochladen → Auszahlung.','2 Std.','nach Abschluss', FALSE);

    DELETE FROM erfolgsfaktor WHERE programm_id = v_prog;
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES
        (v_prog, 'ablehnungsgrund','Auftrag vor Antragstellung vergeben', 3),
        (v_prog, 'ablehnungsgrund','Technische Mindestanforderungen (U-Werte) verfehlt', 2),
        (v_prog, 'erfolgsfaktor','Korrekte TPB durch dena-Experten', 2);
END $$;

-- ----------------------------------------------------------------------------
-- KfW-Kredit (z. B. 261/270) — über Hausbank
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_prog UUID; v_kfw INTEGER;
BEGIN
    SELECT id INTO v_kfw FROM foerdergeber WHERE kurzname = 'KfW';

    SELECT id INTO v_prog FROM programm WHERE titel = 'KfW-Kredit (261/270) – über Hausbank';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, max_betrag_text, max_betrag_eur,
            kurzbeschreibung, besonderheit, quelle_url, quelle_stand, status)
        VALUES ('KfW-Kredit (261/270) – über Hausbank', v_kfw, 'bund', 'kredit', 'vor_vorhabenbeginn',
            'Zinsgünstiger Kredit, bei 261 mit Tilgungszuschuss', 'bis 150.000 € (261) / 150 Mio. € (270)', 150000,
            'Förderkredite für Effizienzhaus-Sanierung (261) bzw. erneuerbare Energien (270).',
            'Antrag NICHT direkt bei KfW, sondern über die Hausbank — vor Vorhabenbeginn.',
            'https://www.kfw.de', DATE '2026-01-15', 'zu_pruefen')
        RETURNING id INTO v_prog;

        INSERT INTO programm_kategorie (programm_id, kategorie_id)
            SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude';
        INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
            SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein','landwirte');
        INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit');
        INSERT INTO erfolgseinschaetzung (programm_id, quote_prozent, begruendung)
            VALUES (v_prog, 67, 'Bonitätsgetrieben; Antrag läuft über die Hausbank.');
    END IF;

    DELETE FROM antragsschritt WHERE programm_id = v_prog;
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES
        (v_prog, 1, 'Vorhaben & Kreditbedarf klären','Investitionskosten, Eigenanteil und Kreditbetrag bestimmen; bei 261 Effizienzhaus-Stufe mit Experten festlegen.','halber Tag','vor Antrag', TRUE),
        (v_prog, 2, 'Hausbankgespräch vorbereiten','Unterlagen (Investitionsplan, Angebote, Bonität) zusammenstellen; KfW-Kredit läuft über die Hausbank.','1–2 Tage','vor Antrag', FALSE),
        (v_prog, 3, 'Antrag über Hausbank — vor Vorhabenbeginn','Die Hausbank stellt den Antrag bei der KfW, bevor das Vorhaben beginnt. Vorzeitiger Beginn schließt Förderung aus.','reaktiv','zwingend vorab', FALSE),
        (v_prog, 4, 'Zusage, Abruf & ggf. Tilgungszuschuss','Nach Zusage Mittel abrufen, Vorhaben umsetzen; bei BEG-Krediten Tilgungszuschuss nach Effizienznachweis.','projektabh.','Abruffrist beachten', FALSE);

    DELETE FROM erfolgsfaktor WHERE programm_id = v_prog;
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES
        (v_prog, 'ablehnungsgrund','Vorhaben vor Kreditzusage begonnen', 3),
        (v_prog, 'ablehnungsgrund','Unzureichende Bonität/Sicherheiten', 2),
        (v_prog, 'erfolgsfaktor','Vollständige Unterlagen fürs Hausbankgespräch', 2);
END $$;

-- ============================================================================
--  Kontrollabfrage nach dem Einspielen:
--
--  SELECT p.titel, count(a.*) AS schritte
--    FROM programm p LEFT JOIN antragsschritt a ON a.programm_id = p.id
--   GROUP BY p.titel ORDER BY schritte DESC;
-- ============================================================================
