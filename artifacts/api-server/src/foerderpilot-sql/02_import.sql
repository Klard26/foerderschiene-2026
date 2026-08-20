-- ============================================================
-- FÖRDERPILOT — automatisch generiert aus Foerderpilot-Katalog.xlsx
-- Erzeugt durch import_excel_to_sql.py — NICHT manuell editieren.
-- Idempotent: vorhandene Programme (per Titel) werden aktualisiert.
-- ============================================================
BEGIN;

-- Fördergeber (idempotent) -----------------------------------
INSERT INTO foerdergeber (name, ebene) VALUES ('Agentur für Arbeit', 'bund') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('BAFA', 'bund') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('BAFA / KfW', 'bund') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('BAFA/KfW', 'bund') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('BMBF / Länder', 'bund') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('BMUV / ZUG', 'bund') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('BMWE', 'bund') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('BMWE / Projektträger', 'bund') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('BMWE / autorisierte Berater', 'bund') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('Bund/Länder', 'bund') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('Bürgschaftsbanken der Länder', 'land') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('EU', 'eu') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('EU / CINEA', 'eu') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('EU / EIC', 'eu') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('Finanzamt', 'bund') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('Finanzamt / BSFZ', 'bund') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('IBB Berlin', 'land') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('IBB – Investitionsbank Berlin', 'land') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('IFB Hamburg', 'land') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('KfW', 'bund') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('KfW (261)', 'bund') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('KfW (358/359)', 'bund') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('L-Bank', 'land') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('Länder / EU', 'eu') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('NBank', 'land') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('NRW.ENERGY4CLIMATE', 'land') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('SAB', 'land') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('StMWi Bayern', 'land') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('Städte / Landkreise', 'kommune') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('VDI/VDE-IT (BAFA)', 'bund') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('WIBank', 'land') ON CONFLICT DO NOTHING;
INSERT INTO foerdergeber (name, ebene) VALUES ('Übertragungsnetzbetreiber', 'bund') ON CONFLICT DO NOTHING;

