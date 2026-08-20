-- ============================================================
-- FÖRDERSCHIENE — Energetische Sanierungsförderung (Bund + Länder)
-- Auto-generiert. Idempotent (Programme per Titel aktualisiert).
-- Recherchestand Juni 2026. Vor Antragstellung amtlich prüfen.
-- ============================================================
BEGIN;

-- Zielgruppen für die Immobilienwirtschaft ergänzen (idempotent)
INSERT INTO zielgruppe (slug, name, beschreibung) VALUES ('hausverwaltung','Hausverwaltungen','WEG-/Mietverwaltung') ON CONFLICT (slug) DO NOTHING;
INSERT INTO zielgruppe (slug, name, beschreibung) VALUES ('bestandshalter','Bestandshalter / Investoren','Eigentümer von Immobilienportfolios') ON CONFLICT (slug) DO NOTHING;
INSERT INTO zielgruppe (slug, name, beschreibung) VALUES ('wohnungswirtschaft','Wohnungswirtschaft','Wohnungsunternehmen, Genossenschaften') ON CONFLICT (slug) DO NOTHING;
INSERT INTO zielgruppe (slug, name, beschreibung) VALUES ('makler','Immobilienmakler','Vermittlung Kauf/Miete') ON CONFLICT (slug) DO NOTHING;

-- BEG EM – Gebäudehülle (Dämmung, Fenster, Türen)
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' OR kurzname = 'BAFA' LIMIT 1;
    IF v_geber IS NULL THEN
        INSERT INTO foerdergeber (name, ebene) VALUES ('BAFA', 'bund') RETURNING id INTO v_geber;
    END IF;
    SELECT id INTO v_prog FROM programm WHERE titel = 'BEG EM – Gebäudehülle (Dämmung, Fenster, Türen)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur, kurzbeschreibung, besonderheit, status)
        VALUES ('BEG EM – Gebäudehülle (Dämmung, Fenster, Türen)', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn', '15 % Grund + 5 % iSFP-Bonus + 5 % WPB-Bonus (Klasse F/G); max. 20 % regulär', 15, 20, 'förderfähig 30.000 €/WE/Jahr, mit iSFP 60.000 €/WE', 60000, 'Zuschuss für Dämmung von Außenwand, Dach, Keller sowie Fenster-/Türtausch im Bestand.', 'Energieeffizienz-Experte (dena) verpflichtend. Antrag vor Auftragsvergabe. Nicht mit §35c EStG für dieselbe Maßnahme kombinierbar.', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET foerderquote_text='15 % Grund + 5 % iSFP-Bonus + 5 % WPB-Bonus (Klasse F/G); max. 20 % regulär', besonderheit='Energieeffizienz-Experte (dena) verpflichtend. Antrag vor Auftragsvergabe. Nicht mit §35c EStG für dieselbe Maßnahme kombinierbar.', status='verifiziert' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_zielgruppe WHERE programm_id=v_prog;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung) SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein','kmu_mittel','handwerk','freie_berufe','npo','hausverwaltung','bestandshalter','wohnungswirtschaft');
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit');
    DELETE FROM antragsschritt WHERE programm_id=v_prog;
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Energieeffizienz-Experten beauftragen', 'dena-gelistete Fachperson auswählen; sie erstellt die Technische Projektbeschreibung (TPB) und prüft die U-Werte.', '1–2 Tage', 'vor Antrag', TRUE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'iSFP-Bonus prüfen', 'Liegt ein individueller Sanierungsfahrplan vor und stammt die Maßnahme daraus? Dann +5 % (15→20 %).', '30 Min.', 'vor Antrag', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'WPB-Bonus prüfen', 'Worst-Performing-Building-Bonus: zusätzliche 5 % bei Gebäuden der Effizienzklasse F oder G.', '30 Min.', 'vor Antrag', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 4, 'Antrag im BAFA-Portal stellen — VOR Auftragsvergabe', 'Antrag mit TPB online stellen, bevor ein Auftrag erteilt wird. Vorhabenbeginn vor Antrag = Totalausfall.', '1 Std.', 'ZWINGEND vorab', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 5, 'Zuwendungsbescheid abwarten', 'Bewilligung abwarten bzw. mit aufschiebend bedingtem Vertrag arbeiten.', 'reaktiv', '~Wochen', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 6, 'Maßnahme umsetzen', 'Fachbetrieb setzt um; Einhaltung der technischen Mindestanforderungen per Fachunternehmererklärung bestätigen.', 'projektabh.', 'Bewilligungszeitraum', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 7, 'Verwendungsnachweis einreichen', 'Rechnungen, Fachunternehmererklärung und Bestätigung des Experten hochladen → Auszahlung. Frist: i.d.R. 9 Monate nach Bewilligung.', '2 Std.', 'nach Abschluss', FALSE);
    DELETE FROM pflichtunterlage WHERE programm_id=v_prog;
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Technische Projektbeschreibung (TPB) des Experten', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Angebot/Kostenvoranschlag Fachbetrieb', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Fachunternehmererklärung', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Rechnungen', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Zahlungsnachweise', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'ggf. iSFP', TRUE);
    DELETE FROM erfolgsfaktor WHERE programm_id=v_prog;
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Auftrag vor Antragstellung vergeben', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Technische Mindestanforderungen (U-Werte) verfehlt', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Kein dena-Experte eingebunden', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Verwendungsnachweis-Frist versäumt', 3);
END $$;

