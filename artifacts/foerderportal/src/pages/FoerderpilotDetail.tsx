import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ArrowLeft,
  Loader2,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Users,
} from "lucide-react";
import {
  fetchProgrammDetail,
  EBENE_LABEL,
  ART_LABEL,
  TIMING_LABEL,
  STATUS_LABEL,
  type ProgrammDetail,
} from "@/lib/foerderpilotApi";

export default function FoerderpilotDetail() {
  const params = useParams();
  const id = params.id ?? "";
  const [data, setData] = useState<ProgrammDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProgrammDetail(id)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Programm nicht gefunden");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <div className="px-4 sm:px-8 py-6 max-w-[1000px] mx-auto w-full">
        <Link href="/foerderung">
          <Button variant="ghost" size="sm" className="text-sm -ml-2" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Zurück zur Förderdatenbank
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Programm wird geladen…
        </div>
      ) : error || !data ? (
        <div className="px-4 sm:px-8 max-w-[1000px] mx-auto w-full pb-24">
          <Card>
            <CardContent className="p-10 text-center">
              <p className="text-sm text-destructive mb-4">
                {error ?? "Programm nicht gefunden."}
              </p>
              <Link href="/foerderung">
                <Button variant="outline" size="sm">
                  Zur Förderdatenbank
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      ) : (
        <main className="px-4 sm:px-8 max-w-[1000px] mx-auto w-full pb-24 space-y-8">
          {/* HEADER */}
          <header className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{EBENE_LABEL[data.ebene]}</Badge>
              <Badge variant="secondary">{ART_LABEL[data.art]}</Badge>
              <Badge variant="secondary">{TIMING_LABEL[data.timing]}</Badge>
              {data.status === "verifiziert" && (
                <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                  {STATUS_LABEL[data.status]}
                </Badge>
              )}
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl font-bold text-foreground leading-tight">
              {data.titel}
            </h1>
            <p className="text-sm text-muted-foreground">{data.foerdergeber}</p>
            {data.kurzbeschreibung && (
              <p className="text-base text-foreground leading-relaxed">{data.kurzbeschreibung}</p>
            )}
          </header>

          {/* KEY FACTS */}
          <div className="grid sm:grid-cols-2 gap-4">
            <FactCard label="Förderquote" value={data.foerderquote_text} />
            <FactCard label="Maximale Höhe" value={data.max_betrag_text} />
          </div>

          {data.besonderheit && (
            <Card className="border-[var(--klard-teal)]/30 bg-[var(--klard-teal-l)]/40">
              <CardContent className="p-5">
                <div className="text-xs uppercase tracking-wide text-[var(--klard-teal-d)] font-semibold mb-1.5">
                  Besonderheit
                </div>
                <p className="text-sm text-foreground leading-relaxed">{data.besonderheit}</p>
              </CardContent>
            </Card>
          )}

          {/* ANTRAGSPFAD */}
          {data.antragspfad.length > 0 && (
            <section className="space-y-4">
              <h2 className="font-serif text-2xl font-semibold text-foreground">So beantragen Sie</h2>
              <ol className="space-y-3">
                {data.antragspfad.map((s) => (
                  <li key={s.reihenfolge} className="flex gap-4">
                    <span className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--klard-teal)] text-white font-serif text-sm font-semibold">
                      {s.reihenfolge}
                    </span>
                    <div className="flex-1 pt-0.5">
                      <h3 className="font-semibold text-sm text-foreground">{s.titel}</h3>
                      {s.beschreibung && (
                        <p className="text-sm text-muted-foreground leading-relaxed mt-0.5">
                          {s.beschreibung}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2 mt-2">
                        {s.aufwand_text && (
                          <span className="text-[0.7rem] text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                            Aufwand: {s.aufwand_text}
                          </span>
                        )}
                        {s.erfordert_berater && (
                          <span className="text-[0.7rem] text-[var(--klard-teal-d)] bg-[var(--klard-teal-l)] rounded-full px-2 py-0.5">
                            Berater empfohlen
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* ERFOLGSFAKTOREN / ABLEHNUNGSGRÜNDE */}
          {(data.erfolgsfaktoren.length > 0 || data.ablehnungsgruende.length > 0) && (
            <div className="grid sm:grid-cols-2 gap-5">
              {data.erfolgsfaktoren.length > 0 && (
                <Card>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2 mb-3 text-green-700">
                      <CheckCircle2 className="h-4 w-4" />
                      <h3 className="font-semibold text-sm">Erfolgsfaktoren</h3>
                    </div>
                    <ul className="space-y-2">
                      {data.erfolgsfaktoren.map((f, i) => (
                        <li key={i} className="text-sm text-muted-foreground leading-relaxed flex gap-2">
                          <span className="text-green-600 mt-1">•</span>
                          <span>{f.text}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
              {data.ablehnungsgruende.length > 0 && (
                <Card>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2 mb-3 text-amber-700">
                      <AlertTriangle className="h-4 w-4" />
                      <h3 className="font-semibold text-sm">Häufige Ablehnungsgründe</h3>
                    </div>
                    <ul className="space-y-2">
                      {data.ablehnungsgruende.map((f, i) => (
                        <li key={i} className="text-sm text-muted-foreground leading-relaxed flex gap-2">
                          <span className="text-amber-600 mt-1">•</span>
                          <span>{f.text}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* PFLICHTUNTERLAGEN + BERATER */}
          {(data.pflichtunterlagen.length > 0 || data.berater.length > 0) && (
            <Accordion type="multiple" className="w-full">
              {data.pflichtunterlagen.length > 0 && (
                <AccordionItem value="unterlagen">
                  <AccordionTrigger className="text-sm font-semibold">
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Erforderliche Unterlagen ({data.pflichtunterlagen.length})
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ul className="space-y-1.5 pt-1">
                      {data.pflichtunterlagen.map((u, i) => (
                        <li key={i} className="text-sm text-muted-foreground flex items-center gap-2">
                          <span className="text-[var(--klard-teal)]">•</span>
                          {u.bezeichnung}
                          {!u.pflicht && (
                            <span className="text-[0.7rem] text-muted-foreground">(optional)</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              )}
              {data.berater.length > 0 && (
                <AccordionItem value="berater">
                  <AccordionTrigger className="text-sm font-semibold">
                    <span className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Passende Berater ({data.berater.length})
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ul className="space-y-3 pt-1">
                      {data.berater.map((b) => (
                        <li key={b.id} className="text-sm">
                          <div className="font-medium text-foreground">{b.name}</div>
                          {b.qualifikation && (
                            <div className="text-xs text-muted-foreground">{b.qualifikation}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              )}
            </Accordion>
          )}

          {/* SOURCE */}
          {data.quelle_url && (
            <div className="border-t border-border pt-6">
              <a
                href={
                  data.quelle_url.startsWith("http")
                    ? data.quelle_url
                    : `https://${data.quelle_url}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-[var(--klard-teal-d)] font-medium hover:underline"
                data-testid="link-quelle"
              >
                Offizielle Quelle
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              {data.quelle_stand && (
                <p className="text-[0.7rem] text-muted-foreground mt-1">
                  Stand: {new Date(data.quelle_stand).toLocaleDateString("de-DE")}
                </p>
              )}
            </div>
          )}
        </main>
      )}

      <Footer />
    </div>
  );
}

function FactCard({ label, value }: { label: string; value: string | null }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">
          {label}
        </div>
        <p className="text-base font-semibold text-foreground leading-snug">
          {value ?? "Auf Anfrage"}
        </p>
      </CardContent>
    </Card>
  );
}