-- Programme + Klassifikation ---------------------------------
DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'BEG Einzelmaßnahmen – Heizungstausch';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('BEG Einzelmaßnahmen – Heizungstausch', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            '30 % Grund + Boni (Klimageschw. 20 %, Einkommen 30 %, Effizienz 5 %), max. 70 %', 30, 70, '30.000 €/WE (1.WE) → bis 21.000 € Zuschuss', 30000,
            'Antrag auch durch Heizungsbauer möglich; Biomasse +Emissionsbonus', 'bafa.de Q1/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='30 % Grund + Boni (Klimageschw. 20 %, Einkommen 30 %, Effizienz 5 %), max. 70 %', quote_min=30, quote_max=70,
            max_betrag_text='30.000 €/WE (1.WE) → bis 21.000 € Zuschuss', max_betrag_eur=30000,
            besonderheit='Antrag auch durch Heizungsbauer möglich; Biomasse +Emissionsbonus', quelle_url='bafa.de Q1/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'BEG Einzelmaßnahmen – Gebäudehülle';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('BEG Einzelmaßnahmen – Gebäudehülle', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            '15 %, +5 % mit iSFP (= 20 %)', 15, 20, '30.000 €/WE, mit iSFP 60.000 €', 60000,
            'Dämmung/Fenster nur mit Energieeffizienz-Experte beantragbar', 'bafa.de Q1/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='15 %, +5 % mit iSFP (= 20 %)', quote_min=15, quote_max=20,
            max_betrag_text='30.000 €/WE, mit iSFP 60.000 €', max_betrag_eur=60000,
            besonderheit='Dämmung/Fenster nur mit Energieeffizienz-Experte beantragbar', quelle_url='bafa.de Q1/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'BEG Heizungsoptimierung / hydraul. Abgleich';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('BEG Heizungsoptimierung / hydraul. Abgleich', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            '15 % auf förderf. Kosten (Anlage muss ≥2 Jahre alt sein)', 15, 15, 'im Rahmen 30.000 €/WE-Deckel', 30000,
            NULL, 'bafa.de – Stand Q1 2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='15 % auf förderf. Kosten (Anlage muss ≥2 Jahre alt sein)', quote_min=15, quote_max=15,
            max_betrag_text='im Rahmen 30.000 €/WE-Deckel', max_betrag_eur=30000,
            besonderheit=NULL, quelle_url='bafa.de – Stand Q1 2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein','handwerk')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Energieberatung Wohngebäude (EBW)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Energieberatung Wohngebäude (EBW)', v_geber, 'bund', 'beratung', 'vor_vorhabenbeginn',
            '50 % der Beratungskosten', 50, 50, 'max. 650 € (EFH/ZFH) / 1.300 € (MFH)', 1300,
            NULL, 'enwendo.de / bafa.de – Stand Q1 2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='beratung', timing='vor_vorhabenbeginn',
            foerderquote_text='50 % der Beratungskosten', quote_min=50, quote_max=50,
            max_betrag_text='max. 650 € (EFH/ZFH) / 1.300 € (MFH)', max_betrag_eur=1300,
            besonderheit=NULL, quelle_url='enwendo.de / bafa.de – Stand Q1 2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Fachplanung & Baubegleitung';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Fachplanung & Baubegleitung', v_geber, 'bund', 'beratung', 'vor_vorhabenbeginn',
            '50 % Zuschuss', 50, 50, 'bis ca. 2.500 € (EFH/ZFH)', 2500,
            NULL, 'enwendo.de – Stand Q1 2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='beratung', timing='vor_vorhabenbeginn',
            foerderquote_text='50 % Zuschuss', quote_min=50, quote_max=50,
            max_betrag_text='bis ca. 2.500 € (EFH/ZFH)', max_betrag_eur=2500,
            besonderheit=NULL, quelle_url='enwendo.de – Stand Q1 2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'KfW' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'KfW 261 – Wohngebäude Effizienzhaus';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('KfW 261 – Wohngebäude Effizienzhaus', v_geber, 'bund', 'kredit', 'vor_vorhabenbeginn',
            'Kredit mit Tilgungszuschuss (je Effizienzhaus-Stufe)', NULL, NULL, 'bis 150.000 € Kredit/WE', 150000,
            NULL, 'leospardo.de / kfw.de – Stand Q1 2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='kredit', timing='vor_vorhabenbeginn',
            foerderquote_text='Kredit mit Tilgungszuschuss (je Effizienzhaus-Stufe)', quote_min=NULL, quote_max=NULL,
            max_betrag_text='bis 150.000 € Kredit/WE', max_betrag_eur=150000,
            besonderheit=NULL, quelle_url='leospardo.de / kfw.de – Stand Q1 2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'KfW' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'KfW 270 – Erneuerbare Energien Standard';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('KfW 270 – Erneuerbare Energien Standard', v_geber, 'bund', 'kredit', 'vor_vorhabenbeginn',
            'Zinsgünstiger Kredit (bonitätsabhängig)', NULL, NULL, 'bis 150 Mio. €', 150000000,
            'PV, Speicher, Wind, Biogas', 'kfw.de Q1/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='kredit', timing='vor_vorhabenbeginn',
            foerderquote_text='Zinsgünstiger Kredit (bonitätsabhängig)', quote_min=NULL, quote_max=NULL,
            max_betrag_text='bis 150 Mio. €', max_betrag_eur=150000000,
            besonderheit='PV, Speicher, Wind, Biogas', quelle_url='kfw.de Q1/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein','landwirte')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'NRW.ENERGY4CLIMATE' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'progres.nrw';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('progres.nrw', v_geber, 'land', 'zuschuss', 'vor_vorhabenbeginn',
            'ergänzend zu BEG; Kumulierung max. 60 % gesamt', 60, 60, 'programmabhängig', NULL,
            'mehrere Programmlinien (Markteinführung etc.)', 'syon.de – prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='land', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='ergänzend zu BEG; Kumulierung max. 60 % gesamt', quote_min=60, quote_max=60,
            max_betrag_text='programmabhängig', max_betrag_eur=NULL,
            besonderheit='mehrere Programmlinien (Markteinführung etc.)', quelle_url='syon.de – prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'nordrhein_westfalen')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BMWE / Projektträger' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'ZIM – Einzelprojekt';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('ZIM – Einzelprojekt', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            '25–45 % Förderquote (je Größe)', 45, 45, 'max. 690.000 € förderf. Kosten', 690000,
            NULL, 'ZIM-Richtlinie V5 / förderkompass – Stand 2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='25–45 % Förderquote (je Größe)', quote_min=45, quote_max=45,
            max_betrag_text='max. 690.000 € förderf. Kosten', max_betrag_eur=690000,
            besonderheit=NULL, quelle_url='ZIM-Richtlinie V5 / förderkompass – Stand 2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'forschung_innovation'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein','freie_berufe','handwerk')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BMWE / Projektträger' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'ZIM – Kooperationsprojekt';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('ZIM – Kooperationsprojekt', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            '30–55 % Förderquote', 55, 55, 'bis 3 Mio. € Gesamtförderung', 3000000,
            NULL, 'förderkompass / consulting.de – Stand 2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='30–55 % Förderquote', quote_min=55, quote_max=55,
            max_betrag_text='bis 3 Mio. € Gesamtförderung', max_betrag_eur=3000000,
            besonderheit=NULL, quelle_url='förderkompass / consulting.de – Stand 2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'forschung_innovation'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein','forschung')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BMWE' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'ZIM – Markteinführung (ergänzend)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('ZIM – Markteinführung (ergänzend)', v_geber, 'bund', 'zuschuss', 'laufend',
            '50 % Zuschuss, bis zu 3 Anträge/Projekt', 50, 50, 'max. 100.000 € Gesamtkosten', 100000,
            NULL, 'consulting.de – Stand 2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='laufend',
            foerderquote_text='50 % Zuschuss, bis zu 3 Anträge/Projekt', quote_min=50, quote_max=50,
            max_betrag_text='max. 100.000 € Gesamtkosten', max_betrag_eur=100000,
            besonderheit=NULL, quelle_url='consulting.de – Stand 2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'forschung_innovation'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'Finanzamt / BSFZ' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Forschungszulage (FZul)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Forschungszulage (FZul)', v_geber, 'bund', 'steuer', 'laufend',
            '25 % (KMU 35 %) auf FuE-Personalkosten', 25, 35, 'bis 2,5 Mio. € Bemessungsgrundlage/Jahr', 5000000,
            NULL, 'bundesfinanzministerium / BSFZ – Sätze 2026 prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='steuer', timing='laufend',
            foerderquote_text='25 % (KMU 35 %) auf FuE-Personalkosten', quote_min=25, quote_max=35,
            max_betrag_text='bis 2,5 Mio. € Bemessungsgrundlage/Jahr', max_betrag_eur=5000000,
            besonderheit=NULL, quelle_url='bundesfinanzministerium / BSFZ – Sätze 2026 prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'forschung_innovation'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BMWE' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'EXIST-Gründerstipendium';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('EXIST-Gründerstipendium', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            'Lebensunterhalt (monatl.) + Sach-/Coachingmittel', NULL, NULL, 'bis ~3.000 €/Monat + Zuschläge', 3000,
            NULL, 'exist.de – aktuelle Sätze prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='Lebensunterhalt (monatl.) + Sach-/Coachingmittel', quote_min=NULL, quote_max=NULL,
            max_betrag_text='bis ~3.000 €/Monat + Zuschläge', max_betrag_eur=3000,
            besonderheit=NULL, quelle_url='exist.de – aktuelle Sätze prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'existenzgruendung'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('gruender','forschung')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'EU / EIC' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'EIC Accelerator';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('EIC Accelerator', v_geber, 'eu', 'beteiligung', 'stichtag_call',
            'Zuschuss + optional Eigenkapital', NULL, NULL, 'bis 2,5 Mio. € Zuschuss + bis 10 Mio. € Equity', 10000000,
            NULL, 'eic.ec.europa.eu – Calls prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='eu', art='beteiligung', timing='stichtag_call',
            foerderquote_text='Zuschuss + optional Eigenkapital', quote_min=NULL, quote_max=NULL,
            max_betrag_text='bis 2,5 Mio. € Zuschuss + bis 10 Mio. € Equity', max_betrag_eur=10000000,
            besonderheit=NULL, quelle_url='eic.ec.europa.eu – Calls prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'forschung_innovation'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein','gruender')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'eu_weit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'EU' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Horizon Europe';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Horizon Europe', v_geber, 'eu', 'zuschuss', 'stichtag_call',
            'bis 100 % (Forschung) / 70 % (Innovation)', 100, 100, 'projekt-/callabhängig', NULL,
            NULL, 'Funding & Tenders Portal – Calls prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='eu', art='zuschuss', timing='stichtag_call',
            foerderquote_text='bis 100 % (Forschung) / 70 % (Innovation)', quote_min=100, quote_max=100,
            max_betrag_text='projekt-/callabhängig', max_betrag_eur=NULL,
            besonderheit=NULL, quelle_url='Funding & Tenders Portal – Calls prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'forschung_innovation'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein','forschung')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'eu_weit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'EU / CINEA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'EU LIFE – Klima & Umwelt';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('EU LIFE – Klima & Umwelt', v_geber, 'eu', 'zuschuss', 'stichtag_call',
            'bis 60 % Kofinanzierung', 60, 60, 'projektabhängig', NULL,
            NULL, 'cinea.ec.europa.eu – Calls prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='eu', art='zuschuss', timing='stichtag_call',
            foerderquote_text='bis 60 % Kofinanzierung', quote_min=60, quote_max=60,
            max_betrag_text='projektabhängig', max_betrag_eur=NULL,
            besonderheit=NULL, quelle_url='cinea.ec.europa.eu – Calls prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'umwelt_klima'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein','forschung','kommune','npo')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'eu_weit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BMWE / autorisierte Berater' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'go-digital';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('go-digital', v_geber, 'bund', 'beratung', 'vor_vorhabenbeginn',
            '50 % der Beratungs-/Umsetzungskosten', 50, 50, 'Tagessatz gedeckelt, begrenzte Tage', NULL,
            NULL, 'Programmstatus go-digital prüfen (Auslaufrisiko)', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='beratung', timing='vor_vorhabenbeginn',
            foerderquote_text='50 % der Beratungs-/Umsetzungskosten', quote_min=50, quote_max=50,
            max_betrag_text='Tagessatz gedeckelt, begrenzte Tage', max_betrag_eur=NULL,
            besonderheit=NULL, quelle_url='Programmstatus go-digital prüfen (Auslaufrisiko)', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'digitalisierung'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein','handwerk')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'IBB – Investitionsbank Berlin' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Digitalprämie Berlin';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Digitalprämie Berlin', v_geber, 'land', 'zuschuss', 'vor_vorhabenbeginn',
            'bis 50 % Zuschuss', 50, 50, 'bis 17.000 € max. Zuschuss', 17000,
            NULL, 'ibb.de – Budgetstatus & Konditionen prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='land', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='bis 50 % Zuschuss', quote_min=50, quote_max=50,
            max_betrag_text='bis 17.000 € max. Zuschuss', max_betrag_eur=17000,
            besonderheit=NULL, quelle_url='ibb.de – Budgetstatus & Konditionen prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'digitalisierung'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'StMWi Bayern' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Digitalbonus Bayern';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Digitalbonus Bayern', v_geber, 'land', 'zuschuss', 'vor_vorhabenbeginn',
            'Zuschuss bzw. zinsverbilligter Kredit', NULL, NULL, 'Standard bis 10.000 € / Plus bis 50.000 €', 50000,
            NULL, 'Bayern Digitalbonus – Status prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='land', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='Zuschuss bzw. zinsverbilligter Kredit', quote_min=NULL, quote_max=NULL,
            max_betrag_text='Standard bis 10.000 € / Plus bis 50.000 €', max_betrag_eur=50000,
            besonderheit=NULL, quelle_url='Bayern Digitalbonus – Status prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'digitalisierung'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'Agentur für Arbeit' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Gründungszuschuss';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Gründungszuschuss', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            'ALG-I-Satz + 300 €/Monat (Phase 1, 6 Mon.), dann 300 € (9 Mon.)', NULL, NULL, 'individuell (Ermessensleistung)', NULL,
            NULL, 'arbeitsagentur.de – Konditionen prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='ALG-I-Satz + 300 €/Monat (Phase 1, 6 Mon.), dann 300 € (9 Mon.)', quote_min=NULL, quote_max=NULL,
            max_betrag_text='individuell (Ermessensleistung)', max_betrag_eur=NULL,
            besonderheit=NULL, quelle_url='arbeitsagentur.de – Konditionen prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'existenzgruendung'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('gruender')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'KfW' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'ERP-Gründerkredit – StartGeld';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('ERP-Gründerkredit – StartGeld', v_geber, 'bund', 'kredit', 'vor_vorhabenbeginn',
            'Förderkredit, 80 % Haftungsfreistellung', 80, 80, 'bis 125.000 € (max. 50.000 € Betriebsmittel)', 125000,
            NULL, 'kfw.de – Konditionen prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='kredit', timing='vor_vorhabenbeginn',
            foerderquote_text='Förderkredit, 80 % Haftungsfreistellung', quote_min=80, quote_max=80,
            max_betrag_text='bis 125.000 € (max. 50.000 € Betriebsmittel)', max_betrag_eur=125000,
            besonderheit=NULL, quelle_url='kfw.de – Konditionen prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'existenzgruendung'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein','gruender')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'INVEST – Zuschuss für Wagniskapital';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('INVEST – Zuschuss für Wagniskapital', v_geber, 'bund', 'zuschuss', 'laufend',
            '20 % des Investments als Zuschuss (Erwerb + Exit)', 20, 20, 'Erwerbszuschuss bis 100.000 €/Jahr', 100000,
            NULL, 'bafa.de INVEST – prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='laufend',
            foerderquote_text='20 % des Investments als Zuschuss (Erwerb + Exit)', quote_min=20, quote_max=20,
            max_betrag_text='Erwerbszuschuss bis 100.000 €/Jahr', max_betrag_eur=100000,
            besonderheit=NULL, quelle_url='bafa.de INVEST – prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'wachstum_investition'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('gruender','kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'Bund/Länder' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'GRW – Gewerbliche Investitionsförderung';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('GRW – Gewerbliche Investitionsförderung', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            'Investitionszuschuss (regionale Höchstsätze)', NULL, NULL, 'quoten-/regionsabhängig', NULL,
            NULL, 'GRW-Koordinierungsrahmen – Region prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='Investitionszuschuss (regionale Höchstsätze)', quote_min=NULL, quote_max=NULL,
            max_betrag_text='quoten-/regionsabhängig', max_betrag_eur=NULL,
            besonderheit=NULL, quelle_url='GRW-Koordinierungsrahmen – Region prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'regionale_entwicklung'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'foerdergebiet_grw')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'Bürgschaftsbanken der Länder' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Bürgschaft Bürgschaftsbank';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Bürgschaft Bürgschaftsbank', v_geber, 'land', 'buergschaft', 'laufend',
            'Ausfallbürgschaft für Bankkredite', NULL, NULL, 'bis 80 % / i. d. R. bis 1,25–2,5 Mio. €', 5000000,
            NULL, 'Bürgschaftsbank des jeweiligen Landes prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='land', art='buergschaft', timing='laufend',
            foerderquote_text='Ausfallbürgschaft für Bankkredite', quote_min=NULL, quote_max=NULL,
            max_betrag_text='bis 80 % / i. d. R. bis 1,25–2,5 Mio. €', max_betrag_eur=5000000,
            besonderheit=NULL, quelle_url='Bürgschaftsbank des jeweiligen Landes prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'wachstum_investition'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein','gruender','freie_berufe')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BMBF / Länder' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Aufstiegs-BAföG (Meister-BAföG)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Aufstiegs-BAföG (Meister-BAföG)', v_geber, 'bund', 'zuschuss', 'laufend',
            'Zuschuss + zinsg. Darlehen für Lehrgang/Prüfung', NULL, NULL, 'lehrgangsabhängig', NULL,
            NULL, 'aufstiegs-bafoeg.de – prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='laufend',
            foerderquote_text='Zuschuss + zinsg. Darlehen für Lehrgang/Prüfung', quote_min=NULL, quote_max=NULL,
            max_betrag_text='lehrgangsabhängig', max_betrag_eur=NULL,
            besonderheit=NULL, quelle_url='aufstiegs-bafoeg.de – prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'qualifizierung'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('handwerk')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'Agentur für Arbeit' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Qualifizierungschancengesetz / WeGebAU';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Qualifizierungschancengesetz / WeGebAU', v_geber, 'bund', 'zuschuss', 'laufend',
            'Zuschuss zu Lehrgangskosten + Lohnkosten', NULL, NULL, 'größenabhängige Quote', NULL,
            NULL, 'arbeitsagentur.de – prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='laufend',
            foerderquote_text='Zuschuss zu Lehrgangskosten + Lohnkosten', quote_min=NULL, quote_max=NULL,
            max_betrag_text='größenabhängige Quote', max_betrag_eur=NULL,
            besonderheit=NULL, quelle_url='arbeitsagentur.de – prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'qualifizierung'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'BEG EM – Anlagentechnik (außer Heizung)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('BEG EM – Anlagentechnik (außer Heizung)', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            '15 %, +5 % iSFP', 15, 15, 'im 30.000 €/WE-Deckel', 30000,
            'z. B. Lüftung mit Wärmerückgewinnung', 'bafa.de Q1/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='15 %, +5 % iSFP', quote_min=15, quote_max=15,
            max_betrag_text='im 30.000 €/WE-Deckel', max_betrag_eur=30000,
            besonderheit='z. B. Lüftung mit Wärmerückgewinnung', quelle_url='bafa.de Q1/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'BEG EM – Heizungsoptimierung / hydraul. Abgleich';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('BEG EM – Heizungsoptimierung / hydraul. Abgleich', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            '15 %', 15, 15, 'im 30.000 €/WE-Deckel', 30000,
            'Anlage muss ≥ 2 Jahre alt sein', 'bafa.de Q1/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='15 %', quote_min=15, quote_max=15,
            max_betrag_text='im 30.000 €/WE-Deckel', max_betrag_eur=30000,
            besonderheit='Anlage muss ≥ 2 Jahre alt sein', quelle_url='bafa.de Q1/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein','handwerk')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'KfW (261)' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'BEG Wohngebäude – Effizienzhaus (Kredit)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('BEG Wohngebäude – Effizienzhaus (Kredit)', v_geber, 'bund', 'kredit', 'vor_vorhabenbeginn',
            'Kredit + Tilgungszuschuss je EH-Stufe', NULL, NULL, 'bis 150.000 € Kredit/WE', 150000,
            'Effizienzhaus-Stufen EH85–EH40; EE-Klasse-Bonus', 'kfw.de/leospardo Q1/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='kredit', timing='vor_vorhabenbeginn',
            foerderquote_text='Kredit + Tilgungszuschuss je EH-Stufe', quote_min=NULL, quote_max=NULL,
            max_betrag_text='bis 150.000 € Kredit/WE', max_betrag_eur=150000,
            besonderheit='Effizienzhaus-Stufen EH85–EH40; EE-Klasse-Bonus', quelle_url='kfw.de/leospardo Q1/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'BEG Nichtwohngebäude – Einzelmaßnahmen';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('BEG Nichtwohngebäude – Einzelmaßnahmen', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            '30–65 % je Maßnahme', 65, 65, 'bis 15 Mio. € pro Vorhaben', 15000000,
            'Gewerbliche Heizungsförderung NWG', 'syon.de Q1/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='30–65 % je Maßnahme', quote_min=65, quote_max=65,
            max_betrag_text='bis 15 Mio. € pro Vorhaben', max_betrag_eur=15000000,
            besonderheit='Gewerbliche Heizungsförderung NWG', quelle_url='syon.de Q1/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'KfW' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'BEG Nichtwohngebäude – Effizienzgebäude (Kredit)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('BEG Nichtwohngebäude – Effizienzgebäude (Kredit)', v_geber, 'bund', 'kredit', 'vor_vorhabenbeginn',
            'Kredit + Tilgungszuschuss', NULL, NULL, 'kostenabhängig', NULL,
            'Effizienzgebäude-Stufen für NWG', 'kfw.de – prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='kredit', timing='vor_vorhabenbeginn',
            foerderquote_text='Kredit + Tilgungszuschuss', quote_min=NULL, quote_max=NULL,
            max_betrag_text='kostenabhängig', max_betrag_eur=NULL,
            besonderheit='Effizienzgebäude-Stufen für NWG', quelle_url='kfw.de – prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein','kommune')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'KfW (358/359)' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Heizungsförderung Ergänzungskredit';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Heizungsförderung Ergänzungskredit', v_geber, 'bund', 'kredit', 'laufend',
            'Zinsgünstiger Ergänzungskredit zum BAFA-Zuschuss', NULL, NULL, 'bis 120.000 € (einkommensabhängig vergünstigt)', 120000,
            'Kombinierbar mit BEG-Heizungszuschuss', 'kfw.de – prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='kredit', timing='laufend',
            foerderquote_text='Zinsgünstiger Ergänzungskredit zum BAFA-Zuschuss', quote_min=NULL, quote_max=NULL,
            max_betrag_text='bis 120.000 € (einkommensabhängig vergünstigt)', max_betrag_eur=120000,
            besonderheit='Kombinierbar mit BEG-Heizungszuschuss', quelle_url='kfw.de – prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Energieberatung für Wohngebäude (EBW)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Energieberatung für Wohngebäude (EBW)', v_geber, 'bund', 'beratung', 'vor_vorhabenbeginn',
            '50 % der Beratungskosten', 50, 50, '650 € EFH/ZFH · 1.300 € MFH', 1300,
            'Erstellt iSFP – Türöffner für 5 % Bonus', 'enwendo/bafa Q1/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='beratung', timing='vor_vorhabenbeginn',
            foerderquote_text='50 % der Beratungskosten', quote_min=50, quote_max=50,
            max_betrag_text='650 € EFH/ZFH · 1.300 € MFH', max_betrag_eur=1300,
            besonderheit='Erstellt iSFP – Türöffner für 5 % Bonus', quelle_url='enwendo/bafa Q1/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Energieberatung Mittelstand / Nichtwohngeb. (EBN)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Energieberatung Mittelstand / Nichtwohngeb. (EBN)', v_geber, 'bund', 'beratung', 'vor_vorhabenbeginn',
            'bis 80 % / je nach Energiekostenklasse', 80, 80, 'bis 6.000 € (>10.000 € Energiekosten) bzw. 1.200 €', 10000,
            'Modul I/II je nach Energiekosten', 'bafa.de – Sätze prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='beratung', timing='vor_vorhabenbeginn',
            foerderquote_text='bis 80 % / je nach Energiekostenklasse', quote_min=80, quote_max=80,
            max_betrag_text='bis 6.000 € (>10.000 € Energiekosten) bzw. 1.200 €', max_betrag_eur=10000,
            besonderheit='Modul I/II je nach Energiekosten', quelle_url='bafa.de – Sätze prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Fachplanung & Baubegleitung (BEG)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Fachplanung & Baubegleitung (BEG)', v_geber, 'bund', 'beratung', 'vor_vorhabenbeginn',
            '50 % Zuschuss', 50, 50, 'bis ca. 2.500 € (EFH/ZFH)', 2500,
            'dena-gelisteter Experte verpflichtend', 'enwendo Q1/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='beratung', timing='vor_vorhabenbeginn',
            foerderquote_text='50 % Zuschuss', quote_min=50, quote_max=50,
            max_betrag_text='bis ca. 2.500 € (EFH/ZFH)', max_betrag_eur=2500,
            besonderheit='dena-gelisteter Experte verpflichtend', quelle_url='enwendo Q1/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'EEW Modul 1 – Querschnittstechnologien';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('EEW Modul 1 – Querschnittstechnologien', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            'Anteilsfinanzierung; Quote modul-/größenabhängig (10–60 %)', 60, 60, 'Zuschüsse max. 20 Mio. €', 20000000,
            'z. B. Pumpen, Motoren, Druckluft', 'ecovis/ecoplanet Q1/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='Anteilsfinanzierung; Quote modul-/größenabhängig (10–60 %)', quote_min=60, quote_max=60,
            max_betrag_text='Zuschüsse max. 20 Mio. €', max_betrag_eur=20000000,
            besonderheit='z. B. Pumpen, Motoren, Druckluft', quelle_url='ecovis/ecoplanet Q1/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'EEW Modul 2 – Prozesswärme aus EE';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('EEW Modul 2 – Prozesswärme aus EE', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            '10–60 % je Größe', 60, 60, 'max. 20 Mio. €', 20000000,
            'Erneuerbare Prozesswärme', 'ecoplanet Q1/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='10–60 % je Größe', quote_min=60, quote_max=60,
            max_betrag_text='max. 20 Mio. €', max_betrag_eur=20000000,
            besonderheit='Erneuerbare Prozesswärme', quelle_url='ecoplanet Q1/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'EEW Modul 3 – MSR, Sensorik, Energiemanagement';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('EEW Modul 3 – MSR, Sensorik, Energiemanagement', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            'Anteilsfinanzierung', NULL, NULL, 'max. 20 Mio. €', 20000000,
            'Digitalisierung der Energieflüsse', 'deutsche-foerdermittelberatung Q2/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='Anteilsfinanzierung', quote_min=NULL, quote_max=NULL,
            max_betrag_text='max. 20 Mio. €', max_betrag_eur=20000000,
            besonderheit='Digitalisierung der Energieflüsse', quelle_url='deutsche-foerdermittelberatung Q2/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'EEW Modul 4 – Energiebezogene Optimierung Anlagen';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('EEW Modul 4 – Energiebezogene Optimierung Anlagen', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            'Anteilsfinanzierung', NULL, NULL, 'max. 20 Mio. €', 20000000,
            'Optimierung bestehender Anlagen', 'ecovis Q1/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='Anteilsfinanzierung', quote_min=NULL, quote_max=NULL,
            max_betrag_text='max. 20 Mio. €', max_betrag_eur=20000000,
            besonderheit='Optimierung bestehender Anlagen', quelle_url='ecovis Q1/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'VDI/VDE-IT (BAFA)' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'EEW Modul 5 – Transformationskonzepte';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('EEW Modul 5 – Transformationskonzepte', v_geber, 'bund', 'beratung', 'vor_vorhabenbeginn',
            'Quote nach AGVO; +10 % bei IEEKN-Netzwerk', 10, 10, 'max. 50.000 € (80.000 € im Netzwerk)', 80000,
            'Antrag über VDI/VDE-IT, nicht BAFA', 'IHK SBH Q1/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='beratung', timing='vor_vorhabenbeginn',
            foerderquote_text='Quote nach AGVO; +10 % bei IEEKN-Netzwerk', quote_min=10, quote_max=10,
            max_betrag_text='max. 50.000 € (80.000 € im Netzwerk)', max_betrag_eur=80000,
            besonderheit='Antrag über VDI/VDE-IT, nicht BAFA', quelle_url='IHK SBH Q1/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'EEW Modul 6 – Elektrifizierung (fossil→Strom)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('EEW Modul 6 – Elektrifizierung (fossil→Strom)', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            'pauschal ~20 % bzw. 1.200 €/t CO₂/Jahr', 20, 20, 'max. 20 Mio. €', 20000000,
            'Prozesswechsel fossil zu elektrisch', 'IHK SBH / ecovis Q1/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='pauschal ~20 % bzw. 1.200 €/t CO₂/Jahr', quote_min=20, quote_max=20,
            max_betrag_text='max. 20 Mio. €', max_betrag_eur=20000000,
            besonderheit='Prozesswechsel fossil zu elektrisch', quelle_url='IHK SBH / ecovis Q1/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'BEW Modul 1 – Machbarkeit/Planung';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('BEW Modul 1 – Machbarkeit/Planung', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            '50 % der förderfähigen Kosten', 50, 50, 'max. 2 Mio. €', 2000000,
            'Transformationspläne ab 1.4.2026 entfallen (nur noch Machbarkeit)', 'bafa/energiekonsens Q2/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='50 % der förderfähigen Kosten', quote_min=50, quote_max=50,
            max_betrag_text='max. 2 Mio. €', max_betrag_eur=2000000,
            besonderheit='Transformationspläne ab 1.4.2026 entfallen (nur noch Machbarkeit)', quelle_url='bafa/energiekonsens Q2/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein','kommune')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'BEW Modul 2 – Systemische Förderung Netze';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('BEW Modul 2 – Systemische Förderung Netze', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            'bis 40 %', 40, 40, 'max. 100 Mio. € (Wirtschaftlichkeitslücke)', 100000000,
            'Neubau/Bestand mit ≥75 % EE/Abwärme', 'energiekonsens Q1/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='bis 40 %', quote_min=40, quote_max=40,
            max_betrag_text='max. 100 Mio. € (Wirtschaftlichkeitslücke)', max_betrag_eur=100000000,
            besonderheit='Neubau/Bestand mit ≥75 % EE/Abwärme', quelle_url='energiekonsens Q1/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kommune','kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'BEW Modul 3 – Einzelmaßnahmen Bestandsnetze';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('BEW Modul 3 – Einzelmaßnahmen Bestandsnetze', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            'bis 40 %', 40, 40, 'max. 100 Mio. € je Antrag', 100000000,
            'z. B. Solarthermie, Großwärmepumpen, Speicher', 'energiekonsens Q1/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='bis 40 %', quote_min=40, quote_max=40,
            max_betrag_text='max. 100 Mio. € je Antrag', max_betrag_eur=100000000,
            besonderheit='z. B. Solarthermie, Großwärmepumpen, Speicher', quelle_url='energiekonsens Q1/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'BEW Modul 4 – Betriebskostenförderung';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('BEW Modul 4 – Betriebskostenförderung', v_geber, 'bund', 'zuschuss', 'laufend',
            'technologieabhängig (ct/kWh)', NULL, NULL, 'max. 100 Mio. €', 100000000,
            'für Solarthermie & strombetriebene WP', 'energiekonsens Q1/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='laufend',
            foerderquote_text='technologieabhängig (ct/kWh)', quote_min=NULL, quote_max=NULL,
            max_betrag_text='max. 100 Mio. €', max_betrag_eur=100000000,
            besonderheit='für Solarthermie & strombetriebene WP', quelle_url='energiekonsens Q1/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'Übertragungsnetzbetreiber' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'EEG-Einspeisevergütung / Marktprämie';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('EEG-Einspeisevergütung / Marktprämie', v_geber, 'bund', 'zuschuss', 'laufend',
            'gesetzlich festgelegte Vergütungssätze', NULL, NULL, 'anlagenabhängig', NULL,
            'kein Antrag i.e.S.; Vergütung nach EEG', 'EEG 2023/2026 – Sätze prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='laufend',
            foerderquote_text='gesetzlich festgelegte Vergütungssätze', quote_min=NULL, quote_max=NULL,
            max_betrag_text='anlagenabhängig', max_betrag_eur=NULL,
            besonderheit='kein Antrag i.e.S.; Vergütung nach EEG', quelle_url='EEG 2023/2026 – Sätze prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'KfW' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'KfW 442 – Solarstrom für Elektroautos (Status?)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('KfW 442 – Solarstrom für Elektroautos (Status?)', v_geber, 'bund', 'zuschuss', 'budget_topf',
            'Festbetrag PV+Speicher+Wallbox', NULL, NULL, 'Programm war mehrfach ausgeschöpft', NULL,
            'Achtung: Verfügbarkeit prüfen, oft geschlossen', 'kfw.de – Verfügbarkeit prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='budget_topf',
            foerderquote_text='Festbetrag PV+Speicher+Wallbox', quote_min=NULL, quote_max=NULL,
            max_betrag_text='Programm war mehrfach ausgeschöpft', max_betrag_eur=NULL,
            besonderheit='Achtung: Verfügbarkeit prüfen, oft geschlossen', quelle_url='kfw.de – Verfügbarkeit prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'IBB Berlin' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Klimaschutzoffensive / IBB Energie';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Klimaschutzoffensive / IBB Energie', v_geber, 'land', 'zuschuss', 'vor_vorhabenbeginn',
            'programmabhängig', NULL, NULL, 'programmabhängig', NULL,
            'diverse Berliner Energieprogramme', 'ibb.de – prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='land', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='programmabhängig', quote_min=NULL, quote_max=NULL,
            max_betrag_text='programmabhängig', max_betrag_eur=NULL,
            besonderheit='diverse Berliner Energieprogramme', quelle_url='ibb.de – prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'berlin')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'StMWi Bayern' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = '10.000-Häuser-Programm / EnergieBonusBayern';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('10.000-Häuser-Programm / EnergieBonusBayern', v_geber, 'land', 'zuschuss', 'vor_vorhabenbeginn',
            'Festbeträge je Maßnahmenpaket', NULL, NULL, 'paketabhängig', NULL,
            'ergänzend zu BEG', 'Bayern – Status prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='land', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='Festbeträge je Maßnahmenpaket', quote_min=NULL, quote_max=NULL,
            max_betrag_text='paketabhängig', max_betrag_eur=NULL,
            besonderheit='ergänzend zu BEG', quelle_url='Bayern – Status prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bayern')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'IFB Hamburg' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Hamburg: Erneuerbare Wärme / IFB';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Hamburg: Erneuerbare Wärme / IFB', v_geber, 'land', 'zuschuss', 'vor_vorhabenbeginn',
            'programmabhängig', NULL, NULL, 'programmabhängig', NULL,
            'IFB Förderlotse', 'ifbhh.de – prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='land', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='programmabhängig', quote_min=NULL, quote_max=NULL,
            max_betrag_text='programmabhängig', max_betrag_eur=NULL,
            besonderheit='IFB Förderlotse', quelle_url='ifbhh.de – prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'hamburg')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'L-Bank' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Baden-Württemberg: Klimaschutz-Plus / L-Bank';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Baden-Württemberg: Klimaschutz-Plus / L-Bank', v_geber, 'land', 'zuschuss', 'vor_vorhabenbeginn',
            'programmabhängig', NULL, NULL, 'programmabhängig', NULL,
            'diverse Programmlinien', 'l-bank.de – prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='land', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='programmabhängig', quote_min=NULL, quote_max=NULL,
            max_betrag_text='programmabhängig', max_betrag_eur=NULL,
            besonderheit='diverse Programmlinien', quelle_url='l-bank.de – prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein','kommune')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'baden_wuerttemberg')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'WIBank' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Hessen: progres / WIBank Energieprogramme';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Hessen: progres / WIBank Energieprogramme', v_geber, 'land', 'zuschuss', 'vor_vorhabenbeginn',
            'programmabhängig', NULL, NULL, 'programmabhängig', NULL,
            'WIBank Energieförderung', 'wibank.de – prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='land', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='programmabhängig', quote_min=NULL, quote_max=NULL,
            max_betrag_text='programmabhängig', max_betrag_eur=NULL,
            besonderheit='WIBank Energieförderung', quelle_url='wibank.de – prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein','kommune')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'hessen')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'SAB' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Sachsen: SAB Energie / Klima';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Sachsen: SAB Energie / Klima', v_geber, 'land', 'zuschuss', 'vor_vorhabenbeginn',
            'programmabhängig', NULL, NULL, 'programmabhängig', NULL,
            'Sächsische Aufbaubank', 'sab.sachsen.de – prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='land', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='programmabhängig', quote_min=NULL, quote_max=NULL,
            max_betrag_text='programmabhängig', max_betrag_eur=NULL,
            besonderheit='Sächsische Aufbaubank', quelle_url='sab.sachsen.de – prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein','kommune')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'sachsen')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'NBank' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Niedersachsen: NBank Energie/Klima';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Niedersachsen: NBank Energie/Klima', v_geber, 'land', 'zuschuss', 'vor_vorhabenbeginn',
            'programmabhängig', NULL, NULL, 'programmabhängig', NULL,
            'diverse Klimaprogramme', 'nbank.de – prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='land', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='programmabhängig', quote_min=NULL, quote_max=NULL,
            max_betrag_text='programmabhängig', max_betrag_eur=NULL,
            besonderheit='diverse Klimaprogramme', quelle_url='nbank.de – prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein','kommune')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'niedersachsen')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'Städte / Landkreise' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Kommunale Klimaschutz-/Förderprogramme';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Kommunale Klimaschutz-/Förderprogramme', v_geber, 'kommune', 'zuschuss', 'vor_vorhabenbeginn',
            'Aufstockung 5–15 %-Punkte (z. B. FKG München)', 15, 15, 'kommunal gedeckelt', NULL,
            'oft mit BEG/Land kombinierbar', 'jeweilige Kommune prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='kommune', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='Aufstockung 5–15 %-Punkte (z. B. FKG München)', quote_min=15, quote_max=15,
            max_betrag_text='kommunal gedeckelt', max_betrag_eur=NULL,
            besonderheit='oft mit BEG/Land kombinierbar', quelle_url='jeweilige Kommune prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BMUV / ZUG' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Kommunalrichtlinie (NKI)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Kommunalrichtlinie (NKI)', v_geber, 'bund', 'zuschuss', 'stichtag_call',
            'bis 70–90 % je Maßnahme', 90, 90, 'maßnahmenabhängig', NULL,
            'Nationale Klimaschutzinitiative', 'klimaschutz.de – prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='stichtag_call',
            foerderquote_text='bis 70–90 % je Maßnahme', quote_min=90, quote_max=90,
            max_betrag_text='maßnahmenabhängig', max_betrag_eur=NULL,
            besonderheit='Nationale Klimaschutzinitiative', quelle_url='klimaschutz.de – prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein','kommune','npo')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'EU / CINEA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'EU LIFE – Clean Energy Transition';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('EU LIFE – Clean Energy Transition', v_geber, 'eu', 'zuschuss', 'stichtag_call',
            'bis 60 % Kofinanzierung', 60, 60, 'projektabhängig', NULL,
            'Marktnahe Energiewende-Projekte', 'cinea.ec.europa.eu – Calls', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='eu', art='zuschuss', timing='stichtag_call',
            foerderquote_text='bis 60 % Kofinanzierung', quote_min=60, quote_max=60,
            max_betrag_text='projektabhängig', max_betrag_eur=NULL,
            besonderheit='Marktnahe Energiewende-Projekte', quelle_url='cinea.ec.europa.eu – Calls', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'umwelt_klima'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein','forschung','kommune','npo')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'eu_weit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'EU' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Horizon Europe – Cluster 5 (Energie/Klima)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Horizon Europe – Cluster 5 (Energie/Klima)', v_geber, 'eu', 'zuschuss', 'stichtag_call',
            'bis 100 % (Forschung) / 70 % (Innovation)', 100, 100, 'call-/projektabhängig', NULL,
            'Energieforschung & -innovation', 'Funding & Tenders Portal', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='eu', art='zuschuss', timing='stichtag_call',
            foerderquote_text='bis 100 % (Forschung) / 70 % (Innovation)', quote_min=100, quote_max=100,
            max_betrag_text='call-/projektabhängig', max_betrag_eur=NULL,
            besonderheit='Energieforschung & -innovation', quelle_url='Funding & Tenders Portal', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'umwelt_klima'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein','forschung')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'eu_weit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'EU / CINEA' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'EU Innovation Fund';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('EU Innovation Fund', v_geber, 'eu', 'zuschuss', 'stichtag_call',
            'bis 60 % der Mehrkosten', 60, 60, 'sehr hohe Volumina', NULL,
            'Dekarbonisierung Industrie', 'cinea – Innovation Fund', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='eu', art='zuschuss', timing='stichtag_call',
            foerderquote_text='bis 60 % der Mehrkosten', quote_min=60, quote_max=60,
            max_betrag_text='sehr hohe Volumina', max_betrag_eur=NULL,
            besonderheit='Dekarbonisierung Industrie', quelle_url='cinea – Innovation Fund', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'umwelt_klima'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'eu_weit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'Länder / EU' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'EFRE – Energie/Klima (Landesumsetzung)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('EFRE – Energie/Klima (Landesumsetzung)', v_geber, 'eu', 'zuschuss', 'stichtag_call',
            'kofinanzierungsabhängig', NULL, NULL, 'programmabhängig', NULL,
            'EU-Strukturfonds über Landesbehörden', 'jeweiliges EFRE-Landesprogramm', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='eu', art='zuschuss', timing='stichtag_call',
            foerderquote_text='kofinanzierungsabhängig', quote_min=NULL, quote_max=NULL,
            max_betrag_text='programmabhängig', max_betrag_eur=NULL,
            besonderheit='EU-Strukturfonds über Landesbehörden', quelle_url='jeweiliges EFRE-Landesprogramm', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'umwelt_klima'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('kmu_klein','kommune')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'Finanzamt' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Steuerermäßigung energet. Sanierung (§35c EStG)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Steuerermäßigung energet. Sanierung (§35c EStG)', v_geber, 'bund', 'steuer', 'laufend',
            '20 % über 3 Jahre verteilt', 20, 20, 'max. 40.000 € je Objekt', 40000,
            'Alternative zu BAFA/KfW (nicht kombinierbar)', 'leospardo §35c Q1/2026', 'verifiziert')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='steuer', timing='laufend',
            foerderquote_text='20 % über 3 Jahre verteilt', quote_min=20, quote_max=20,
            max_betrag_text='max. 40.000 € je Objekt', max_betrag_eur=40000,
            besonderheit='Alternative zu BAFA/KfW (nicht kombinierbar)', quelle_url='leospardo §35c Q1/2026', status='verifiziert'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'Finanzamt' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Handwerkerleistungen Steuerbonus (§35a EStG)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Handwerkerleistungen Steuerbonus (§35a EStG)', v_geber, 'bund', 'steuer', 'laufend',
            '20 % der Lohnkosten', 20, 20, 'max. 1.200 €/Jahr', 1200,
            'für nicht anderweitig geförderte Arbeiten', '§35a EStG – prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='steuer', timing='laufend',
            foerderquote_text='20 % der Lohnkosten', quote_min=20, quote_max=20,
            max_betrag_text='max. 1.200 €/Jahr', max_betrag_eur=1200,
            besonderheit='für nicht anderweitig geförderte Arbeiten', quelle_url='§35a EStG – prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'KfW' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'KfW 159 – Altersgerecht/Barriere reduzieren';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('KfW 159 – Altersgerecht/Barriere reduzieren', v_geber, 'bund', 'kredit', 'vor_vorhabenbeginn',
            'Zinsgünstiger Kredit', NULL, NULL, 'bis 50.000 €/WE', 50000,
            'teils mit Energie-Maßnahmen kombinierbar', 'kfw.de – prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='kredit', timing='vor_vorhabenbeginn',
            foerderquote_text='Zinsgünstiger Kredit', quote_min=NULL, quote_max=NULL,
            max_betrag_text='bis 50.000 €/WE', max_betrag_eur=50000,
            besonderheit='teils mit Energie-Maßnahmen kombinierbar', quelle_url='kfw.de – prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA/KfW' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'WEG-Förderung (gemeinschaftl. Eigentum)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('WEG-Förderung (gemeinschaftl. Eigentum)', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            'wie BEG, je Maßnahme', NULL, NULL, 'je WE-Deckel', NULL,
            'Besonderheiten bei Antrag durch WEG/Verwalter', 'BEG-Regeln WEG prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='wie BEG, je Maßnahme', quote_min=NULL, quote_max=NULL,
            max_betrag_text='je WE-Deckel', max_betrag_eur=NULL,
            besonderheit='Besonderheiten bei Antrag durch WEG/Verwalter', quelle_url='BEG-Regeln WEG prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE v_prog UUID; v_geber INTEGER;
BEGIN
    SELECT id INTO v_geber FROM foerdergeber WHERE name = 'BAFA/KfW' LIMIT 1;
    SELECT id INTO v_prog FROM programm WHERE titel = 'Serielle Sanierung (Zusatzbonus)';
    IF v_prog IS NULL THEN
        INSERT INTO programm (titel, foerdergeber_id, ebene, art, timing,
            foerderquote_text, quote_min, quote_max, max_betrag_text, max_betrag_eur,
            besonderheit, quelle_url, status)
        VALUES ('Serielle Sanierung (Zusatzbonus)', v_geber, 'bund', 'zuschuss', 'vor_vorhabenbeginn',
            'Bonus auf Effizienzhaus-Förderung', NULL, NULL, 'im EH-Rahmen', NULL,
            'für vorgefertigte serielle Sanierungselemente', 'BEG serielle Sanierung prüfen', 'zu_pruefen')
        RETURNING id INTO v_prog;
    ELSE
        UPDATE programm SET ebene='bund', art='zuschuss', timing='vor_vorhabenbeginn',
            foerderquote_text='Bonus auf Effizienzhaus-Förderung', quote_min=NULL, quote_max=NULL,
            max_betrag_text='im EH-Rahmen', max_betrag_eur=NULL,
            besonderheit='für vorgefertigte serielle Sanierungselemente', quelle_url='BEG serielle Sanierung prüfen', status='zu_pruefen'
        WHERE id = v_prog;
    END IF;
    INSERT INTO programm_kategorie (programm_id, kategorie_id)
        SELECT v_prog, id FROM kategorie WHERE slug = 'energie_gebaeude'
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_zielgruppe (programm_id, zielgruppe_id, eignung)
        SELECT v_prog, id, 'voll' FROM zielgruppe WHERE slug IN ('privat','kmu_klein')
        ON CONFLICT DO NOTHING;
    INSERT INTO programm_region (programm_id, region) VALUES (v_prog, 'bundesweit')
        ON CONFLICT DO NOTHING;
END $$;

-- Antragspfade (Schritt-für-Schritt) -------------------------
DO $$
DECLARE v_prog UUID;
BEGIN
    SELECT id INTO v_prog FROM programm WHERE titel = 'BEG Einzelmaßnahmen – Heizungstausch';
    IF v_prog IS NOT NULL THEN
        DELETE FROM antragsschritt WHERE programm_id = v_prog;
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Förderfähigkeit prüfen', 'Abgleichen, ob Gebäude und Heizsystem die technischen Mindestanforderungen (TMA) erfüllen. Neue Heizung muss ≥ 65 % erneuerbare Wärme erzeugen (nur Wärmepumpe, Biomasse, Hybrid förderfähig).', '30 Min.', 'vor Antrag', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'Boni-Anspruch klären', 'Prüfen, welche Boni greifen: Klimageschwindigkeitsbonus (20 %), Einkommensbonus (30 % bei zvE ≤ 40.000 €), Effizienzbonus (5 %). Für Einkommensbonus Steuerbescheid bereithalten.', '30 Min.', 'vor Antrag', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'Fachbetrieb-Angebot einholen', 'Angebot eines Fachunternehmens mit aufschiebend bedingtem Liefer-/Leistungsvertrag (Bedingung: Förderzusage) einholen. Der Vertrag darf nur unter Vorbehalt der Förderung geschlossen werden.', '1–2 Tage', 'vor Antrag', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 4, 'Antrag im FZD/BAFA-Portal stellen — VOR Auftragsvergabe', 'Antrag online stellen, BEVOR ein unbedingter Auftrag vergeben wird. Dies ist der kritischste Schritt: Wird vorher beauftragt, entfällt die gesamte Förderung.', '1 Std.', 'ZWINGEND vorab', FALSE);
        INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Kritischer Schritt missachtet: Antrag im FZD/BAFA-Portal stellen — VOR Auftragsvergabe', 3);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 5, 'Zuwendungsbescheid abwarten', 'Bewilligung abwarten. Erst nach Bescheid (oder bei aufschiebend bedingtem Vertrag) mit der Maßnahme starten.', 'reaktiv', '~Wochen', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 6, 'Maßnahme umsetzen', 'Heizung durch Fachbetrieb im Bewilligungszeitraum einbauen lassen. Fachunternehmererklärung vom Betrieb ausfüllen lassen.', 'projektabh.', 'i.d.R. 36 Mon.', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 7, 'Verwendungsnachweis & Auszahlung', 'Rechnung, Fachunternehmererklärung und Zahlungsnachweis im Portal hochladen. Nach Prüfung erfolgt Auszahlung des Zuschusses.', '2 Std.', 'nach Abschluss', FALSE);
    END IF;
END $$;

DO $$
DECLARE v_prog UUID;
BEGIN
    SELECT id INTO v_prog FROM programm WHERE titel = 'BEG Einzelmaßnahmen – Gebäudehülle';
    IF v_prog IS NOT NULL THEN
        DELETE FROM antragsschritt WHERE programm_id = v_prog;
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Energieeffizienz-Experten beauftragen', 'dena-gelistete Fachperson einbinden — bei Hülle/Dämmung verpflichtend. Sie erstellt die Technische Projektbeschreibung (TPB) und prüft die U-Werte.', '1–2 Tage', 'vor Antrag', TRUE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'iSFP prüfen (5 % Bonus)', 'Liegt ein individueller Sanierungsfahrplan vor? Falls ja und die Maßnahme daraus stammt: +5 % Förderbonus (15 % → 20 %). Falls nicht, ggf. vorher EBW-Beratung nutzen.', '30 Min.', 'vor Antrag', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'Antrag VOR Vorhabenbeginn stellen', 'Antrag mit TPB beim BAFA stellen, bevor beauftragt wird. Maßnahmenbeginn vor Antrag = Totalausfall.', '1 Std.', 'ZWINGEND vorab', TRUE);
        INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Kritischer Schritt missachtet: Antrag VOR Vorhabenbeginn stellen', 3);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 4, 'Umsetzung & Fachunternehmererklärung', 'Maßnahme durch Fachbetrieb umsetzen; Einhaltung der TMA per Fachunternehmererklärung bestätigen lassen.', 'projektabh.', 'Bewilligungszeitraum', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 5, 'Verwendungsnachweis einreichen', 'Rechnungen, Fachunternehmererklärung und ggf. Bestätigung des Experten hochladen → Auszahlung.', '2 Std.', 'nach Abschluss', TRUE);
    END IF;
END $$;

DO $$
DECLARE v_prog UUID;
BEGIN
    SELECT id INTO v_prog FROM programm WHERE titel = 'Energieberatung Wohngebäude (EBW)';
    IF v_prog IS NOT NULL THEN
        DELETE FROM antragsschritt WHERE programm_id = v_prog;
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Energieeffizienz-Experten auswählen', 'dena-gelisteten Energieberater für Wohngebäude auswählen (Pflicht für Förderung).', '1 Tag', 'vor Antrag', TRUE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'Antrag durch Berater (Vollmacht)', 'In der Regel stellt der Berater den Antrag im BAFA-Portal mit Ihrer Vollmacht — vor Beginn der Beratungsleistung.', '1 Std.', 'vor Beauftragung', TRUE);
        INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Kritischer Schritt missachtet: Antrag durch Berater (Vollmacht)', 3);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'Beratung durchführen & iSFP erhalten', 'Beratung durchführen lassen; Ergebnis ist der individuelle Sanierungsfahrplan (iSFP) — Grundlage für spätere 5 %-Boni.', '1–3 Wochen', '—', TRUE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 4, 'Nachweis & Auszahlung', 'Beratungsbericht/iSFP und Rechnung einreichen; 50 % der Kosten werden erstattet (max. 650 € EFH/ZFH, 1.300 € MFH).', '1 Std.', 'nach Beratung', FALSE);
    END IF;
END $$;

DO $$
DECLARE v_prog UUID;
BEGIN
    SELECT id INTO v_prog FROM programm WHERE titel = 'ZIM – Einzelprojekt (FuE)';
    IF v_prog IS NOT NULL THEN
        DELETE FROM antragsschritt WHERE programm_id = v_prog;
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Innovationsgehalt & FuE-Risiko schärfen', 'Sicherstellen, dass das Projekt echte technische Neuheit über den Stand der Technik hinaus und ein erkennbares Entwicklungsrisiko aufweist. Reine Anwendung bekannter Technik ist nicht förderfähig.', '2–3 Tage', 'vor Antrag', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'Mein Unternehmenskonto einrichten', 'Für die volldigitale Antragstellung über die Förderzentrale Deutschland (zim.de / FZD) das »Mein Unternehmenskonto« anlegen — Antrag erfolgt ohne Unterschrift.', '1 Std.', 'vor Antrag', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'Projektbeschreibung & PSP erstellen', 'Projektstrukturplan (PSP), Arbeitspakete, Meilensteine und Personalkostenkalkulation ausarbeiten (Anhänge 1–4). Kern des Antrags — Dokument-Assistent nutzen.', '1–2 Wochen', 'vor Antrag', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 4, 'Optional: Projektträger-Beratung', 'Bei Unsicherheit über Förderwürdigkeit kostenlose Beratung des Projektträgers (VDI/VDE-IT für Einzelprojekte) nutzen oder formlose Skizze einreichen. Keine Pflicht.', '1–2 Tage', 'vor Antrag', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 5, 'Antrag über FZD einreichen — vor Vorhabenbeginn', 'Antrag volldigital über die Förderzentrale Deutschland einreichen. Das Projekt darf erst nach bestätigtem Antragseingang beginnen.', '2 Tage', 'ZWINGEND vorab', FALSE);
        INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Kritischer Schritt missachtet: Antrag über FZD einreichen — vor Vorhabenbeginn', 3);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 6, 'Eingangsbestätigung sichern', 'Schriftliche Eingangsbestätigung des Projektträgers ist der rechtlich maßgebliche Zeitstempel. Ab diesem Moment ist Projektstart auf eigenes Risiko zulässig.', '—', 'nach Einreichung', FALSE);
        INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Kritischer Schritt missachtet: Eingangsbestätigung sichern', 3);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 7, 'Begutachtung & Rückfragen', 'Fachliche Prüfung durch den Projektträger (~3 Monate). Rückfragen zu Innovationsabgrenzung, Risiko, Kosten, Verwertung zügig beantworten.', 'reaktiv', '~3 Mon.', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 8, 'Mittelabruf & Nachweise', 'Nach Bewilligung Mittel abrufen; Stundennachweise (Vordruck) und Zwischennachweise über die Laufzeit führen.', 'laufend', 'quartalsweise', FALSE);
    END IF;
END $$;

DO $$
DECLARE v_prog UUID;
BEGIN
    SELECT id INTO v_prog FROM programm WHERE titel = 'ZIM – Kooperationsprojekt';
    IF v_prog IS NOT NULL THEN
        DELETE FROM antragsschritt WHERE programm_id = v_prog;
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Partner & Kooperationsvertrag vorbereiten', 'Mind. zwei KMU oder KMU + Forschungseinrichtung. Kooperationsvertrag vorbereiten — aber NICHT vorbehaltlos unterzeichnen (gilt sonst als Vorhabenbeginn).', '1–2 Wochen', 'vor Antrag', FALSE);
        INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Kritischer Schritt missachtet: Partner & Kooperationsvertrag vorbereiten', 3);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'Gemeinsame Projektbeschreibung', 'Abgestimmte Projektbeschreibung, Arbeitsteilung und Kalkulation je Partner erstellen.', '2 Wochen', 'vor Antrag', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'Alle Partner stellen Antrag (FZD)', 'Jeder antragsberechtigte Partner stellt einen eigenen Antrag über die FZD — möglichst gemeinsam, mindestens innerhalb von 2 Wochen.', '2–3 Tage', 'ZWINGEND vorab', FALSE);
        INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Kritischer Schritt missachtet: Alle Partner stellen Antrag (FZD)', 3);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 4, 'Eingangsbestätigung abwarten', 'Projektstart erst nach bestätigtem Antragseingang (auf eigenes Risiko). Forschungseinrichtung wird zu 100 % gefördert.', '—', 'nach Einreichung', FALSE);
        INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Kritischer Schritt missachtet: Eingangsbestätigung abwarten', 3);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 5, 'Begutachtung (AiF Projekt GmbH)', 'Kooperationsprojekte werden von der AiF Projekt GmbH begutachtet (~3 Monate).', 'reaktiv', '~3 Mon.', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 6, 'Durchführung & Nachweise', 'Projekt durchführen, Stundennachweise und Zwischennachweise je Partner führen.', 'laufend', 'quartalsweise', FALSE);
    END IF;
END $$;

DO $$
DECLARE v_prog UUID;
BEGIN
    SELECT id INTO v_prog FROM programm WHERE titel = 'Gründungszuschuss';
    IF v_prog IS NOT NULL THEN
        DELETE FROM antragsschritt WHERE programm_id = v_prog;
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Restanspruch ALG I prüfen (≥ 150 Tage)', 'Kritisches K.-o.-Kriterium: Zum Zeitpunkt der Gründung müssen noch ≥ 150 Tage ALG-I-Anspruch bestehen. Startdatum schriftlich festlegen und Tage zurückrechnen. Bürgergeld-Bezieher sind ausgeschlossen.', '30 Min.', 'vor allem anderen', FALSE);
        INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Kritischer Schritt missachtet: Restanspruch ALG I prüfen (≥ 150 Tage)', 3);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'Businessplan erstellen', 'Tragfähiges Konzept mit Text- und Zahlenteil (10–20 Seiten). Konservative, mit Marktdaten begründete Prognosen. Dokument-Assistent nutzen.', '1–2 Wochen', 'vor Antrag', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'Fachkundige Stellungnahme einholen', 'Tragfähigkeitsbescheinigung von IHK/HWK (oft kostenlos) oder Steuerberater/Gründungsberatung (200–800 €). Ohne sie wird der Antrag nicht bearbeitet.', '3–5 Tage', 'vor Antrag', TRUE);
        INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Kritischer Schritt missachtet: Fachkundige Stellungnahme einholen', 3);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 4, 'Antrag bei der Agentur abholen — VOR Gründung', 'Termin beim Vermittler machen und Antragsformular abholen, BEVOR die Tätigkeit aufgenommen/das Gewerbe angemeldet wird. Rückwirkend nicht möglich. Rechtsanspruch auf Aushändigung des Antrags.', '1 Std.', 'ZWINGEND vor Gründung', FALSE);
        INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Kritischer Schritt missachtet: Antrag bei der Agentur abholen — VOR Gründung', 3);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 5, 'Antrag mit allen Unterlagen einreichen', 'Antrag + Businessplan + Lebenslauf + fachkundige Stellungnahme + Nachweis der Selbstständigkeits-Anmeldung einreichen. Auf Vollständigkeit achten.', '1 Std.', 'vor Gründung', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 6, 'Bewilligung abwarten (Ermessen)', '4–8 Wochen Bearbeitung. Achtung: Ermessensleistung — kein Rechtsanspruch, auch bei Erfüllung aller Kriterien. Überzeugung des Vermittlers zählt.', 'reaktiv', '4–8 Wochen', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 7, 'Phase 2 beantragen (Monat 6)', 'Nach 6 Monaten (Phase 1: ALG-I-Satz + 300 €) Weiterförderung von 300 €/Monat für 9 Monate mit Nachweis intensiver Geschäftstätigkeit beantragen.', '1 Std.', 'nach Monat 6', FALSE);
    END IF;
END $$;

DO $$
DECLARE v_prog UUID;
BEGIN
    SELECT id INTO v_prog FROM programm WHERE titel = 'EEW – Modul-Antrag (Industrie/Effizienz)';
    IF v_prog IS NOT NULL THEN
        DELETE FROM antragsschritt WHERE programm_id = v_prog;
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Modul & Berechnungsbasis bestimmen', 'Passendes Modul (1–6) wählen. Klären, ob Investitionsgesamtkosten oder Mehrkosten (ggü. Standardlösung) die Berechnungsbasis bilden — je Modul unterschiedlich.', 'halber Tag', 'vor Antrag', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'Einsparung/CO₂-Wirkung ermitteln', 'Erwartete Energie-/CO₂-Einsparung berechnen (bei kleinen Unternehmen: 1.200 €/t CO₂/Jahr). Ggf. Energieberater/Netzwerkmoderator einbinden.', '1 Woche', 'vor Antrag', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'Antrag im FZD-Portal — vor Bestellung', 'Zuschuss-Antrag über die Förderzentrale Deutschland stellen. Bestellung/Auftrag erst NACH Antragstellung bzw. Zuwendungsbescheid — vorzeitiger Beginn = keine Förderung.', '2–3 Std.', 'ZWINGEND vorab', FALSE);
        INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Kritischer Schritt missachtet: Antrag im FZD-Portal — vor Bestellung', 3);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 4, 'Modul 5 gesondert (VDI/VDE-IT)', 'Nur für Transformationskonzepte (Modul 5): Antrag läuft NICHT über BAFA, sondern über VDI/VDE Innovation + Technik GmbH.', '—', 'vor Antrag', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 5, 'Umsetzung & 3-Jahres-Bindung', 'Geförderte Technik mind. 3 Jahre zweckentsprechend betreiben. Vorzeitiger Verkauf → anteilige Rückforderung.', 'projektabh.', 'Zweckbindung 3 J.', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 6, 'Verwendungsnachweis', 'Nachweis über Investition, Inbetriebnahme und erreichte Einsparung einreichen → Auszahlung.', 'halber Tag', 'nach Abschluss', FALSE);
    END IF;
END $$;

DO $$
DECLARE v_prog UUID;
BEGIN
    SELECT id INTO v_prog FROM programm WHERE titel = 'KfW-Kredit (z. B. 261/270) — über Hausbank';
    IF v_prog IS NOT NULL THEN
        DELETE FROM antragsschritt WHERE programm_id = v_prog;
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 1, 'Vorhaben & Kreditbedarf klären', 'Investitionskosten, Eigenanteil und benötigten Kreditbetrag bestimmen. Bei 261: Effizienzhaus-Stufe mit Energieeffizienz-Experten festlegen.', 'halber Tag', 'vor Antrag', TRUE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 2, 'Hausbankgespräch vorbereiten', 'KfW-Kredite werden NICHT direkt bei der KfW beantragt, sondern über die Hausbank. Unterlagen (Investitionsplan, Angebote, Bonität) vorbereiten.', '1–2 Tage', 'vor Antrag', FALSE);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 3, 'Antrag über Hausbank — vor Vorhabenbeginn', 'Die Hausbank stellt den Antrag bei der KfW, bevor das Vorhaben beginnt. Vorzeitiger Beginn schließt Förderung aus.', 'reaktiv', 'ZWINGEND vorab', FALSE);
        INSERT INTO erfolgsfaktor (programm_id, typ, text, gewicht) VALUES (v_prog, 'ablehnungsgrund', 'Kritischer Schritt missachtet: Antrag über Hausbank — vor Vorhabenbeginn', 3);
        INSERT INTO antragsschritt (programm_id, reihenfolge, titel, beschreibung, aufwand_text, frist_bezug, erfordert_berater) VALUES (v_prog, 4, 'Zusage, Abruf & ggf. Tilgungszuschuss', 'Nach Zusage Mittel abrufen, Vorhaben umsetzen. Bei BEG-Krediten: Tilgungszuschuss nach Nachweis der erreichten Effizienzstufe.', 'projektabh.', 'Abruffrist beachten', TRUE);
    END IF;
END $$;

COMMIT;

-- Kontrolle:
--   SELECT count(*) FROM programm;
--   SELECT p.titel, count(a.*) FROM programm p LEFT JOIN antragsschritt a ON a.programm_id=p.id GROUP BY p.titel ORDER BY 2 DESC;