-- BEG EM – Anlagentechnik & Lüftung (ohne Heizung)
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' OR kurzname = 'BAFA' LIMIT 1;
    IF v_geber IS NULL THEN
        INSERT INTO foerdergeber (name, ebene) VALUES ('BAFA', 'bund') RETURNING id INTO v_geber;
    END IF;
    SELECT id INTO v_prog FROM programm WHERE titel = 'BEG EM – Anlagentechnik & Lüftung (ohne Heizung)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur, kurzbeschreibung, besonderheit, status)
        VALUES ('BEG EM – Anlagentechnik & Lüftung (ohne Heizung)', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn', '15 % + 5 % iSFP-Bonus', 15, 20, 'gemeinsamer Deckel mit Hülle: 30.000 €/WE, mit iSFP 60.000 €', 60000, 'Zuschuss für Lüftungsanlagen mit Wärmerückgewinnung und sonstige Anlagentechnik (kein Wärmeerzeuger).', 'Lüftung mit WRG v.a. nach Dämmung sinnvoll (Feuchteschutz). dena-Experte verpflichtend.', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET foerderquote_text='15 % + 5 % iSFP-Bonus', besonderheit='Lüftung mit WRG v.a. nach Dämmung sinnvoll (Feuchteschutz). dena-Experte verpflichtend.', status='verifiziert' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_zielgruppe WHERE programm_id=v_prog;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung) SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein','kmu_mittel','handwerk','npo','hausverwaltung','bestandshalter','wohnungswirtschaft');
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit');
    DELETE FROM antragsschritt WHERE programm_id=v_prog;
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Experten & Lüftungskonzept', 'dena-Experte prüft Sinnhaftigkeit; Lüftungskonzept ist oft Auszahlungsvoraussetzung.', '1–2 Tage', 'vor Antrag', TRUE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'Antrag VOR Auftragsvergabe', 'BAFA-Antrag mit TPB vor Beauftragung stellen.', '1 Std.', 'ZWINGEND vorab', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'Umsetzung & Nachweis', 'Fachbetrieb baut ein; Fachunternehmererklärung; Verwendungsnachweis einreichen.', 'projektabh.', 'nach Abschluss', FALSE);
    DELETE FROM pflichtunterlage WHERE programm_id=v_prog;
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'TPB des Experten', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Lüftungskonzept', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Fachunternehmererklärung', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Rechnungen', TRUE);
    DELETE FROM erfolgsfaktor WHERE programm_id=v_prog;
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Auftrag vor Antrag', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Lüftungskonzept fehlt', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'WRG-Wirkungsgrad unter Mindestanforderung', 3);
END $$;

-- BEG EM – Heizungsoptimierung (hydraulischer Abgleich)
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' OR kurzname = 'BAFA' LIMIT 1;
    IF v_geber IS NULL THEN
        INSERT INTO foerdergeber (name, ebene) VALUES ('BAFA', 'bund') RETURNING id INTO v_geber;
    END IF;
    SELECT id INTO v_prog FROM programm WHERE titel = 'BEG EM – Heizungsoptimierung (hydraulischer Abgleich)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur, kurzbeschreibung, besonderheit, status)
        VALUES ('BEG EM – Heizungsoptimierung (hydraulischer Abgleich)', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn', '15 % + 5 % iSFP-Bonus', 15, 20, 'im gemeinsamen 30.000-€-Deckel (mit iSFP 60.000 €)', 60000, 'Zuschuss für hydraulischen Abgleich, Hocheffizienzpumpen, Thermostatventile, Regelungstechnik.', 'Heizung muss mind. 2 Jahre alt sein. Eine der wirtschaftlichsten Maßnahmen überhaupt. KEIN Heizungstausch (→ KfW 458).', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET foerderquote_text='15 % + 5 % iSFP-Bonus', besonderheit='Heizung muss mind. 2 Jahre alt sein. Eine der wirtschaftlichsten Maßnahmen überhaupt. KEIN Heizungstausch (→ KfW 458).', status='verifiziert' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_zielgruppe WHERE programm_id=v_prog;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung) SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein','handwerk','npo','hausverwaltung','bestandshalter','wohnungswirtschaft');
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit');
    DELETE FROM antragsschritt WHERE programm_id=v_prog;
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Fachbetrieb/Experte einbinden', 'Hydraulischer Abgleich nach Verfahren B; Fachbetrieb stellt TPB aus.', '1 Tag', 'vor Antrag', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'Antrag VOR Auftrag', 'BAFA-Antrag vor Beauftragung.', '30 Min.', 'ZWINGEND vorab', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'Umsetzung & Nachweis', 'Durchführung, Fachunternehmererklärung, Verwendungsnachweis.', '1–2 Tage', 'nach Abschluss', FALSE);
    DELETE FROM pflichtunterlage WHERE programm_id=v_prog;
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'TPB / Fachunternehmererklärung', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Nachweis hydraulischer Abgleich Verfahren B', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Rechnungen', TRUE);
    DELETE FROM erfolgsfaktor WHERE programm_id=v_prog;
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Heizung jünger als 2 Jahre', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Auftrag vor Antrag', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Abgleich nur nach Verfahren A statt B', 3);
END $$;

