import { Router, type IRouter } from "express";
import { aiLimiter } from "../middlewares/rateLimit";
import { db } from "@workspace/db";
import { providersTable, servicesTable } from "@workspace/db";
import { GenerateAiOfferBody, GenerateBeraterProfiltextBody } from "@workspace/api-zod";
import { eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { getAuth } from "@clerk/express";

const router: IRouter = Router();

import { anthropic } from "../lib/anthropicClient";

router.post("/ai/offer", aiLimiter, async (req, res): Promise<void> => {
  try {
    const parsed = GenerateAiOfferBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { providerId, inquiry: rawInquiry } = parsed.data;
    const inquiry = rawInquiry
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/```/g, "''")
      .slice(0, 2000);

    const [provider] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.id, providerId))
      .limit(1);

    if (!provider) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }

    const services = await db
      .select()
      .from(servicesTable)
      .where(eq(servicesTable.providerId, providerId));

    const fmt = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const serviceList = services.length
      ? services
          .map((s) => {
            const net = s.netPrice ?? +(s.price / (1 + s.vatRate / 100)).toFixed(2);
            const vat = +(s.price - net).toFixed(2);
            return `- ${s.name} (${s.durationMinutes} Min.): netto ${fmt(net)} € + ${s.vatRate}% MwSt. ${fmt(vat)} € = brutto ${fmt(s.price)} €`;
          })
          .join("\n")
      : "Keine Leistungen hinterlegt — bitte allgemeines Pauschalangebot vorschlagen.";

    const certs = (provider.certificates ?? []).filter(Boolean);
    const modeLabel: Record<string, string> = {
      online: "ausschließlich Online-Beratung",
      "in-person": "ausschließlich Vor-Ort-Beratung",
      both: "Online- und Vor-Ort-Beratung",
    };
    const mode = modeLabel[provider.consultationMode ?? "both"] ?? "Online- und Vor-Ort-Beratung";
    const companyName = provider.companyLegalName || provider.displayName;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: `Du bist Angebots-Assistent für die deutsche Beratungs-Plattform Klard und erstellst ein verbindliches, kaufmännisch korrektes Angebot auf Deutsch (Sie-Form, sachlich, vertrauenswürdig).

== ANBIETER ==
Firma: ${companyName}
Berufsbezeichnung: ${provider.category}
Standort: ${provider.zip} ${provider.city}${provider.address ? ", " + provider.address : ""}
${provider.taxId ? `Steuernummer / USt-IdNr.: ${provider.taxId}` : ""}
${provider.email ? `E-Mail: ${provider.email}` : ""}
${provider.phone ? `Telefon: ${provider.phone}` : ""}
${provider.yearsExperience ? `Berufserfahrung: ${provider.yearsExperience} Jahre` : ""}
Beratungsform: ${mode}
${provider.responseTime ? `Reaktionszeit: ${provider.responseTime}` : ""}
${certs.length ? `Zertifikate / Mitgliedschaften: ${certs.join(", ")}` : ""}
${provider.bio ? `Profil: ${provider.bio}` : ""}

== HINTERLEGTE LEISTUNGEN UND PREISE (verbindliche Festpreise) ==
${serviceList}

== KUNDENBEDARF ==
"${inquiry}"

== AUFGABE ==
Erstelle ein strukturiertes Angebot mit folgenden Abschnitten und exakt diesen Überschriften (verwende Markdown-Fettdruck **Überschrift**):

**Bedarfsanalyse**
2–3 Sätze: was hat der Kunde geschildert, welche Leistung passt.

**Empfohlene Leistungen**
Tabelle als Bulletpoints mit Leistungsname, Dauer, Nettopreis, MwSt.-Satz, Bruttopreis. Wähle ausschließlich Leistungen aus der obigen Liste — nichts erfinden. Wenn keine passt, schlage "individuelles Pauschalangebot nach Aufwand" vor und kennzeichne es als unverbindlich.

**Gesamtpreis**
Summe Netto, Summe MwSt., Summe Brutto.

**Beratungsform & Ablauf**
Kurz: Online/Vor-Ort, voraussichtliche Reaktionszeit, nächster Termin via Klard buchbar.

**Hinweise**
- Preise sind Festpreise inkl. der ausgewiesenen MwSt.
- Angebot freibleibend, gültig 14 Tage ab Erstellung.
${provider.category.match(/Steuer|Rechtsanwalt|Notar|Wirtschaftsprüfer/i) ? "- Hinweis nach RVG/StBVV: gesetzliche Mindestgebühren bleiben unberührt." : ""}

Schließe mit einer Grußzeile mit dem Firmennamen ab. Halte das Angebot prägnant (max. 350 Wörter), keine Floskeln, keine Emojis.`,
        },
      ],
    });

    const offerText = message.content[0]?.type === "text" ? message.content[0].text : "";
    const totalNet = services.reduce((sum, s) => sum + (s.netPrice ?? +(s.price / (1 + s.vatRate / 100)).toFixed(2)), 0);
    const totalGross = services.reduce((sum, s) => sum + s.price, 0);

    res.json({
      offer: offerText,
      estimatedPrice: services[0]?.price ?? null,
      estimatedDuration: services[0] ? `${services[0].durationMinutes} Minuten` : null,
      summary: services.length
        ? {
            servicesCount: services.length,
            totalNet: +totalNet.toFixed(2),
            totalGross: +totalGross.toFixed(2),
          }
        : null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to generate AI offer");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/berater/ai-profiltext", aiLimiter, async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = GenerateBeraterProfiltextBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    const clean = (s: string) =>
      s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/```/g, "''").trim();
    const modeLabel: Record<string, string> = {
      online: "ausschließlich Online-Beratung",
      "in-person": "ausschließlich Vor-Ort-Beratung",
      both: "Online- und Vor-Ort-Beratung",
    };

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `Du schreibst einen professionellen Profiltext für einen Energieberater auf der deutschen Plattform Förderschiene. Der Text erscheint öffentlich auf dem Beraterprofil und soll Hausbesitzer überzeugen, eine Energieberatung zu buchen.

== ANGABEN DES BERATERS ==
Name / Firma: ${clean(d.displayName)}
Standort: ${clean(d.city)}
${d.yearsExperience != null ? `Berufserfahrung: ${d.yearsExperience} Jahre` : ""}
${d.specialties?.length ? `Fachgebiete: ${d.specialties.map(clean).join(", ")}` : ""}
${d.certificates?.length ? `Zertifikate / Qualifikationen: ${d.certificates.map(clean).join(", ")}` : ""}
Beratungsform: ${modeLabel[d.consultationMode ?? "both"]}
${d.notes ? `Weitere Angaben: ${clean(d.notes).slice(0, 1000)}` : ""}

== AUFGABE ==
Schreibe einen Profiltext auf Deutsch (Sie-Form): 3–5 Sätze, 60–110 Wörter, sachlich und vertrauenswürdig, in der Ich-/Wir-Perspektive. Erwähne Standort und (falls angegeben) Erfahrung und Schwerpunkte natürlich im Fließtext. Keine Überschriften, keine Aufzählungen, keine Emojis, keine erfundenen Fakten, keine Superlative wie "der beste". Gib NUR den Profiltext zurück, ohne Anführungszeichen.`,
        },
      ],
    });

    const bio = message.content[0]?.type === "text" ? message.content[0].text.trim() : "";
    if (!bio) {
      res.status(502).json({ error: "Profiltext konnte nicht generiert werden" });
      return;
    }
    res.json({ bio });
  } catch (err) {
    req.log.error({ err }, "Failed to generate Berater profile text");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
