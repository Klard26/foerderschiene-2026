import { db } from "@workspace/db";
import {
  providersTable,
  servicesTable,
  timeSlotsTable,
  categoriesTable,
} from "@workspace/db";
import { and, eq, gt } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Demo Energieberater for the Klard marketplace.
 *
 * The Förderschiene Gebäudecheck recommends Energieberater near the building's
 * PLZ and links them over to Klard for booking. Real Energieberatung providers
 * only appear once professionals onboard themselves; until then this seeds a
 * small, clearly-demo set (synthetic clerk ids + @klard-demo.de e-mails, never
 * shown to users) so the recommendation surface and booking handoff work
 * end-to-end. Spread across PLZ regions so PLZ-proximity ranking is meaningful.
 */

type DemoService = {
  name: string;
  description: string;
  price: number;
  durationMinutes: number;
};

type DemoProvider = {
  clerkUserId: string;
  displayName: string;
  email: string;
  city: string;
  zip: string;
  bio: string;
  yearsExperience: number;
  rating: number;
  reviewCount: number;
  subscriptionTier: "basic" | "premium";
  services: DemoService[];
};

const BASE_SERVICES: DemoService[] = [
  {
    name: "Vor-Ort-Energieberatung Wohngebäude (BAFA-gefördert)",
    description:
      "Ausführliche Analyse Ihres Gebäudes vor Ort inkl. Schwachstellen, Einsparpotenzialen und Handlungsempfehlungen. Bis zu 80 % BAFA-Förderung möglich.",
    price: 490,
    durationMinutes: 90,
  },
  {
    name: "Individueller Sanierungsfahrplan (iSFP)",
    description:
      "Schritt-für-Schritt-Sanierungsfahrplan mit Maßnahmenpaketen, Kostenschätzung und Fördermitteln – Voraussetzung für den iSFP-Bonus.",
    price: 1390,
    durationMinutes: 150,
  },
  {
    name: "Fördermittelberatung & Antragsbegleitung",
    description:
      "Wir ermitteln die passenden BAFA-/KfW-Programme und begleiten Ihren Antrag von der Bestätigung bis zur Auszahlung.",
    price: 290,
    durationMinutes: 60,
  },
];

const DEMO_PROVIDERS: DemoProvider[] = [
  {
    clerkUserId: "demo-enb-1",
    displayName: "EnergieEffizient Berlin – Ingenieurbüro Brandt",
    email: "demo-enb-1@klard-demo.de",
    city: "Berlin",
    zip: "10115",
    bio: "Zertifizierte Energie-Effizienz-Experten (dena) für Wohn- und Nichtwohngebäude in Berlin und Brandenburg. Spezialisiert auf iSFP und BAFA-Förderung.",
    yearsExperience: 14,
    rating: 4.9,
    reviewCount: 127,
    subscriptionTier: "premium",
    services: BASE_SERVICES,
  },
  {
    clerkUserId: "demo-enb-2",
    displayName: "Sanierungslotse München – Dr. Huber Energieberatung",
    email: "demo-enb-2@klard-demo.de",
    city: "München",
    zip: "80331",
    bio: "Unabhängige Energieberatung für den Großraum München. Schwerpunkte: Bestandssanierung, Heizungstausch und Förderstrategie für Eigentümer und Hausverwaltungen.",
    yearsExperience: 18,
    rating: 4.8,
    reviewCount: 96,
    subscriptionTier: "premium",
    services: BASE_SERVICES,
  },
  {
    clerkUserId: "demo-enb-3",
    displayName: "Norddeutsche Energieberatung Hansen",
    email: "demo-enb-3@klard-demo.de",
    city: "Hamburg",
    zip: "20095",
    bio: "Energieberatung mit Herz für Norddeutschland. Wir begleiten Sie von der Erstberatung bis zur umgesetzten Sanierung – persönlich und herstellerneutral.",
    yearsExperience: 9,
    rating: 4.7,
    reviewCount: 64,
    subscriptionTier: "basic",
    services: [BASE_SERVICES[0]!, BASE_SERVICES[2]!],
  },
  {
    clerkUserId: "demo-enb-4",
    displayName: "RheinEnergie Beratung Köln – Ingenieurbüro Vogt",
    email: "demo-enb-4@klard-demo.de",
    city: "Köln",
    zip: "50667",
    bio: "Ihr Partner für energetische Sanierung im Rheinland. Vor-Ort-Beratung, Sanierungsfahrpläne und vollständige Antragsbegleitung für BAFA und KfW.",
    yearsExperience: 11,
    rating: 4.6,
    reviewCount: 51,
    subscriptionTier: "basic",
    services: [BASE_SERVICES[0]!, BASE_SERVICES[1]!],
  },
  {
    clerkUserId: "demo-enb-5",
    displayName: "EnergieWerk Stuttgart – Klimaberatung Schäfer",
    email: "demo-enb-5@klard-demo.de",
    city: "Stuttgart",
    zip: "70173",
    bio: "Energieberatung für Baden-Württemberg mit Fokus auf klimaneutrale Gebäude, Wärmepumpen und Photovoltaik. dena-gelistete Effizienz-Experten.",
    yearsExperience: 16,
    rating: 4.8,
    reviewCount: 78,
    subscriptionTier: "premium",
    services: BASE_SERVICES,
  },
];