-- KfW 458 – Heizungstausch (klimafreundliche Heizung)
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'KfW' OR kurzname = 'KfW' LIMIT 1;
    IF v_geber IS NULL THEN
        INSERT INTO foerdergeber (name, ebene) VALUES ('KfW', 'bund') RETURNING id INTO v_geber;
    END IF;
    SELECT id INTO v_prog FROM programm WHERE titel = 'KfW 458 – Heizungstausch (klimafreundliche Heizung)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur, kurzbeschreibung, besonderheit, status)
        VALUES ('KfW 458 – Heizungstausch (klimafreundliche Heizung)', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn', '30 % Grund + 20 % Klimageschwindigkeit + 30 % Einkommen (<40.000 € zvE) + 5 % Effizienz; max. 70 %', 30, 70, 'förderfähig 30.000 € (1. WE), 15.000 € je weitere bis 6. WE, 8.000 € ab 7.; max. Zuschuss 21.000 €/WE', 30000, 'Zuschuss für Einbau von Wärmepumpe, Biomasse, Solarthermie, Brennstoffzelle, Wärmenetzanschluss im Bestand.', 'Seit 2024 über KfW (nicht BAFA). iSFP-Bonus gilt hier NICHT (stattdessen Klimageschwindigkeitsbonus). Fachunternehmererklärung (BzA) ausreichend. Klimabonus sinkt ab 2029.', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET foerderquote_text='30 % Grund + 20 % Klimageschwindigkeit + 30 % Einkommen (<40.000 € zvE) + 5 % Effizienz; max. 70 %', besonderheit='Seit 2024 über KfW (nicht BAFA). iSFP-Bonus gilt hier NICHT (stattdessen Klimageschwindigkeitsbonus). Fachunternehmererklärung (BzA) ausreichend. Klimabonus sinkt ab 2029.', status='verifiziert' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_zielgruppe WHERE programm_id=v_prog;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung) SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein','kmu_mittel','handwerk','npo','hausverwaltung','bestandshalter','wohnungswirtschaft');
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit');
    DELETE FROM antragsschritt WHERE programm_id=v_prog;
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Fachbetrieb-Angebot & BzA', 'Heizungsbauer erstellt Angebot mit aufschiebend bedingtem Vertrag und Bestätigung zum Antrag (BzA).', '1–2 Tage', 'vor Antrag', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'Boni-Anspruch klären', 'Klimageschwindigkeitsbonus (20 %, selbstnutzend), Einkommensbonus (30 % bei zvE ≤ 40.000 €, Steuerbescheid), Effizienzbonus (5 %, WP mit natürl. Kältemittel/Erdwärme).', '30 Min.', 'vor Antrag', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'Antrag im KfW-Zuschussportal — VOR Auftrag', 'Antrag mit BzA im Portal ''Meine KfW'' stellen, bevor unbedingt beauftragt wird.', '1 Std.', 'ZWINGEND vorab', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 4, 'Umsetzung im Bewilligungszeitraum', 'Einbau durch Fachbetrieb; bis zu 36 Monate Zeit nach Zusage.', 'projektabh.', '36 Mon.', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 5, 'Identifizierung & Nachweis', 'Rechnung und Fachunternehmererklärung hochladen → Auszahlung des Zuschusses.', '2 Std.', 'nach Abschluss', FALSE);
    DELETE FROM pflichtunterlage WHERE programm_id=v_prog;
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Bestätigung zum Antrag (BzA)', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'aufschiebend bedingter Liefer-/Leistungsvertrag', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'ggf. Steuerbescheid (Einkommensbonus)', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Rechnung', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Fachunternehmererklärung', TRUE);
    DELETE FROM erfolgsfaktor WHERE programm_id=v_prog;
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Auftrag vor Antrag unbedingt vergeben', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Fossile Heizung (reine Gas-/Ölheizung) nicht förderfähig', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Einkommensbonus ohne gültigen Nachweis', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'BzA fehlt', 3);
END $$;

-- BEG WG – Effizienzhaus-Komplettsanierung (KfW 261)
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'KfW' OR kurzname = 'KfW' LIMIT 1;
    IF v_geber IS NULL THEN
        INSERT INTO foerdergeber (name, ebene) VALUES ('KfW', 'bund') RETURNING id INTO v_geber;
    END IF;
    SELECT id INTO v_prog FROM programm WHERE titel = 'BEG WG – Effizienzhaus-Komplettsanierung (KfW 261)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur, kurzbeschreibung, besonderheit, status)
        VALUES ('BEG WG – Effizienzhaus-Komplettsanierung (KfW 261)', v_geber, 'bund', 'kredit', 'vor_vorhabenbeginn', 'Kredit + Tilgungszuschuss 5–45 % je Effizienzhaus-Stufe (EH 85 bis EH 40, +WPB/Worst-First)', 5, 45, 'bis 150.000 €/WE Kreditsumme (mit EE-Klasse)', 150000, 'Förderkredit mit Tilgungszuschuss für die Sanierung zum Effizienzhaus (Komplettsanierung).', 'Antrag über Hausbank. Energieeffizienz-Experte zwingend. Für enthaltene Einzelmaßnahmen KEIN separater BAFA-Zuschuss (Doppelförderungsverbot).', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET foerderquote_text='Kredit + Tilgungszuschuss 5–45 % je Effizienzhaus-Stufe (EH 85 bis EH 40, +WPB/Worst-First)', besonderheit='Antrag über Hausbank. Energieeffizienz-Experte zwingend. Für enthaltene Einzelmaßnahmen KEIN separater BAFA-Zuschuss (Doppelförderungsverbot).', status='verifiziert' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_zielgruppe WHERE programm_id=v_prog;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung) SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein','kmu_mittel','npo','hausverwaltung','bestandshalter','wohnungswirtschaft');
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit');
    DELETE FROM antragsschritt WHERE programm_id=v_prog;
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Effizienzhaus-Ziel mit Experten festlegen', 'dena-Experte plant die Stufe (EH 85–40), erstellt die Bestätigung zum Antrag (BzA).', '1–2 Wochen', 'vor Antrag', TRUE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'Hausbankgespräch', 'KfW-Kredit läuft über die Hausbank; Unterlagen vorbereiten.', '1–2 Tage', 'vor Antrag', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'Antrag über Hausbank — vor Vorhabenbeginn', 'Hausbank stellt den Antrag bei der KfW vor Beginn.', 'reaktiv', 'ZWINGEND vorab', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 4, 'Umsetzung & Bestätigung nach Durchführung', 'Sanierung umsetzen; Experte erstellt Bestätigung nach Durchführung (BnD) → Tilgungszuschuss.', 'projektabh.', 'Bewilligungszeitraum', TRUE);
    DELETE FROM pflichtunterlage WHERE programm_id=v_prog;
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Bestätigung zum Antrag (BzA) des Experten', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Sanierungsfahrplan/Planung', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Bestätigung nach Durchführung (BnD)', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Rechnungen', TRUE);
    DELETE FROM erfolgsfaktor WHERE programm_id=v_prog;
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Vorhabenbeginn vor Kreditzusage', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Effizienzhaus-Stufe verfehlt', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Doppelförderung einzelner Maßnahmen mit BAFA', 3);
END $$;

