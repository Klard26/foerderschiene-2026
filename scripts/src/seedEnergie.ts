import { db } from "@workspace/db";
import {
  tarifAngebotTable,
  verwalterTable,
  objektTable,
  zaehlpunktTable,
  vertragTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Seeds the enerwatt24 demo: a realistic tariff feed (stands in for the
 * live 300+ supplier feed) plus an optional demo portfolio.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run seed:energie
 *   DEMO_CLERK_USER_ID=user_xxx pnpm --filter @workspace/scripts run seed:energie
 */

type Tarif = {
  sparte: string;
  versorger: string;
  tarifname: string;
  arbeitspreisCtKwh: number;
  grundpreisEurJahr: number;
  laufzeitMonate?: number;
  preisgarantieMonate?: number;
  oekostrom?: boolean;
  minVerbrauchKwh?: number;
  maxVerbrauchKwh?: number;
  plzGebiet?: string;
};

const TARIFE: Tarif[] = [
  // Strom
  { sparte: "strom", versorger: "GrünStrom Genossenschaft", tarifname: "Öko Aktiv 12", arbeitspreisCtKwh: 26.9, grundpreisEurJahr: 98, laufzeitMonate: 12, preisgarantieMonate: 12, oekostrom: true },
  { sparte: "strom", versorger: "Stadtwerke Direkt", tarifname: "Klassik Strom", arbeitspreisCtKwh: 29.4, grundpreisEurJahr: 110, laufzeitMonate: 12, preisgarantieMonate: 12 },
  { sparte: "strom", versorger: "EnergieDiscount24", tarifname: "Spar Plus", arbeitspreisCtKwh: 25.8, grundpreisEurJahr: 132, laufzeitMonate: 24, preisgarantieMonate: 24 },
  { sparte: "strom", versorger: "BürgerWerke", tarifname: "Regional Grün", arbeitspreisCtKwh: 27.5, grundpreisEurJahr: 105, laufzeitMonate: 12, preisgarantieMonate: 18, oekostrom: true },
  { sparte: "strom", versorger: "Nord Energie", tarifname: "Gewerbe Flex", arbeitspreisCtKwh: 24.9, grundpreisEurJahr: 180, laufzeitMonate: 12, minVerbrauchKwh: 15000 },
  { sparte: "strom", versorger: "ReWatt", tarifname: "Mieterstrom Solar", arbeitspreisCtKwh: 23.4, grundpreisEurJahr: 96, laufzeitMonate: 24, preisgarantieMonate: 24, oekostrom: true },
  // Gas
  { sparte: "gas", versorger: "Stadtwerke Direkt", tarifname: "Erdgas Klassik", arbeitspreisCtKwh: 9.8, grundpreisEurJahr: 130, laufzeitMonate: 12, preisgarantieMonate: 12 },
  { sparte: "gas", versorger: "EnergieDiscount24", tarifname: "Gas Spar", arbeitspreisCtKwh: 8.9, grundpreisEurJahr: 156, laufzeitMonate: 24, preisgarantieMonate: 24 },
  { sparte: "gas", versorger: "GrünStrom Genossenschaft", tarifname: "Klimagas 12", arbeitspreisCtKwh: 10.2, grundpreisEurJahr: 120, laufzeitMonate: 12, preisgarantieMonate: 12, oekostrom: true },
  { sparte: "gas", versorger: "Nord Energie", tarifname: "Gewerbegas", arbeitspreisCtKwh: 8.4, grundpreisEurJahr: 240, laufzeitMonate: 12, minVerbrauchKwh: 50000 },
  // Fernwärme
  { sparte: "fernwaerme", versorger: "Stadtwerke Direkt", tarifname: "Fernwärme Standard", arbeitspreisCtKwh: 11.5, grundpreisEurJahr: 210, laufzeitMonate: 12 },
  // Heizöl (Richtpreise je Liter als ct/kWh-Äquivalent vereinfacht)
  { sparte: "heizoel", versorger: "ÖlContor", tarifname: "Heizöl Standard", arbeitspreisCtKwh: 10.9, grundpreisEurJahr: 0, laufzeitMonate: 0 },
];

async function seedTarife(): Promise<number> {
  await db.delete(tarifAngebotTable);
  for (const t of TARIFE) {
    await db.insert(tarifAngebotTable).values({
      sparte: t.sparte,
      versorger: t.versorger,
      tarifname: t.tarifname,
      arbeitspreisCtKwh: t.arbeitspreisCtKwh,
      grundpreisEurJahr: t.grundpreisEurJahr,
      laufzeitMonate: t.laufzeitMonate ?? null,
      preisgarantieMonate: t.preisgarantieMonate ?? null,
      oekostrom: t.oekostrom ?? false,
      minVerbrauchKwh: t.minVerbrauchKwh ?? null,
      maxVerbrauchKwh: t.maxVerbrauchKwh ?? null,
      plzGebiet: t.plzGebiet ?? null,
      quelle: "demo-feed",
    });
  }
  return TARIFE.length;
}

async function seedDemoPortfolio(clerkUserId: string): Promise<void> {
  // Wipe any previous demo verwalter for this user (cascades down the tree).
  await db.delete(verwalterTable).where(eq(verwalterTable.clerkUserId, clerkUserId));

  const [verwalter] = await db
    .insert(verwalterTable)
    .values({
      clerkUserId,
      firma: "Muster Hausverwaltung GmbH",
      typ: "hausverwaltung",
      erlaubnis34c: true,
      strasse: "Verwalterweg 5",
      plz: "10115",
      ort: "Berlin",
      email: "demo@muster-hv.de",
      provisionsmodell: "hybrid",
    })
    .returning();
  if (!verwalter) return;

  const objekteData = [
    { bezeichnung: "Wohnanlage Lindenhof", strasse: "Lindenstraße 12", plz: "10115", ort: "Berlin", wegBeschluss: true },
    { bezeichnung: "Geschäftshaus Kontorhaus", strasse: "Marktplatz 3", plz: "20095", ort: "Hamburg", wegBeschluss: false },
  ];

  for (const o of objekteData) {
    const [objekt] = await db
      .insert(objektTable)
      .values({ verwalterId: verwalter.id, ...o })
      .returning();
    if (!objekt) continue;

    const zps =
      o.bezeichnung === "Wohnanlage Lindenhof"
        ? [
            { sparte: "strom", art: "allgemeinstrom", jahresverbrauchKwh: 18500, versorger: "Stadtwerke Direkt", arbeitspreisCtKwh: 34.5, grundpreisEurJahr: 140 },
            { sparte: "gas", art: "heizung", jahresverbrauchKwh: 220000, versorger: "Stadtwerke Direkt", arbeitspreisCtKwh: 12.8, grundpreisEurJahr: 320 },
          ]
        : [
            { sparte: "strom", art: "gewerbe", jahresverbrauchKwh: 42000, versorger: "Nord Energie", arbeitspreisCtKwh: 31.2, grundpreisEurJahr: 220 },
          ];

    for (const z of zps) {
      const [zp] = await db
        .insert(zaehlpunktTable)
        .values({
          objektId: objekt.id,
          sparte: z.sparte,
          art: z.art,
          jahresverbrauchKwh: z.jahresverbrauchKwh,
          netzbetreiber: "Netz GmbH",
        })
        .returning();
      if (!zp) continue;
      const kuend = new Date();
      kuend.setDate(kuend.getDate() + 45);
      await db.insert(vertragTable).values({
        zaehlpunktId: zp.id,
        versorger: z.versorger,
        tarifname: "Grundversorgung",
        arbeitspreisCtKwh: z.arbeitspreisCtKwh,
        grundpreisEurJahr: z.grundpreisEurJahr,
        kuendigungsfristTage: 30,
        naechsterKuendigungstermin: kuend.toISOString().slice(0, 10),
        istAktiv: true,
        quelle: "manuell",
      });
    }
  }
  console.log(`Seeded demo portfolio for ${clerkUserId}.`);
}

async function main() {
  const count = await seedTarife();
  console.log(`Seeded ${count} tariff offers.`);
  const demoUser = process.env.DEMO_CLERK_USER_ID;
  if (demoUser) {
    await seedDemoPortfolio(demoUser);
  } else {
    console.log(
      "Tip: set DEMO_CLERK_USER_ID to also seed a demo portfolio for that user.",
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