const ENERGIEBERATUNG_SLUG = "energieberatung";
const MIN_FUTURE_SLOTS = 6;

async function ensureProvider(
  p: DemoProvider,
  categoryName: string,
): Promise<number> {
  const inserted = await db
    .insert(providersTable)
    .values({
      clerkUserId: p.clerkUserId,
      displayName: p.displayName,
      email: p.email,
      bio: p.bio,
      category: categoryName,
      categorySlug: ENERGIEBERATUNG_SLUG,
      city: p.city,
      zip: p.zip,
      yearsExperience: p.yearsExperience,
      rating: p.rating,
      reviewCount: p.reviewCount,
      verified: true,
      subscriptionTier: p.subscriptionTier,
      consultationMode: "both",
    })
    .onConflictDoNothing({ target: providersTable.clerkUserId })
    .returning({ id: providersTable.id });

  if (inserted[0]) return inserted[0].id;

  const [existing] = await db
    .select({ id: providersTable.id })
    .from(providersTable)
    .where(eq(providersTable.clerkUserId, p.clerkUserId))
    .limit(1);
  return existing!.id;
}

async function ensureServices(
  providerId: number,
  services: DemoService[],
): Promise<void> {
  const existing = await db
    .select({ id: servicesTable.id })
    .from(servicesTable)
    .where(eq(servicesTable.providerId, providerId))
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(servicesTable).values(
    services.map((s) => ({
      providerId,
      name: s.name,
      description: s.description,
      price: s.price,
      netPrice: Math.round((s.price / 1.19) * 100) / 100,
      vatRate: 19,
      durationMinutes: s.durationMinutes,
    })),
  );
}

/**
 * Top up future, bookable slots so the demo provider stays bookable over time.
 * Idempotent: counts existing future available slots and only inserts the
 * deterministic weekday slots that are still missing (never touches booked
 * slots). Slots are 10:00 and 14:00 on the next weekdays.
 */
async function ensureSlots(providerId: number): Promise<void> {
  const now = new Date();
  const existing = await db
    .select({
      startTime: timeSlotsTable.startTime,
      isAvailable: timeSlotsTable.isAvailable,
    })
    .from(timeSlotsTable)
    .where(
      and(
        eq(timeSlotsTable.providerId, providerId),
        gt(timeSlotsTable.startTime, now),
      ),
    );

  const availableCount = existing.filter((s) => s.isAvailable).length;
  if (availableCount >= MIN_FUTURE_SLOTS) return;

  const existingTimes = new Set(existing.map((s) => s.startTime.getTime()));
  const rows: {
    providerId: number;
    startTime: Date;
    endTime: Date;
    isAvailable: boolean;
  }[] = [];
  let needed = MIN_FUTURE_SLOTS - availableCount;

  for (let dayOffset = 2; dayOffset <= 40 && needed > 0; dayOffset++) {
    const day = new Date(now);
    day.setDate(now.getDate() + dayOffset);
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue; // skip weekends
    for (const hour of [10, 14]) {
      if (needed <= 0) break;
      const start = new Date(day);
      start.setHours(hour, 0, 0, 0);
      if (start <= now || existingTimes.has(start.getTime())) continue;
      const end = new Date(start);
      end.setHours(hour + 1, 0, 0, 0);
      rows.push({ providerId, startTime: start, endTime: end, isAvailable: true });
      needed--;
    }
  }

  if (rows.length > 0) await db.insert(timeSlotsTable).values(rows);
}

let ensured = false;

/**
 * Idempotently ensure the demo Energieberater exist with services and future
 * slots. Safe to call on every boot.
 */
export async function ensureEnergieberaterDemoData(): Promise<void> {
  if (ensured) return;
  try {
    const [cat] = await db
      .select({ name: categoriesTable.name })
      .from(categoriesTable)
      .where(eq(categoriesTable.slug, ENERGIEBERATUNG_SLUG))
      .limit(1);
    const categoryName = cat?.name ?? "Energieberatung";

    for (const p of DEMO_PROVIDERS) {
      const id = await ensureProvider(p, categoryName);
      await ensureServices(id, p.services);
      await ensureSlots(id);
    }
    ensured = true;
    logger.info(
      { count: DEMO_PROVIDERS.length },
      "Energieberater demo data ensured",
    );
  } catch (err) {
    logger.error({ err }, "Failed to ensure Energieberater demo data");
  }
}