-- KfW 358/359 – Ergänzungskredit zur Heizungsförderung
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'KfW' OR kurzname = 'KfW' LIMIT 1;
    IF v_geber IS NULL THEN
        INSERT INTO foerdergeber (name, ebene) VALUES ('KfW', 'bund') RETURNING id INTO v_geber;
    END IF;
    SELECT id INTO v_prog FROM programm WHERE titel = 'KfW 358/359 – Ergänzungskredit zur Heizungsförderung';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur, kurzbeschreibung, besonderheit, status)
        VALUES ('KfW 358/359 – Ergänzungskredit zur Heizungsförderung', v_geber, 'bund', 'kredit', 'vor_vorhabenbeginn', 'zinsvergünstigter Kredit, Zinsverbilligung bei zvE ≤ 90.000 €', NULL, NULL, 'bis 120.000 €/WE Kreditsumme', 120000, 'Ergänzender zinsgünstiger Kredit für Heizungstausch und weitere Effizienzmaßnahmen, zusätzlich zum Zuschuss.', 'Nur in Verbindung mit bewilligtem BAFA-/KfW-Zuschuss. Über die Hausbank.', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET foerderquote_text='zinsvergünstigter Kredit, Zinsverbilligung bei zvE ≤ 90.000 €', besonderheit='Nur in Verbindung mit bewilligtem BAFA-/KfW-Zuschuss. Über die Hausbank.', status='verifiziert' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_zielgruppe WHERE programm_id=v_prog;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung) SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','hausverwaltung','bestandshalter','wohnungswirtschaft');
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit');
    DELETE FROM antragsschritt WHERE programm_id=v_prog;
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Zuschuss-Bewilligung sichern', 'Voraussetzung ist eine vorliegende Zuschussbewilligung (BAFA BEG EM oder KfW 458).', 'reaktiv', 'vor Kreditantrag', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'Kreditantrag über Hausbank', 'Ergänzungskredit über die Hausbank beantragen, vor Vorhabenbeginn.', '1–2 Tage', 'ZWINGEND vorab', FALSE);
    DELETE FROM pflichtunterlage WHERE programm_id=v_prog;
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Zuschussbewilligung (BAFA/KfW)', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'ggf. Einkommensnachweis (Zinsverbilligung)', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Kreditunterlagen Hausbank', TRUE);
    DELETE FROM erfolgsfaktor WHERE programm_id=v_prog;
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Keine zugrundeliegende Zuschussbewilligung', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Vorhabenbeginn vor Zusage', 3);
END $$;

-- Energieberatung für Wohngebäude (EBW) + iSFP
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' OR kurzname = 'BAFA' LIMIT 1;
    IF v_geber IS NULL THEN
        INSERT INTO foerdergeber (name, ebene) VALUES ('BAFA', 'bund') RETURNING id INTO v_geber;
    END IF;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Energieberatung für Wohngebäude (EBW) + iSFP';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur, kurzbeschreibung, besonderheit, status)
        VALUES ('Energieberatung für Wohngebäude (EBW) + iSFP', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn', '50 % Zuschuss', 50, 50, 'max. 650 € (EFH/ZFH), 850 € (MFH ≥3 WE); +250 € EV-Bonus (MFH)', 850, 'Förderung der Energieberatung und Erstellung des individuellen Sanierungsfahrplans (iSFP) durch einen dena-Experten.', 'iSFP schaltet den 5 %-Bonus auf BEG-EM-Maßnahmen frei und verdoppelt die förderfähigen Kosten je WE. 15 Jahre gültig. Berater stellt i.d.R. den Antrag mit Vollmacht.', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET foerderquote_text='50 % Zuschuss', besonderheit='iSFP schaltet den 5 %-Bonus auf BEG-EM-Maßnahmen frei und verdoppelt die förderfähigen Kosten je WE. 15 Jahre gültig. Berater stellt i.d.R. den Antrag mit Vollmacht.', status='verifiziert' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_zielgruppe WHERE programm_id=v_prog;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung) SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein','npo','hausverwaltung','bestandshalter','wohnungswirtschaft');
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit');
    DELETE FROM antragsschritt WHERE programm_id=v_prog;
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'dena-Experten auswählen', 'Energieberater aus der Energieeffizienz-Expertenliste wählen.', '1 Tag', 'vor Antrag', TRUE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'Antrag durch Berater (Vollmacht)', 'Berater stellt den Antrag im BAFA-Portal mit Vollmacht, vor Beratungsbeginn.', '1 Std.', 'vor Beauftragung', TRUE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'Beratung & iSFP erhalten', 'Vor-Ort-Begehung; Ergebnis ist der iSFP mit Maßnahmenfahrplan.', '1–3 Wochen', '—', TRUE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 4, 'Nachweis & Auszahlung', 'iSFP und Rechnung einreichen; 50 % werden erstattet.', '1 Std.', 'nach Beratung', FALSE);
    DELETE FROM pflichtunterlage WHERE programm_id=v_prog;
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Vollmacht für den Berater', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'iSFP / Beratungsbericht', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Rechnung des Beraters', TRUE);
    DELETE FROM erfolgsfaktor WHERE programm_id=v_prog;
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Antrag nach Beratungsbeginn', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Berater nicht dena-gelistet', 3);
END $$;

