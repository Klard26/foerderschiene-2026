import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Navbar } from "@/components/Navbar";
import { FoerderpilotTabs } from "@/components/FoerderpilotTabs";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight, Loader2, Sparkles, RotateCcw } from "lucide-react";
import {
  fetchFilterOptionen,
  matchProgramme,
  regionLabel,
  EBENE_LABEL,
  ART_LABEL,
  STATUS_LABEL,
  type FilterOptionen,
  type Programm,
} from "@/lib/foerderpilotApi";

const ALL = "__all__";

/**
 * Förderschiene is about energetic building renovation, so the Schnellcheck is
 * locked to the "Energie & Gebäude" category. Bund and Länder programmes stay
 * reachable via the Region filter.
 */
const ENERGIE_KATEGORIE = "energie_gebaeude";

export default function FoerderpilotSchnellcheck() {
  const [optionen, setOptionen] = useState<FilterOptionen | null>(null);
  const [zielgruppe, setZielgruppe] = useState<string>(ALL);
  const [region, setRegion] = useState<string>(ALL);

  const [treffer, setTreffer] = useState<Programm[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFilterOptionen(ENERGIE_KATEGORIE)
      .then(setOptionen)
      .catch(() => setOptionen(null));
  }, []);

  async function runMatch() {
    setLoading(true);
    setError(null);
    try {
      const res = await matchProgramme({
        zielgruppe: zielgruppe === ALL ? undefined : zielgruppe,
        region: region === ALL ? undefined : region,
        kategorien: [ENERGIE_KATEGORIE],
        limit: 12,
      });
      setTreffer(res.treffer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
      setTreffer([]);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setZielgruppe(ALL);
    setRegion(ALL);
    setTreffer(null);
    setError(null);
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <FoerderpilotTabs />

      <section className="bg-[var(--klard-bg)] px-4 sm:px-8 py-12 border-b border-border">
        <div className="max-w-[1180px] mx-auto">
          <span className="inline-flex items-center gap-1.5 bg-[var(--klard-teal-l)] text-[var(--klard-teal-d)] text-[0.7rem] font-bold tracking-wider uppercase px-3 py-1 rounded-full mb-4">
            <Sparkles className="h-3.5 w-3.5" />
            Förder-Schnellcheck
          </span>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold text-foreground mb-3">
            Förderung für Ihre energetische Sanierung finden — ohne Anmeldung
          </h1>
          <p className="text-muted-foreground max-w-2xl leading-relaxed">
            Beantworten Sie zwei kurze Fragen zu Ihrem Sanierungsvorhaben und erhalten Sie
            sofort passende Förderprogramme für die energetische Gebäudesanierung — von Bund
            und den Förderbanken der Länder.
          </p>
        </div>
      </section>

      <section className="px-4 sm:px-8 py-8 max-w-[1180px] mx-auto w-full">
        {/* PROFILE FORM */}
        <Card className="mb-8">
          <CardContent className="p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Zielgruppe</label>
                <Select value={zielgruppe} onValueChange={setZielgruppe}>
                  <SelectTrigger data-testid="select-zielgruppe">
                    <SelectValue placeholder="Wer sind Sie?" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Alle Zielgruppen</SelectItem>
                    {optionen?.zielgruppen.map((z) => (
                      <SelectItem key={z.slug} value={z.slug}>
                        {z.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Region</label>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger data-testid="select-region">
                    <SelectValue placeholder="Wo ist Ihr Vorhaben?" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Alle Regionen</SelectItem>
                    {optionen?.regionen.map((r) => (
                      <SelectItem key={r} value={r}>
                        {regionLabel(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-6">
              <Button onClick={runMatch} disabled={loading} data-testid="button-match">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Suche läuft…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Förderprogramme anzeigen
                  </>
                )}
              </Button>
              {treffer !== null && (
                <Button variant="ghost" size="sm" onClick={reset} data-testid="button-reset">
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Neu starten
                </Button>
              )}
              <Link href="/foerderung">
                <Button variant="link" size="sm" className="text-[var(--klard-teal-d)]">
                  Alle Programme durchsuchen
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* RESULTS */}
        {error ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-destructive">{error}</CardContent>
          </Card>
        ) : treffer === null ? null : treffer.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center">
              <p className="text-sm text-muted-foreground mb-4">
                Keine passenden Programme gefunden. Versuchen Sie es mit einer breiteren Auswahl.
              </p>
              <Button variant="outline" size="sm" onClick={reset}>
                Auswahl ändern
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-4">
              {treffer.length} {treffer.length === 1 ? "passendes Programm" : "passende Programme"}{" "}
              gefunden
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {treffer.map((p) => (
                <TrefferCard key={p.id} programm={p} />
              ))}
            </div>
          </>
        )}
      </section>

      <Footer />
    </div>
  );
}

function TrefferCard({ programm: p }: { programm: Programm }) {
  return (
    <Link href={`/foerderung/${p.id}`}>
      <Card
        className="flex flex-col h-full hover:border-[var(--klard-teal)] transition-colors cursor-pointer"
        data-testid={`treffer-${p.id}`}
      >
        <CardContent className="p-5 flex flex-col gap-3 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm leading-snug text-foreground">{p.titel}</h3>
            <Badge variant="secondary" className="shrink-0 text-[0.65rem]">
              {EBENE_LABEL[p.ebene]}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex w-fit items-center rounded-full bg-[var(--klard-teal-l)] text-[var(--klard-teal-d)] text-xs font-semibold px-2.5 py-0.5">
              {ART_LABEL[p.art]}
            </span>
            {p.status === "verifiziert" && (
              <span className="inline-flex w-fit items-center rounded-full bg-green-50 text-green-700 text-xs font-semibold px-2.5 py-0.5">
                {STATUS_LABEL[p.status]}
              </span>
            )}
          </div>
          {p.foerderquote_text && (
            <p className="text-xs font-medium text-foreground">{p.foerderquote_text}</p>
          )}
          <p className="text-xs text-muted-foreground leading-relaxed flex-1 line-clamp-3">
            {p.kurzbeschreibung}
          </p>
          <div className="flex items-center justify-between pt-1">
            <span className="text-[0.7rem] text-muted-foreground">{p.foerdergeber}</span>
            <ArrowRight className="h-4 w-4 text-[var(--klard-teal)]" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
