import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Navbar } from "@/components/Navbar";
import { FoerderpilotTabs } from "@/components/FoerderpilotTabs";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import { ArrowRight, Search, Loader2, FilterX } from "lucide-react";
import {
  fetchProgramme,
  fetchFilterOptionen,
  EBENE_LABEL,
  ART_LABEL,
  STATUS_LABEL,
  regionLabel,
  type Programm,
  type FilterOptionen,
  type Art,
  type Ebene,
} from "@/lib/foerderpilotApi";

const PAGE_SIZE = 12;
const ALL = "__all__";

/**
 * Förderschiene only deals with energetic building renovation, so the
 * Förderbank is locked to the "Energie & Gebäude" category. Bund and Länder
 * programmes stay reachable via the Ebene/Region filters.
 */
const ENERGIE_KATEGORIE = "energie_gebaeude";

export default function FoerderpilotFinder() {
  const [optionen, setOptionen] = useState<FilterOptionen | null>(null);
  const [programme, setProgramme] = useState<Programm[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [suche, setSuche] = useState("");
  const [sucheDebounced, setSucheDebounced] = useState("");
  const [ebene, setEbene] = useState<string>(ALL);
  const [art, setArt] = useState<string>(ALL);
  const [zielgruppe, setZielgruppe] = useState<string>(ALL);
  const [region, setRegion] = useState<string>(ALL);
  const [page, setPage] = useState(0);

  useEffect(() => {
    fetchFilterOptionen(ENERGIE_KATEGORIE)
      .then(setOptionen)
      .catch(() => setOptionen(null));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setSucheDebounced(suche.trim()), 350);
    return () => clearTimeout(t);
  }, [suche]);

  useEffect(() => {
    setPage(0);
  }, [sucheDebounced, ebene, art, zielgruppe, region]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProgramme({
      suche: sucheDebounced || undefined,
      ebene: ebene === ALL ? undefined : (ebene as Ebene),
      art: art === ALL ? undefined : (art as Art),
      kategorie: ENERGIE_KATEGORIE,
      zielgruppe: zielgruppe === ALL ? undefined : zielgruppe,
      region: region === ALL ? undefined : region,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })
      .then((res) => {
        if (cancelled) return;
        setProgramme(res.programme);
        setTotal(res.total);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unbekannter Fehler");
        setProgramme([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sucheDebounced, ebene, art, zielgruppe, region, page]);

  const hasFilters =
    sucheDebounced !== "" ||
    ebene !== ALL ||
    art !== ALL ||
    zielgruppe !== ALL ||
    region !== ALL;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function resetFilters() {
    setSuche("");
    setEbene(ALL);
    setArt(ALL);
    setZielgruppe(ALL);
    setRegion(ALL);
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <FoerderpilotTabs />

      <section className="bg-[var(--klard-bg)] px-4 sm:px-8 py-12 border-b border-border">
        <div className="max-w-[1180px] mx-auto">
          <span className="inline-block bg-[var(--klard-teal-l)] text-[var(--klard-teal-d)] text-[0.7rem] font-bold tracking-wider uppercase px-3 py-1 rounded-full mb-4">
            Förderbank · Energetische Sanierung
          </span>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold text-foreground mb-3">
            Förderprogramme für die energetische Gebäudesanierung
          </h1>
          <p className="text-muted-foreground max-w-2xl leading-relaxed">
            Durchsuchen und filtern Sie {total > 0 ? total : "alle"} Förderprogramme für die
            energetische Sanierung Ihres Gebäudes — von Bund und den Förderbanken der Länder,
            mit Förderquote, Höhe und Antragsweg.
          </p>
        </div>
      </section>

      <section className="px-4 sm:px-8 py-8 max-w-[1180px] mx-auto w-full">
        {/* FILTERS */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-6">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder="Suche nach Titel…"
              className="pl-9"
              data-testid="input-suche"
            />
          </div>

          <Select value={ebene} onValueChange={setEbene}>
            <SelectTrigger data-testid="select-ebene">
              <SelectValue placeholder="Ebene" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Alle Ebenen</SelectItem>
              {(["bund", "land", "eu", "kommune"] as Ebene[]).map((e) => (
                <SelectItem key={e} value={e}>
                  {EBENE_LABEL[e]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={art} onValueChange={setArt}>
            <SelectTrigger data-testid="select-art">
              <SelectValue placeholder="Förderart" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Alle Förderarten</SelectItem>
              {(
                ["zuschuss", "kredit", "buergschaft", "beteiligung", "beratung", "steuer"] as Art[]
              ).map((a) => (
                <SelectItem key={a} value={a}>
                  {ART_LABEL[a]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={zielgruppe} onValueChange={setZielgruppe}>
            <SelectTrigger data-testid="select-zielgruppe">
              <SelectValue placeholder="Zielgruppe" />
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

          <Select value={region} onValueChange={setRegion}>
            <SelectTrigger data-testid="select-region">
              <SelectValue placeholder="Region" />
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

        {hasFilters && (
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              {total} {total === 1 ? "Programm" : "Programme"} gefunden
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="text-xs"
              data-testid="button-reset-filter"
            >
              <FilterX className="h-3.5 w-3.5 mr-1" />
              Filter zurücksetzen
            </Button>
          </div>
        )}

        {/* RESULTS */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Programme werden geladen…
          </div>
        ) : error ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-destructive">
              {error}
            </CardContent>
          </Card>
        ) : programme.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center">
              <p className="text-sm text-muted-foreground mb-4">
                Keine Programme für diese Filter gefunden.
              </p>
              {hasFilters && (
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  Filter zurücksetzen
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {programme.map((p) => (
              <ProgrammCard key={p.id} programm={p} />
            ))}
          </div>
        )}

        {/* PAGINATION */}
        {!loading && !error && totalPages > 1 && (
          <Pagination className="mt-10">
            <PaginationContent>
              <PaginationItem>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  data-testid="button-prev-page"
                >
                  Zurück
                </Button>
              </PaginationItem>
              <PaginationItem>
                <span className="px-4 text-sm text-muted-foreground">
                  Seite {page + 1} von {totalPages}
                </span>
              </PaginationItem>
              <PaginationItem>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  data-testid="button-next-page"
                >
                  Weiter
                </Button>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </section>

      <Footer />
    </div>
  );
}

function ProgrammCard({ programm: p }: { programm: Programm }) {
  return (
    <Link href={`/foerderung/${p.id}`}>
      <Card
        className="flex flex-col h-full hover:border-[var(--klard-teal)] transition-colors cursor-pointer"
        data-testid={`programm-${p.id}`}
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