-- Fachplanung & Baubegleitung (BEG)
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' OR kurzname = 'BAFA' LIMIT 1;
    IF v_geber IS NULL THEN
        INSERT INTO foerdergeber (name, ebene) VALUES ('BAFA', 'bund') RETURNING id INTO v_geber;
    END IF;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Fachplanung & Baubegleitung (BEG)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur, kurzbeschreibung, besonderheit, status)
        VALUES ('Fachplanung & Baubegleitung (BEG)', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn', '50 % Zuschuss auf Experten-Honorar', 50, 50, 'eigener Deckel; bis 2.500 € (EFH/ZFH)', 2500, 'Zuschuss zur Einbindung eines Energieeffizienz-Experten für Planung und Begleitung der Sanierung.', 'Zusätzlich zur Förderung der eigentlichen Maßnahme, mit eigener Höchstgrenze.', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET foerderquote_text='50 % Zuschuss auf Experten-Honorar', besonderheit='Zusätzlich zur Förderung der eigentlichen Maßnahme, mit eigener Höchstgrenze.', status='verifiziert' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_zielgruppe WHERE programm_id=v_prog;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung) SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein','npo','hausverwaltung','bestandshalter','wohnungswirtschaft');
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit');
    DELETE FROM antragsschritt WHERE programm_id=v_prog;
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Experten beauftragen', 'dena-Experte für Baubegleitung einbinden.', '1 Tag', 'vor Antrag', TRUE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'Gemeinsam mit Maßnahme beantragen', 'Wird i.d.R. zusammen mit der Hauptmaßnahme beantragt.', '30 Min.', 'vor Vorhabenbeginn', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'Nachweis', 'Experten-Rechnung und Bestätigung einreichen.', '30 Min.', 'nach Abschluss', FALSE);
    DELETE FROM pflichtunterlage WHERE programm_id=v_prog;
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Experten-Rechnung', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Bestätigung der Baubegleitung', TRUE);
    DELETE FROM erfolgsfaktor WHERE programm_id=v_prog;
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Keine geförderte Hauptmaßnahme', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Experte nicht gelistet', 3);
END $$;

-- Steuerermäßigung energetische Sanierung (§ 35c EStG)
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'Finanzamt' OR kurzname = 'Finanzamt' LIMIT 1;
    IF v_geber IS NULL THEN
        INSERT INTO foerdergeber (name, ebene) VALUES ('Finanzamt', 'bund') RETURNING id INTO v_geber;
    END IF;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Steuerermäßigung energetische Sanierung (§ 35c EStG)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur, kurzbeschreibung, besonderheit, status)
        VALUES ('Steuerermäßigung energetische Sanierung (§ 35c EStG)', v_geber, 'bund', 'steuer', 'laufend', '20 % der Kosten über 3 Jahre (7 %/7 %/6 %)', 20, 20, 'max. 40.000 € Steuerermäßigung je Objekt', 40000, 'Alternative zur Zuschussförderung: steuerliche Absetzbarkeit energetischer Sanierungsmaßnahmen am selbstgenutzten Eigenheim.', 'Nur für selbstgenutztes Wohneigentum, Gebäude älter als 10 Jahre. NICHT mit BAFA/KfW für dieselbe Maßnahme kombinierbar. Kein Antrag vorab nötig — läuft über die Steuererklärung.', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET foerderquote_text='20 % der Kosten über 3 Jahre (7 %/7 %/6 %)', besonderheit='Nur für selbstgenutztes Wohneigentum, Gebäude älter als 10 Jahre. NICHT mit BAFA/KfW für dieselbe Maßnahme kombinierbar. Kein Antrag vorab nötig — läuft über die Steuererklärung.', status='verifiziert' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_zielgruppe WHERE programm_id=v_prog;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung) SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat');
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit');
    DELETE FROM antragsschritt WHERE programm_id=v_prog;
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Förderweg-Entscheidung', 'Vorab prüfen: Zuschuss (BAFA/KfW) ODER Steuer (§35c) — pro Maßnahme nur eines.', '30 Min.', 'vor Maßnahme', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'Fachbetrieb beauftragen', 'Ausführung durch Fachunternehmen; Materialkosten bei Eigenleistung nicht absetzbar.', 'projektabh.', '—', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'Bescheinigung des Fachbetriebs', 'Fachunternehmen stellt die amtliche Bescheinigung nach § 35c aus.', '—', 'nach Abschluss', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 4, 'In Steuererklärung angeben', 'Über drei Jahre in der Einkommensteuererklärung geltend machen.', '1 Std./Jahr', 'jährlich', FALSE);
    DELETE FROM pflichtunterlage WHERE programm_id=v_prog;
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Fachunternehmer-Bescheinigung nach § 35c EStG', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Rechnungen (unbar bezahlt)', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Zahlungsnachweise', TRUE);
    DELETE FROM erfolgsfaktor WHERE programm_id=v_prog;
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Maßnahme bereits über BAFA/KfW gefördert', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Gebäude jünger als 10 Jahre', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Barzahlung', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'nicht selbstgenutzt', 3);
END $$;

-- L-Bank Z15 – Zusatzfinanzierung Energieeffizienz (Baden-Württemberg)
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'L-Bank' OR kurzname = 'L-Bank' LIMIT 1;
    IF v_geber IS NULL THEN
        INSERT INTO foerdergeber (name, ebene) VALUES ('L-Bank', 'land') RETURNING id INTO v_geber;
    END IF;
    SELECT id INTO v_prog FROM programm WHERE titel = 'L-Bank Z15 – Zusatzfinanzierung Energieeffizienz (Baden-Württemberg)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur, kurzbeschreibung, besonderheit, status)
        VALUES ('L-Bank Z15 – Zusatzfinanzierung Energieeffizienz (Baden-Württemberg)', v_geber, 'land', 'kredit', 'vor_vorhabenbeginn', '0-%-Darlehen + Klimaprämie/Tilgungszuschuss (iSFP-gekoppelt)', NULL, NULL, 'ergänzend zum BEG; Klimaprämie z.B. 10.000 € bei EH 55', NULL, 'Zinsloses Landes-Darlehen mit Tilgungszuschuss, kombinierbar mit BAFA/KfW. Einzige Landesförderung mit iSFP-Tilgungszuschuss.', 'Keine Einkommensgrenze. Kombinierbar mit BEG-Zuschüssen (nicht mit §35c/§35a). Antrag vor Maßnahmenbeginn. Setzt Z15-Basisförderung voraus.', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET foerderquote_text='0-%-Darlehen + Klimaprämie/Tilgungszuschuss (iSFP-gekoppelt)', besonderheit='Keine Einkommensgrenze. Kombinierbar mit BEG-Zuschüssen (nicht mit §35c/§35a). Antrag vor Maßnahmenbeginn. Setzt Z15-Basisförderung voraus.', status='verifiziert' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_zielgruppe WHERE programm_id=v_prog;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung) SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','hausverwaltung','bestandshalter','wohnungswirtschaft');
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'baden_wuerttemberg');
    DELETE FROM antragsschritt WHERE programm_id=v_prog;
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Beratung Zukunft Altbau', 'Kostenlose neutrale Hotline (Zukunft Altbau) zur Programmwahl nutzen.', '30 Min.', 'vor Antrag', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'BEG-Zuschuss zuerst', 'Erst BAFA-/KfW-Zuschuss beantragen; Eigenanteil danach über L-Bank.', 's. BEG', 'vor L-Bank-Antrag', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'L-Bank-Antrag vor Beginn', 'Antrag bei der L-Bank vor Maßnahmenbeginn stellen.', '1–2 Tage', 'ZWINGEND vorab', FALSE);
    DELETE FROM pflichtunterlage WHERE programm_id=v_prog;
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Nachweis Z15-Basisförderung', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'BEG-/iSFP-Nachweis', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Kostenaufstellung', TRUE);
    DELETE FROM erfolgsfaktor WHERE programm_id=v_prog;
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Beginn vor Antrag', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Kombination mit §35c EStG', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'keine Z15-Basisförderung', 3);
END $$;

