import Anthropic from "@anthropic-ai/sdk";
import { db } from "@workspace/db";
import { foerderLeadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { listProgramme } from "./foerderschiene";
import type { FoerderProgramm } from "@workspace/db";
import { sendFoerderFinderAnalyse } from "./email";
import { wasEmailSent } from "./email";
import { logger } from "./logger";

import { anthropic } from "./anthropicClient";

export interface FinderInput {
  name: string;
  email: string;
  telefon?: string;
  gebaeudeTyp: string;
  baujahr: number;
  massnahmen: string[];
  eigennutzer: boolean;
  bundesland: string;
}

export interface AnalyseProgramm {
  titel: string;
  foerdergeber: string;
  foerderhoehe: string;
  antragspfad: string;
  naechsteSchritte: string;
}

export interface FinderAnalyse {
  einleitung: string;
  programme: AnalyseProgramm[];
}

const GEBAEUDE_LABEL: Record<string, string> = {
  einfamilienhaus: "Einfamilienhaus",
  zweifamilienhaus: "Zweifamilienhaus",
  mehrfamilienhaus: "Mehrfamilienhaus",
  wohnung: "Eigentumswohnung",
  nichtwohngebaeude: "Nichtwohngebäude",
};

const MASSNAHME_LABEL: Record<string, string> = {
  heizung: "Heizungstausch",
  daemmung: "Dämmung",
  fenster: "Fenstertausch",
  pv: "Photovoltaik",
  komplett: "Komplettsanierung",
  beratung: "Energieberatung",
};

/**
 * Selects the catalogue programmes relevant to the wizard answers: tag overlap
 * with the chosen Maßnahmen (Beratung programmes always qualify), tax
 * programmes only for Eigennutzer, and regional programmes only when they
 * match the Bundesland (bundesweit always qualifies).
 */
export async function matchFinderProgramme(
  input: FinderInput,
): Promise<FoerderProgramm[]> {
  const tags = new Set(input.massnahmen);
  if (input.baujahr < 1995) {
    // Old buildings almost always benefit from envelope measures too.
    tags.add("daemmung");
  }
  const all = await listProgramme();
  const bundesland = input.bundesland.trim().toLowerCase();
  return all
    .filter((p) => p.aktiv)
    .filter((p) => {
      if (p.art === "steuer" && !input.eigennutzer) return false;
      const region = p.region.trim().toLowerCase();
      if (region !== "bundesweit" && region !== bundesland) return false;
      if (p.tags.includes("beratung")) return true;
      return p.tags.some((t) => tags.has(t));
    })
    .slice(0, 8);
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI response contained no JSON object");
  }
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Generates a structured German funding analysis (intro + top 3 programmes)
 * from the wizard answers and the matched catalogue programmes. Returns
 * structured data so the email template can render it with proper escaping.
 */
export async function generateFinderAnalyse(
  input: FinderInput,
  programme: FoerderProgramm[],
): Promise<FinderAnalyse> {
  const clean = (s: string) =>
    s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/```/g, "''").slice(0, 200);

  const programmListe = programme
    .map(
      (p) =>
        `- ${p.titel} (${p.foerdergeber}, ${p.ebene}, ${p.art}): ${p.foerderquoteText}; max. ${p.maxBetragText}. ${p.kurzbeschreibung}${p.besonderheit ? ` Besonderheit: ${p.besonderheit}` : ""}`,
    )
    .join("\n");

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1600,
    messages: [
      {
        role: "user",
        content: `Du bist Fördermittel-Analyst der deutschen Plattform Förderschiene. Erstelle für die folgende Anfrage eine persönliche Förderanalyse auf Deutsch (Sie-Form, sachlich, konkret, keine Übertreibungen).

== GEBÄUDE & VORHABEN ==
Gebäudetyp: ${GEBAEUDE_LABEL[input.gebaeudeTyp] ?? clean(input.gebaeudeTyp)}
Baujahr: ${input.baujahr}
Geplante Maßnahmen: ${input.massnahmen.map((m) => MASSNAHME_LABEL[m] ?? clean(m)).join(", ")}
Nutzung: ${input.eigennutzer ? "Eigennutzer" : "Vermieter"}
Bundesland: ${clean(input.bundesland)}

== VERFÜGBARE FÖRDERPROGRAMME (Katalog) ==
${programmListe || "Keine Programme im Katalog gefunden — nenne die passendsten bundesweiten BEG/KfW/BAFA-Programme aus deinem Wissen (Stand 2025/2026, konservativ formulieren)."}

== AUFGABE ==
Wähle die 3 relevantesten Programme (bevorzugt aus dem Katalog) und antworte AUSSCHLIESSLICH mit einem JSON-Objekt in exakt diesem Format, ohne Markdown:
{
  "einleitung": "2-3 Sätze: persönliche Einordnung des Vorhabens und des Förderpotenzials",
  "programme": [
    {
      "titel": "Programmname",
      "foerdergeber": "z.B. KfW / BAFA / Landesförderbank",
      "foerderhoehe": "Konkrete Förderquote/-höhe, ggf. mit Boni",
      "antragspfad": "Wo und wie wird beantragt (inkl. Reihenfolge: Antrag VOR Vorhabenbeginn, Energieberater nötig?)",
      "naechsteSchritte": "1-2 konkrete nächste Schritte"
    }
  ]
}`,
      },
    ],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const raw = extractJson(text) as Partial<FinderAnalyse>;
  const programmeOut: unknown[] = Array.isArray(raw.programme)
    ? (raw.programme as unknown[])
    : [];
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const analyse: FinderAnalyse = {
    einleitung: str(raw.einleitung),
    programme: programmeOut.slice(0, 3).map((p) => ({
      titel: str((p as Record<string, unknown>).titel),
      foerdergeber: str((p as Record<string, unknown>).foerdergeber),
      foerderhoehe: str((p as Record<string, unknown>).foerderhoehe),
      antragspfad: str((p as Record<string, unknown>).antragspfad),
      naechsteSchritte: str((p as Record<string, unknown>).naechsteSchritte),
    })),
  };
  if (analyse.programme.length === 0) {
    throw new Error("AI analysis returned no programmes");
  }
  return analyse;
}

function analyseToText(analyse: FinderAnalyse): string {
  return [
    analyse.einleitung,
    ...analyse.programme.map(
      (p, i) =>
        `${i + 1}. ${p.titel} (${p.foerdergeber})\nFörderhöhe: ${p.foerderhoehe}\nAntragsweg: ${p.antragspfad}\nNächste Schritte: ${p.naechsteSchritte}`,
    ),
  ].join("\n\n");
}

/**
 * Background pipeline for one stored lead: match programmes → generate the AI
 * analysis → persist it → send the email → record delivery status on the lead.
 * Never throws — failures are logged and recorded as emailStatus "failed" so
 * the admin dashboard surfaces them.
 */
/**
 * Startup recovery: the analysis+email pipeline runs as an in-process
 * background promise, so a restart/deploy between lead insert and completion
 * would strand the lead in "pending" forever. On boot, re-process recent
 * pending leads (bounded) and mark stale ones failed so they surface in the
 * admin dashboard instead of silently sitting in limbo.
 */
export async function recoverPendingFoerderLeads(): Promise<void> {
  try {
    const pending = await db
      .select()
      .from(foerderLeadsTable)
      .where(eq(foerderLeadsTable.emailStatus, "pending"))
      .limit(20);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const lead of pending) {
      if (lead.createdAt.getTime() < cutoff) {
        await db
          .update(foerderLeadsTable)
          .set({ emailStatus: "failed" })
          .where(eq(foerderLeadsTable.id, lead.id));
        continue;
      }
      const e = (lead.eingaben ?? {}) as Record<string, unknown>;
      if (
        typeof e.gebaeudeTyp !== "string" ||
        typeof e.baujahr !== "number" ||
        !Array.isArray(e.massnahmen)
      ) {
        continue;
      }
      logger.info({ leadId: lead.id }, "[foerder-finder] recovering stranded pending lead");
      // Sequential on purpose — bounded work at boot, no AI-call fan-out.
      await processFoerderFinderLead(lead.id, {
        name: lead.name,
        email: lead.email,
        telefon: lead.telefon ?? undefined,
        gebaeudeTyp: e.gebaeudeTyp,
        baujahr: e.baujahr,
        massnahmen: e.massnahmen.map(String),
        eigennutzer: e.eigennutzer === true,
        bundesland: typeof e.bundesland === "string" ? e.bundesland : "bundesweit",
      });
    }
  } catch (err) {
    logger.error({ err }, "[foerder-finder] pending-lead recovery failed");
  }
}

export async function processFoerderFinderLead(
  leadId: number,
  input: FinderInput,
): Promise<void> {
  try {
    const programme = await matchFinderProgramme(input);
    const analyse = await generateFinderAnalyse(input, programme);

    await db
      .update(foerderLeadsTable)
      .set({ programmAnalyse: analyseToText(analyse) })
      .where(eq(foerderLeadsTable.id, leadId));

    await sendFoerderFinderAnalyse({
      email: input.email,
      name: input.name,
      analyse,
      leadId,
    });
    const sent = await wasEmailSent("foerder_finder_analyse", leadId);
    await db
      .update(foerderLeadsTable)
      .set({ emailStatus: sent ? "sent" : "failed" })
      .where(eq(foerderLeadsTable.id, leadId));
  } catch (err) {
    logger.error({ err, leadId }, "[foerder-finder] lead processing failed");
    await db
      .update(foerderLeadsTable)
      .set({ emailStatus: "failed" })
      .where(eq(foerderLeadsTable.id, leadId))
      .catch(() => undefined);
  }
}
