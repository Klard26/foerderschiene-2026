import { Link } from "wouter";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight, Gauge, Landmark, Hammer, FileBadge, ClipboardCheck,
  Search, FileText, Sparkles,
} from "lucide-react";
import { useListFoerderProgramme } from "@workspace/api-client-react";

export default function Landing() {
  const { data: programme = [] } = useListFoerderProgramme();
  const teaser = programme.filter((p) => p.aktiv).slice(0, 3);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      {/* HERO */}
      <section className="bg-[var(--klard-bg)] px-4 sm:px-8 py-16 sm:py-24 border-b border-border">
        <div className="max-w-[1100px] mx-auto text-center">
          <span className="inline-block bg-[var(--klard-teal-l)] text-[var(--klard-teal-d)] text-[0.7rem] font-bold tracking-wider uppercase px-3 py-1 rounded-full mb-5">
            Fördermittel · Sanierungskosten · Energieausweis
          </span>
          <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight max-w-3xl mx-auto mb-5">
            Welche Förderung steht Ihrer Immobilie zu?
          </h1>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-8">
            Kostenloser Gebäudecheck, passende Förderprogramme samt geschätzter Höhe,
            realistische Sanierungskosten und ein rechtsgültiger Energieausweis durch einen
            zertifizierten Aussteller — alles an einem Ort.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/check">
              <Button
                size="lg"
                className="rounded-full bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white font-semibold px-7 h-12"
                data-testid="button-start-check"
              >
                Gebäudecheck starten
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/foerderprogramme-finden">
              <Button
                size="lg"
                variant="outline"
                className="rounded-full border-[1.5px] border-[var(--klard-teal)] text-[var(--klard-teal-d)] font-semibold px-7 h-12"
                data-testid="button-foerder-finder"
              >
                <Sparkles className="mr-1 h-4 w-4" />
                Förderprogramme finden
              </Button>
            </Link>
            <Link href="/energieausweis">
              <Button
                size="lg"
                variant="outline"
                className="rounded-full border-[1.5px] font-semibold px-7 h-12"
                data-testid="button-order-ausweis"
              >
                Energieausweis bestellen
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* VALUE PROPS */}
      <section className="px-4 sm:px-8 py-14 max-w-[1180px] mx-auto w-full">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <ValueCard
            icon={<Gauge className="h-5 w-5" />}
            title="Kostenloser Schnellcheck"
            text="Energieklasse, Endenergie und CO₂-Ausstoß Ihrer Immobilie in unter einer Minute — ohne Anmeldung."
          />
          <ValueCard
            icon={<Landmark className="h-5 w-5" />}
            title="Förderprogramme-Analyse"
            text="Bund, Länder und KfW/BAFA: Wir gleichen Ihr Gebäude mit aktuellen Programmen ab und schätzen die Förderhöhe."
          />
          <ValueCard
            icon={<Hammer className="h-5 w-5" />}
            title="Einzelmaßnahmen & Kosten"
            text="Konkrete Maßnahmen mit realistischen Kostenspannen und erwarteter Energieeinsparung."
          />
          <ValueCard
            icon={<FileBadge className="h-5 w-5" />}
            title="Rechtsgültiger Energieausweis"
            text="Verbrauchs- oder Bedarfsausweis, ausgestellt von einem zertifizierten Aussteller nach GEG 2024."
          />
        </div>
      </section>

      {/* SO FUNKTIONIERT'S */}
      <section className="bg-[var(--klard-bg)] px-4 sm:px-8 py-14 border-y border-border">
        <div className="max-w-[1100px] mx-auto">
          <h2 className="font-serif text-3xl font-semibold text-foreground text-center mb-10">
            So funktioniert&apos;s
          </h2>
          <div className="grid sm:grid-cols-3 gap-6">
            <StepCard
              n={1}
              icon={<ClipboardCheck className="h-5 w-5" />}
              title="Gebäudedaten erfassen"
              text="Geben Sie Adresse, Baujahr, Fläche und Heiztechnik an — der Schnellcheck zeigt sofort Ihre Energieklasse."
            />
            <StepCard
              n={2}
              icon={<Search className="h-5 w-5" />}
              title="Förderung & Kosten prüfen"
              text="Im Gebäudereport sehen Sie passende Förderprogramme, geschätzte Förderhöhe und empfohlene Maßnahmen."
            />
            <StepCard
              n={3}
              icon={<FileText className="h-5 w-5" />}
              title="Energieausweis bestellen"
              text="Beauftragen Sie den rechtsgültigen Energieausweis — erstellt von einem zertifizierten Aussteller."
            />
          </div>
        </div>
      </section>

      {/* FÖRDERPROGRAMME TEASER */}
      {teaser.length > 0 && (
        <section className="px-4 sm:px-8 py-14 max-w-[1180px] mx-auto w-full">
          <div className="flex items-end justify-between gap-4 mb-6">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                Aktuelle Förderprogramme
              </div>
              <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-foreground">
                Diese Töpfe könnten für Sie infrage kommen
              </h2>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {teaser.map((p) => (
              <Card key={p.id} className="flex flex-col" data-testid={`programm-${p.id}`}>
                <CardContent className="p-5 flex flex-col gap-3 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-sm leading-snug text-foreground">{p.titel}</h3>
                    <Badge variant="secondary" className="shrink-0 text-[0.65rem]">
                      {p.foerdergeber}
                    </Badge>
                  </div>
                  <div className="inline-flex w-fit items-center rounded-full bg-[var(--klard-teal-l)] text-[var(--klard-teal-d)] text-xs font-semibold px-2.5 py-0.5">
                    {p.foerderquoteText}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                    {p.kurzbeschreibung}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link href="/check">
              <Button
                variant="outline"
                className="rounded-full border-[1.5px] font-semibold"
                data-testid="button-teaser-check"
              >
                Eigene Förderung prüfen
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>
      )}

      {/* CTA BAND */}
      <section className="px-4 sm:px-8 py-16 bg-[var(--klard-ink)]">
        <div className="max-w-[900px] mx-auto text-center">
          <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-white mb-4">
            Starten Sie mit dem kostenlosen Gebäudecheck
          </h2>
          <p className="text-white/60 max-w-xl mx-auto mb-8 leading-relaxed">
            In wenigen Minuten zur Energieklasse, passenden Förderprogrammen und einem klaren
            Sanierungsfahrplan.
          </p>
          <Link href="/check">
            <Button
              size="lg"
              className="rounded-full bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white font-semibold px-8 h-12"
              data-testid="button-cta-band"
            >
              Jetzt kostenlos prüfen
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function ValueCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <Card className="h-full">
      <CardContent className="p-5">
        <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--klard-teal-l)] text-[var(--klard-teal-d)]">
          {icon}
        </div>
        <h3 className="font-semibold text-sm mb-1.5 text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">{text}</p>
      </CardContent>
    </Card>
  );
}

function StepCard({ n, icon, title, text }: { n: number; icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-border bg-white p-6">
      <div className="flex items-center gap-3 mb-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--klard-teal)] text-white font-serif text-lg font-semibold">
          {n}
        </span>
        <span className="text-[var(--klard-teal-d)]">{icon}</span>
      </div>
      <h3 className="font-semibold text-sm mb-1.5 text-foreground">{title}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{text}</p>
    </div>
  );
}