-- progres.nrw – Wärmepumpe / Lüftung / Sektorkopplung (NRW)
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'Bezirksregierung Arnsberg' OR kurzname = 'Bezirksregierung Arnsberg' LIMIT 1;
    IF v_geber IS NULL THEN
        INSERT INTO foerdergeber (name, ebene) VALUES ('Bezirksregierung Arnsberg', 'land') RETURNING id INTO v_geber;
    END IF;
    SELECT id INTO v_prog FROM programm WHERE titel = 'progres.nrw – Wärmepumpe / Lüftung / Sektorkopplung (NRW)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur, kurzbeschreibung, besonderheit, status)
        VALUES ('progres.nrw – Wärmepumpe / Lüftung / Sektorkopplung (NRW)', v_geber, 'land', 'zuschuss', 'vor_vorhabenbeginn', 'Zuschuss bis ca. 2.500–3.000 € je nach Technik', NULL, NULL, 'bis ~3.000 € (kombinierbar mit BAFA/KfW)', 3000, 'Landeszuschuss für Wärmepumpen, Lüftung mit WRG und Sektorkopplung, zusätzlich zur Bundesförderung.', 'Kombinierbar mit BAFA/KfW (Kumulierungsgrenze 60 % beachten). Budgetbegrenzt — Antrag vor Beginn.', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET foerderquote_text='Zuschuss bis ca. 2.500–3.000 € je nach Technik', besonderheit='Kombinierbar mit BAFA/KfW (Kumulierungsgrenze 60 % beachten). Budgetbegrenzt — Antrag vor Beginn.', status='verifiziert' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_zielgruppe WHERE programm_id=v_prog;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung) SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein','hausverwaltung','bestandshalter','wohnungswirtschaft');
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'nordrhein_westfalen');
    DELETE FROM antragsschritt WHERE programm_id=v_prog;
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Förderfähige Technik prüfen', 'Abgleichen, ob die Anlage die progres.nrw-Anforderungen erfüllt.', '30 Min.', 'vor Antrag', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'Antrag VOR Installation', 'Online-Antrag bei der Bezirksregierung Arnsberg vor Beginn. Budget im Auge behalten.', '1 Std.', 'ZWINGEND vorab', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'Umsetzung & Nachweis', 'Installation, Rechnung und Nachweise einreichen → Auszahlung.', 'projektabh.', 'nach Abschluss', FALSE);
    DELETE FROM pflichtunterlage WHERE programm_id=v_prog;
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Angebot/Fachbetrieb', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Nachweis Technik-Anforderungen', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Rechnungen', TRUE);
    DELETE FROM erfolgsfaktor WHERE programm_id=v_prog;
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Antrag nach Installation', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Budget erschöpft', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Kumulierungsgrenze 60 % überschritten', 3);
END $$;

-- NRW.BANK.Gebäudesanierung – zinsgünstiges Darlehen (NRW)
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'NRW.BANK' OR kurzname = 'NRW.BANK' LIMIT 1;
    IF v_geber IS NULL THEN
        INSERT INTO foerdergeber (name, ebene) VALUES ('NRW.BANK', 'land') RETURNING id INTO v_geber;
    END IF;
    SELECT id INTO v_prog FROM programm WHERE titel = 'NRW.BANK.Gebäudesanierung – zinsgünstiges Darlehen (NRW)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur, kurzbeschreibung, besonderheit, status)
        VALUES ('NRW.BANK.Gebäudesanierung – zinsgünstiges Darlehen (NRW)', v_geber, 'land', 'kredit', 'vor_vorhabenbeginn', 'zinsgünstiges Darlehen, kombinierbar mit BEG', NULL, NULL, 'objektabhängig', NULL, 'Förderdarlehen des Landes für energetische Sanierung und Heizungstausch, kombinierbar mit Bund.', 'Seit 2025 keine rein fossilen Heizungen mehr förderfähig. Über die Hausbank. Vorzeitiger Beginn schließt aus.', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET foerderquote_text='zinsgünstiges Darlehen, kombinierbar mit BEG', besonderheit='Seit 2025 keine rein fossilen Heizungen mehr förderfähig. Über die Hausbank. Vorzeitiger Beginn schließt aus.', status='verifiziert' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_zielgruppe WHERE programm_id=v_prog;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung) SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein','hausverwaltung','bestandshalter','wohnungswirtschaft');
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'nordrhein_westfalen');
    DELETE FROM antragsschritt WHERE programm_id=v_prog;
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'BEG-Zuschuss zuerst', 'Bundeszuschuss beantragen, von Gesamtkosten abziehen.', 's. BEG', 'vor Darlehen', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'Darlehen über Hausbank', 'NRW.BANK-Darlehen über die Hausbank vor Vorhabenbeginn beantragen.', '1–2 Tage', 'ZWINGEND vorab', FALSE);
    DELETE FROM pflichtunterlage WHERE programm_id=v_prog;
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'BEG-Nachweis', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Kreditunterlagen Hausbank', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Sanierungsplanung', TRUE);
    DELETE FROM erfolgsfaktor WHERE programm_id=v_prog;
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Vorzeitiger Beginn', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'rein fossile Heizung', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Förderhöchstgrenze überschritten', 3);
END $$;

