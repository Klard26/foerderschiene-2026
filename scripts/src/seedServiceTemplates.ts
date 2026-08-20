import { db } from "@workspace/db";
import { serviceTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

type T = { name: string; description?: string; defaultDurationMinutes?: number; defaultPrice?: number };

const TEMPLATES: Record<string, T[]> = {
  "steuerberater": [
    { name: "Erstberatung", defaultDurationMinutes: 60, defaultPrice: 190 },
    { name: "Einkommensteuererklärung", defaultDurationMinutes: 90, defaultPrice: 350 },
    { name: "Jahresabschluss (Einzelunternehmen)", defaultDurationMinutes: 120, defaultPrice: 1200 },
    { name: "Buchhaltung (monatlich)", defaultDurationMinutes: 60, defaultPrice: 250 },
    { name: "Lohn- und Gehaltsabrechnung", defaultDurationMinutes: 60, defaultPrice: 180 },
    { name: "Umsatzsteuervoranmeldung", defaultDurationMinutes: 30, defaultPrice: 80 },
    { name: "Steuerliche Gestaltungsberatung", defaultDurationMinutes: 90, defaultPrice: 290 },
  ],
  "rechtsanwalt": [
    { name: "Erstberatung (RVG)", defaultDurationMinutes: 60, defaultPrice: 190 },
    { name: "Vertragsprüfung", defaultDurationMinutes: 60, defaultPrice: 250 },
    { name: "Vertragsentwurf", defaultDurationMinutes: 90, defaultPrice: 450 },
    { name: "Außergerichtliche Vertretung", defaultDurationMinutes: 60, defaultPrice: 350 },
    { name: "Schriftsatz / Anwaltsschreiben", defaultDurationMinutes: 60, defaultPrice: 280 },
    { name: "Mahnverfahren", defaultDurationMinutes: 30, defaultPrice: 150 },
  ],
  "notar": [
    { name: "Beurkundung Kaufvertrag (Immobilie)", defaultDurationMinutes: 90, defaultPrice: 0 },
    { name: "Beurkundung Erbvertrag", defaultDurationMinutes: 60, defaultPrice: 0 },
    { name: "Beurkundung Vorsorgevollmacht", defaultDurationMinutes: 45, defaultPrice: 0 },
    { name: "Gesellschaftsgründung (GmbH)", defaultDurationMinutes: 90, defaultPrice: 0 },
    { name: "Beurkundung Testament", defaultDurationMinutes: 60, defaultPrice: 0 },
  ],
  "wirtschaftspruefer": [
    { name: "Jahresabschlussprüfung", defaultDurationMinutes: 120, defaultPrice: 2500 },
    { name: "Sonderprüfung", defaultDurationMinutes: 90, defaultPrice: 1800 },
    { name: "Due-Diligence", defaultDurationMinutes: 120, defaultPrice: 3000 },
    { name: "IDW-Bescheinigung", defaultDurationMinutes: 60, defaultPrice: 800 },
  ],
  "unternehmensberater": [
    { name: "Strategieworkshop", defaultDurationMinutes: 120, defaultPrice: 950 },
    { name: "Geschäftsmodell-Analyse", defaultDurationMinutes: 90, defaultPrice: 690 },
    { name: "Business Plan Erstellung", defaultDurationMinutes: 180, defaultPrice: 1800 },
    { name: "Prozessoptimierung", defaultDurationMinutes: 120, defaultPrice: 890 },
    { name: "Change-Management Workshop", defaultDurationMinutes: 180, defaultPrice: 1500 },
    { name: "Erstgespräch (kostenlos)", defaultDurationMinutes: 30, defaultPrice: 0 },
  ],
  "strategieberater": [
    { name: "Strategie-Audit", defaultDurationMinutes: 120, defaultPrice: 1200 },
    { name: "Wachstumsstrategie", defaultDurationMinutes: 180, defaultPrice: 2400 },
    { name: "Markteintrittsanalyse", defaultDurationMinutes: 120, defaultPrice: 1500 },
    { name: "Wettbewerbsanalyse", defaultDurationMinutes: 90, defaultPrice: 950 },
  ],
  "finanzberater": [
    { name: "Finanzanalyse Privat", defaultDurationMinutes: 90, defaultPrice: 0 },
    { name: "Altersvorsorge-Beratung", defaultDurationMinutes: 60, defaultPrice: 0 },
    { name: "Vermögensaufbau", defaultDurationMinutes: 90, defaultPrice: 250 },
    { name: "Investmentstrategie", defaultDurationMinutes: 120, defaultPrice: 450 },
    { name: "Ruhestandsplanung", defaultDurationMinutes: 90, defaultPrice: 350 },
  ],
  "versicherungsmakler": [
    { name: "Versicherungs-Check", defaultDurationMinutes: 60, defaultPrice: 0 },
    { name: "Gewerbeversicherung", defaultDurationMinutes: 90, defaultPrice: 0 },
    { name: "Berufsunfähigkeit", defaultDurationMinutes: 60, defaultPrice: 0 },
    { name: "Krankenversicherung (PKV)", defaultDurationMinutes: 90, defaultPrice: 0 },
  ],
  "immobilienmakler": [
    { name: "Immobilienbewertung", defaultDurationMinutes: 90, defaultPrice: 350 },
    { name: "Verkaufsstrategie", defaultDurationMinutes: 60, defaultPrice: 0 },
    { name: "Besichtigung organisieren", defaultDurationMinutes: 60, defaultPrice: 0 },
    { name: "Mietverwaltung Beratung", defaultDurationMinutes: 60, defaultPrice: 180 },
  ],
  "existenzgruendungsberater": [
    { name: "Gründungs-Erstberatung", defaultDurationMinutes: 60, defaultPrice: 0 },
    { name: "Businessplan Coaching", defaultDurationMinutes: 120, defaultPrice: 690 },
    { name: "Rechtsformwahl", defaultDurationMinutes: 60, defaultPrice: 250 },
    { name: "Förderung & Zuschüsse", defaultDurationMinutes: 60, defaultPrice: 290 },
    { name: "Finanzplanung Gründung", defaultDurationMinutes: 90, defaultPrice: 450 },
  ],
  "foerdermittelberater": [
    { name: "Förder-Check", defaultDurationMinutes: 60, defaultPrice: 250 },
    { name: "Antragsstellung KfW", defaultDurationMinutes: 120, defaultPrice: 1200 },
    { name: "Digital Jetzt Antrag", defaultDurationMinutes: 90, defaultPrice: 950 },
    { name: "EU-Förderung", defaultDurationMinutes: 120, defaultPrice: 1500 },
  ],
  "marketingberater": [
    { name: "Marketing-Audit", defaultDurationMinutes: 120, defaultPrice: 690 },
    { name: "Markenstrategie", defaultDurationMinutes: 180, defaultPrice: 1500 },
    { name: "Kampagnen-Konzept", defaultDurationMinutes: 120, defaultPrice: 890 },
    { name: "Content-Strategie", defaultDurationMinutes: 90, defaultPrice: 590 },
  ],
  "seo-online-marketing": [
    { name: "SEO-Audit", defaultDurationMinutes: 90, defaultPrice: 490 },
    { name: "Keyword-Recherche", defaultDurationMinutes: 60, defaultPrice: 290 },
    { name: "Google Ads Setup", defaultDurationMinutes: 120, defaultPrice: 690 },
    { name: "Content-Marketing Strategie", defaultDurationMinutes: 90, defaultPrice: 590 },
    { name: "Local SEO Optimierung", defaultDurationMinutes: 90, defaultPrice: 450 },
  ],
  "pr-berater": [
    { name: "Pressemitteilung", defaultDurationMinutes: 90, defaultPrice: 490 },
    { name: "PR-Strategie", defaultDurationMinutes: 120, defaultPrice: 950 },
    { name: "Medientraining", defaultDurationMinutes: 180, defaultPrice: 1200 },
    { name: "Krisenkommunikation", defaultDurationMinutes: 90, defaultPrice: 890 },
  ],
  "vertriebsberater": [
    { name: "Vertriebs-Audit", defaultDurationMinutes: 120, defaultPrice: 690 },
    { name: "Sales-Funnel Optimierung", defaultDurationMinutes: 90, defaultPrice: 590 },
    { name: "Vertriebsschulung", defaultDurationMinutes: 240, defaultPrice: 1800 },
    { name: "B2B Akquise Coaching", defaultDurationMinutes: 90, defaultPrice: 490 },
  ],
  "it-digitalberatung": [
    { name: "IT-Strategie Workshop", defaultDurationMinutes: 180, defaultPrice: 1200 },
    { name: "Cloud-Migration Beratung", defaultDurationMinutes: 120, defaultPrice: 890 },
    { name: "Software-Auswahl", defaultDurationMinutes: 90, defaultPrice: 590 },
    { name: "Digitalisierungs-Check", defaultDurationMinutes: 60, defaultPrice: 0 },
    { name: "ERP-Beratung", defaultDurationMinutes: 120, defaultPrice: 950 },
  ],
  "datenschutzbeauftragter": [
    { name: "DSGVO-Audit", defaultDurationMinutes: 180, defaultPrice: 1200 },
    { name: "Externer DSB (monatlich)", defaultDurationMinutes: 60, defaultPrice: 250 },
    { name: "DSGVO-Schulung Mitarbeiter", defaultDurationMinutes: 120, defaultPrice: 590 },
    { name: "Datenschutzerklärung erstellen", defaultDurationMinutes: 90, defaultPrice: 390 },
  ],
  "cybersecurity-berater": [
    { name: "Security-Audit", defaultDurationMinutes: 240, defaultPrice: 1800 },
    { name: "Penetration-Test", defaultDurationMinutes: 480, defaultPrice: 3500 },
    { name: "Awareness-Training", defaultDurationMinutes: 120, defaultPrice: 890 },
    { name: "Incident-Response Beratung", defaultDurationMinutes: 90, defaultPrice: 590 },
  ],
  "personalberater": [
    { name: "Recruiting (Standard)", defaultDurationMinutes: 60, defaultPrice: 0 },
    { name: "Executive Search", defaultDurationMinutes: 120, defaultPrice: 0 },
    { name: "Active Sourcing Workshop", defaultDurationMinutes: 180, defaultPrice: 1200 },
    { name: "HR-Strategie Beratung", defaultDurationMinutes: 120, defaultPrice: 890 },
  ],
  "karriere-coach": [
    { name: "Bewerbungs-Coaching", defaultDurationMinutes: 90, defaultPrice: 190 },
    { name: "Lebenslauf-Optimierung", defaultDurationMinutes: 60, defaultPrice: 120 },
    { name: "Vorstellungsgespräch Training", defaultDurationMinutes: 90, defaultPrice: 180 },
    { name: "Karriereplanung", defaultDurationMinutes: 90, defaultPrice: 220 },
  ],
  "business-life-coach": [
    { name: "Erstgespräch (kostenlos)", defaultDurationMinutes: 30, defaultPrice: 0 },
    { name: "Einzel-Coaching", defaultDurationMinutes: 60, defaultPrice: 150 },
    { name: "Coaching 5er-Paket", defaultDurationMinutes: 60, defaultPrice: 690 },
    { name: "Führungskräfte-Coaching", defaultDurationMinutes: 90, defaultPrice: 290 },
  ],
  "mediator": [
    { name: "Mediations-Erstgespräch", defaultDurationMinutes: 60, defaultPrice: 150 },
    { name: "Mediation (pro Sitzung)", defaultDurationMinutes: 120, defaultPrice: 350 },
    { name: "Konflikt-Coaching", defaultDurationMinutes: 90, defaultPrice: 220 },
    { name: "Wirtschaftsmediation", defaultDurationMinutes: 120, defaultPrice: 590 },
  ],
  "psychologische-beratung": [
    { name: "Erstgespräch", defaultDurationMinutes: 60, defaultPrice: 90 },
    { name: "Beratung (Einzeltermin)", defaultDurationMinutes: 50, defaultPrice: 110 },
    { name: "Paarberatung", defaultDurationMinutes: 90, defaultPrice: 180 },
  ],
  "ernaehrungsberater": [
    { name: "Erstberatung Ernährung", defaultDurationMinutes: 60, defaultPrice: 80 },
    { name: "Folgeberatung", defaultDurationMinutes: 45, defaultPrice: 60 },
    { name: "Ernährungsplan individuell", defaultDurationMinutes: 90, defaultPrice: 150 },
  ],
  "gesundheitscoach": [
    { name: "Gesundheits-Check", defaultDurationMinutes: 90, defaultPrice: 120 },
    { name: "Stressmanagement", defaultDurationMinutes: 60, defaultPrice: 90 },
    { name: "BGM-Beratung Unternehmen", defaultDurationMinutes: 120, defaultPrice: 590 },
  ],
  "energieberater": [
    { name: "Vor-Ort-Energieberatung BAFA", defaultDurationMinutes: 180, defaultPrice: 980 },
    { name: "iSFP (individueller Sanierungsfahrplan)", defaultDurationMinutes: 240, defaultPrice: 1500 },
    { name: "GEG / EnEV Nachweis", defaultDurationMinutes: 120, defaultPrice: 690 },
    { name: "Heizungstausch Beratung", defaultDurationMinutes: 90, defaultPrice: 350 },
  ],
  "nachhaltigkeits-esg-berater": [
    { name: "ESG-Strategie Workshop", defaultDurationMinutes: 240, defaultPrice: 1800 },
    { name: "CO2-Bilanz erstellen", defaultDurationMinutes: 180, defaultPrice: 1500 },
    { name: "CSRD-Berichtspflicht", defaultDurationMinutes: 120, defaultPrice: 950 },
    { name: "Lieferkettengesetz Beratung", defaultDurationMinutes: 120, defaultPrice: 890 },
  ],
  "architekt-bauberater": [
    { name: "Bau-Erstberatung", defaultDurationMinutes: 90, defaultPrice: 150 },
    { name: "Entwurfsplanung", defaultDurationMinutes: 240, defaultPrice: 1800 },
    { name: "Bauantrag Vorbereitung", defaultDurationMinutes: 180, defaultPrice: 1200 },
    { name: "Baubegleitung (pro Termin)", defaultDurationMinutes: 120, defaultPrice: 350 },
  ],
  "sachverstaendiger": [
    { name: "Immobilien-Wertgutachten", defaultDurationMinutes: 240, defaultPrice: 1500 },
    { name: "Schadensgutachten", defaultDurationMinutes: 120, defaultPrice: 690 },
    { name: "Bau-Begutachtung", defaultDurationMinutes: 180, defaultPrice: 950 },
  ],
  "erbrecht-vorsorge": [
    { name: "Erbrechtliche Erstberatung", defaultDurationMinutes: 60, defaultPrice: 190 },
    { name: "Testament-Gestaltung", defaultDurationMinutes: 90, defaultPrice: 350 },
    { name: "Vorsorgevollmacht beraten", defaultDurationMinutes: 60, defaultPrice: 180 },
    { name: "Erbschaftsteuer-Optimierung", defaultDurationMinutes: 90, defaultPrice: 290 },
  ],
  "logistik-berater": [
    { name: "Supply-Chain-Audit", defaultDurationMinutes: 240, defaultPrice: 1800 },
    { name: "Lager-Optimierung", defaultDurationMinutes: 180, defaultPrice: 1200 },
    { name: "Transport-Kostenanalyse", defaultDurationMinutes: 120, defaultPrice: 690 },
  ],
  "ma-transaktionsberater": [
    { name: "M&A-Erstberatung", defaultDurationMinutes: 90, defaultPrice: 0 },
    { name: "Unternehmensbewertung", defaultDurationMinutes: 240, defaultPrice: 3500 },
    { name: "Due-Diligence Begleitung", defaultDurationMinutes: 120, defaultPrice: 1500 },
    { name: "Verkaufs-Mandat", defaultDurationMinutes: 60, defaultPrice: 0 },
  ],
  "innovations-berater": [
    { name: "Innovations-Workshop", defaultDurationMinutes: 240, defaultPrice: 1800 },
    { name: "Design-Thinking Sprint", defaultDurationMinutes: 480, defaultPrice: 3500 },
    { name: "Forschungszulage Beratung", defaultDurationMinutes: 90, defaultPrice: 590 },
  ],
  "steuer-coach-privat": [
    { name: "Steuererklärung Coaching", defaultDurationMinutes: 90, defaultPrice: 150 },
    { name: "Vermietung & Verpachtung", defaultDurationMinutes: 60, defaultPrice: 120 },
    { name: "Kapitalanlagen Steuer", defaultDurationMinutes: 60, defaultPrice: 130 },
    { name: "Selbstständige Steuer-Basics", defaultDurationMinutes: 90, defaultPrice: 190 },
  ],
};

async function main() {
  let total = 0;
  for (const [slug, items] of Object.entries(TEMPLATES)) {
    await db.delete(serviceTemplatesTable).where(eq(serviceTemplatesTable.categorySlug, slug));
    for (let i = 0; i < items.length; i++) {
      const t = items[i]!;
      await db.insert(serviceTemplatesTable).values({
        categorySlug: slug,
        name: t.name,
        description: t.description,
        defaultDurationMinutes: t.defaultDurationMinutes ?? 60,
        defaultPrice: t.defaultPrice,
        sortOrder: i,
      });
      total++;
    }
  }
  console.log(`Seeded ${total} service templates across ${Object.keys(TEMPLATES).length} categories.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