-- BayernLabo – Energiekredit (Bayern)
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BayernLabo' OR kurzname = 'BayernLabo' LIMIT 1;
    IF v_geber IS NULL THEN
        INSERT INTO foerdergeber (name, ebene) VALUES ('BayernLabo', 'land') RETURNING id INTO v_geber;
    END IF;
    SELECT id INTO v_prog FROM programm WHERE titel = 'BayernLabo – Energiekredit (Bayern)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur, kurzbeschreibung, besonderheit, status)
        VALUES ('BayernLabo – Energiekredit (Bayern)', v_geber, 'land', 'kredit', 'vor_vorhabenbeginn', 'zinsverbilligtes Darlehen (Einkommensgrenze)', NULL, NULL, 'objektabhängig', NULL, 'Zinsverbilligtes Landes-Darlehen für energetische Sanierung in Bayern (einzige Landesschiene; kein Landeszuschuss).', 'Bayern hat keinen Landes-Zuschuss (10.000-Häuser-Programm eingestellt). Kommunale Programme (z.B. München FKG) prüfen. Einkommensgrenze.', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET foerderquote_text='zinsverbilligtes Darlehen (Einkommensgrenze)', besonderheit='Bayern hat keinen Landes-Zuschuss (10.000-Häuser-Programm eingestellt). Kommunale Programme (z.B. München FKG) prüfen. Einkommensgrenze.', status='verifiziert' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_zielgruppe WHERE programm_id=v_prog;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung) SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','hausverwaltung','bestandshalter','wohnungswirtschaft');
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bayern');
    DELETE FROM antragsschritt WHERE programm_id=v_prog;
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Einkommensgrenze prüfen', 'Förderung an Einkommensgrenze gebunden — vorab klären.', '30 Min.', 'vor Antrag', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'Bund + ggf. Kommune zuerst', 'BEG-Förderung und kommunale Programme (z.B. München FKG) prüfen.', 's. BEG', 'vor Antrag', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'Darlehen vor Beginn', 'BayernLabo-Darlehen über die Hausbank vor Maßnahmenbeginn.', '1–2 Tage', 'ZWINGEND vorab', FALSE);
    DELETE FROM pflichtunterlage WHERE programm_id=v_prog;
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Einkommensnachweis', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'BEG-Nachweis', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Kreditunterlagen', TRUE);
    DELETE FROM erfolgsfaktor WHERE programm_id=v_prog;
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Einkommensgrenze überschritten', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Beginn vor Antrag', 3);
END $$;

-- München FKG – Förderprogramm Klimaneutrale Gebäude (Kommune)
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'Stadt München' OR kurzname = 'Stadt München' LIMIT 1;
    IF v_geber IS NULL THEN
        INSERT INTO foerdergeber (name, ebene) VALUES ('Stadt München', 'kommune') RETURNING id INTO v_geber;
    END IF;
    SELECT id INTO v_prog FROM programm WHERE titel = 'München FKG – Förderprogramm Klimaneutrale Gebäude (Kommune)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur, kurzbeschreibung, besonderheit, status)
        VALUES ('München FKG – Förderprogramm Klimaneutrale Gebäude (Kommune)', v_geber, 'kommune', 'zuschuss', 'vor_vorhabenbeginn', 'stockt BEG um 5–15 Prozentpunkte auf; Vollsanierung 10 % + Boni bis 25 %', 5, 25, 'Gesamtförderung gedeckelt auf 60 %', NULL, 'Kommunaler Aufstockungszuschuss zur Bundesförderung für Anlagentechnik und Vollsanierung in München.', 'BEG-gekoppelt: ohne bewilligte Bundesförderung kein FKG-Aufschlag. Boni (Worst-First, MFH, Wärmeplanungsgebiet) je 5 Punkte.', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET foerderquote_text='stockt BEG um 5–15 Prozentpunkte auf; Vollsanierung 10 % + Boni bis 25 %', besonderheit='BEG-gekoppelt: ohne bewilligte Bundesförderung kein FKG-Aufschlag. Boni (Worst-First, MFH, Wärmeplanungsgebiet) je 5 Punkte.', status='verifiziert' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_zielgruppe WHERE programm_id=v_prog;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung) SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','hausverwaltung','bestandshalter','wohnungswirtschaft');
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bayern');
    DELETE FROM antragsschritt WHERE programm_id=v_prog;
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Bundesförderung sichern', 'FKG setzt bewilligte KfW-/BAFA-Förderung voraus.', 's. BEG', 'vor FKG-Antrag', FALSE);
    INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'FKG-Antrag beim RKU', 'Antrag beim Referat für Klima- und Umweltschutz vor Vorhabenbeginn.', '1 Std.', 'ZWINGEND vorab', FALSE);
    DELETE FROM pflichtunterlage WHERE programm_id=v_prog;
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Bewilligte Bundesförderung', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'Objektnachweise', TRUE);
    INSERT INTO pflichtunterlage (programm_id, bezeichnung, pflicht) VALUES (v_prog, 'ggf. Nachweis Effizienzklasse (Worst-First)', TRUE);
    DELETE FROM erfolgsfaktor WHERE programm_id=v_prog;
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Keine Bundesförderung', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Beginn vor Antrag', 3);
    INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', '60-%-Deckel überschritten', 3);
END $$;

-- ============ KOMBINATIONEN ============
-- Kombination: iSFP + BEG EM Gebäudehülle
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber ORDER BY id LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Kombination: iSFP + BEG EM Gebäudehülle';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, kurzbeschreibung, besonderheit, status)
        VALUES ('Kombination: iSFP + BEG EM Gebäudehülle', v_geber, 'bund', 'beratung', 'laufend', 'Erst EBW/iSFP (50 % gefördert), dann BEG-EM-Maßnahmen mit +5 % Bonus und verdoppelten förderfähigen Kosten (60.000 €/WE). Der wirtschaftlichste Standardweg für Hülle.', 'Kombinationshinweis — mehrere Förderprogramme zusammen nutzen.', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET kurzbeschreibung='Erst EBW/iSFP (50 % gefördert), dann BEG-EM-Maßnahmen mit +5 % Bonus und verdoppelten förderfähigen Kosten (60.000 €/WE). Der wirtschaftlichste Standardweg für Hülle.' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit');
END $$;

-- Kombination: KfW 458 Heizung + BEG EM Hülle + Ergänzungskredit
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber ORDER BY id LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Kombination: KfW 458 Heizung + BEG EM Hülle + Ergänzungskredit';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, kurzbeschreibung, besonderheit, status)
        VALUES ('Kombination: KfW 458 Heizung + BEG EM Hülle + Ergänzungskredit', v_geber, 'bund', 'beratung', 'laufend', 'Heizungstausch über KfW 458 (bis 70 %), Dämmung/Fenster parallel über BAFA (bis 20 %), Restfinanzierung über KfW 358/359. Getrennte Maßnahmen, keine Doppelförderung.', 'Kombinationshinweis — mehrere Förderprogramme zusammen nutzen.', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET kurzbeschreibung='Heizungstausch über KfW 458 (bis 70 %), Dämmung/Fenster parallel über BAFA (bis 20 %), Restfinanzierung über KfW 358/359. Getrennte Maßnahmen, keine Doppelförderung.' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit');
END $$;

-- Kombination: BEG + Landesförderung (NRW)
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber ORDER BY id LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Kombination: BEG + Landesförderung (NRW)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, kurzbeschreibung, besonderheit, status)
        VALUES ('Kombination: BEG + Landesförderung (NRW)', v_geber, 'bund', 'beratung', 'laufend', 'BAFA/KfW zuerst, dann progres.nrw bzw. NRW.BANK obendrauf — Kumulierungsgrenze 60 % der förderfähigen Kosten beachten.', 'Kombinationshinweis — mehrere Förderprogramme zusammen nutzen.', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET kurzbeschreibung='BAFA/KfW zuerst, dann progres.nrw bzw. NRW.BANK obendrauf — Kumulierungsgrenze 60 % der förderfähigen Kosten beachten.' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'nordrhein_westfalen');
END $$;

-- Kombination: BEG + L-Bank Z15 (Baden-Württemberg)
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber ORDER BY id LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Kombination: BEG + L-Bank Z15 (Baden-Württemberg)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, kurzbeschreibung, besonderheit, status)
        VALUES ('Kombination: BEG + L-Bank Z15 (Baden-Württemberg)', v_geber, 'bund', 'beratung', 'laufend', 'BAFA-iSFP-Zuschuss + L-Bank-0-%-Darlehen + Tilgungszuschuss = dreifacher Hebel. Nicht mit §35c kombinierbar.', 'Kombinationshinweis — mehrere Förderprogramme zusammen nutzen.', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET kurzbeschreibung='BAFA-iSFP-Zuschuss + L-Bank-0-%-Darlehen + Tilgungszuschuss = dreifacher Hebel. Nicht mit §35c kombinierbar.' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'baden_wuerttemberg');
END $$;

-- Kombination: BEG + München FKG (Bayern/München)
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber ORDER BY id LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Kombination: BEG + München FKG (Bayern/München)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, kurzbeschreibung, besonderheit, status)
        VALUES ('Kombination: BEG + München FKG (Bayern/München)', v_geber, 'bund', 'beratung', 'laufend', 'Bundesförderung + kommunaler FKG-Aufschlag (5–15 Punkte). Gesamtdeckel 60 %. Ohne Bundesförderung kein FKG.', 'Kombinationshinweis — mehrere Förderprogramme zusammen nutzen.', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET kurzbeschreibung='Bundesförderung + kommunaler FKG-Aufschlag (5–15 Punkte). Gesamtdeckel 60 %. Ohne Bundesförderung kein FKG.' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bayern');
END $$;

-- Entweder-oder: Zuschuss (BAFA/KfW) vs. Steuer (§35c)
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber ORDER BY id LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Entweder-oder: Zuschuss (BAFA/KfW) vs. Steuer (§35c)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing, kurzbeschreibung, besonderheit, status)
        VALUES ('Entweder-oder: Zuschuss (BAFA/KfW) vs. Steuer (§35c)', v_geber, 'bund', 'beratung', 'laufend', 'Pro Maßnahme nur EIN Förderweg. §35c (20 % über 3 Jahre, max. 40.000 €) lohnt v.a. bei hoher Steuerlast und ohne Zuschussanspruch. Kein Vorab-Antrag nötig.', 'Kombinationshinweis — mehrere Förderprogramme zusammen nutzen.', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET kurzbeschreibung='Pro Maßnahme nur EIN Förderweg. §35c (20 % über 3 Jahre, max. 40.000 €) lohnt v.a. bei hoher Steuerlast und ohne Zuschussanspruch. Kein Vorab-Antrag nötig.' WHERE id=v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id) SELECT v_prog, id FROM kategorie WHERE slug='energie_gebaeude' ON CONFLICT DO NOTHING;
    DELETE FROM programm_region WHERE programm_id=v_prog;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit');
END $$;

COMMIT;

-- Kontrolle:
--   SELECT titel, ebene, art FROM programm WHERE id IN (SELECT programm_id FROM programm_kategorie pk JOIN kategorie k ON k.id=pk.kategorie_id WHERE k.slug='energie_gebaeude') ORDER BY ebene, titel;