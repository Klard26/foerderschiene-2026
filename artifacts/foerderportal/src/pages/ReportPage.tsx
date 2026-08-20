import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  FileDown, ExternalLink, Loader2, ArrowRight, Building2, Landmark,
  CheckCircle2, Hammer, Mail, XCircle, AlertTriangle,
} from "lucide-react";
import {
  calcEnergie, calcWert, calcValue, calcRestnutzung, calcRisk, calcESG,
  calcSolar, type BuildingInput,
} from "@workspace/energie-calc";
import {
  useReconcileReport, useMatchFoerderschiene,
  type FoerderschieneReport, type FoerderMatchResult,
} from "@workspace/api-client-react";
import { printReport } from "@/lib/printReport";

const eurCents = (c: number) =>
  (c / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const eurWhole = (n: number) =>
  n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const dateFmt = (s: string) =>
  new Date(s).toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });

function isPaid(status: string) {
  return status === "paid" || status === "bezahlt" || status === "completed";
}

type ViewState = "loading" | "ready" | "pending" | "error" | "cancelled" | "refunded" | "none";

export default function ReportPage() {
  const { toast } = useToast();
  const reconcile = useReconcileReport();
  const [report, setReport] = useState<FoerderschieneReport | null>(null);
  const [state, setState] = useState<ViewState>("loading");
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const sessionId = params.get("session_id");

    if (status === "cancelled") {
      setState("cancelled");
      return;
    }
    if (!sessionId) {
      setState("none");
      return;
    }
    // Guest access: the Checkout sessionId in the URL is the only credential
    // needed. We re-reconcile on every load so a reload or the emailed link
    // continues to work without an account.
    setState("loading");
    reconcile
      .mutateAsync({ data: { sessionId } })
      .then((r) => {
        setReport(r);
        if (r.status === "refunded") {
          setState("refunded");
        } else if (isPaid(r.status)) {
          setState("ready");
          toast({
            title: "Zahlung bestätigt",
            description: "Ihr Gebäudereport wurde freigeschaltet.",
          });
        } else {
          setState("pending");
        }
      })
      .catch(() => {
        setState("error");
        toast({
          title: "Abgleich fehlgeschlagen",
          description: "Die Zahlung konnte nicht bestätigt werden. Bitte später erneut prüfen.",
          variant: "destructive",
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <section className="bg-[var(--klard-bg)] py-8 px-4 sm:px-8 border-b border-border">
        <div className="max-w-[1280px] mx-auto">
          <h1 className="font-serif text-3xl sm:text-4xl font-semibold text-foreground mb-1">
            Ihr Gebäudereport
          </h1>
          <p className="text-muted-foreground text-sm">
            Förderprogramme, geschätzte Förderhöhe und Sanierungskosten zu Ihrem Objekt.
          </p>
        </div>
      </section>

      <section className="px-4 sm:px-8 py-8 max-w-[1280px] mx-auto w-full flex-1 space-y-8">
        {state === "loading" && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-16 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Zahlung wird geprüft…
          </div>
        )}

        {state === "none" && (
          <StatusCard
            icon={<Building2 className="h-8 w-8 mx-auto text-muted-foreground" />}
            title="Noch kein Report vorhanden"
            text="Starten Sie den kostenlosen Gebäudecheck und schalten Sie anschließend Ihren ausführlichen Gebäudereport frei."
            ctaHref="/check"
            ctaLabel="Zum Gebäudecheck"
          />
        )}

        {state === "cancelled" && (
          <StatusCard
            icon={<XCircle className="h-8 w-8 mx-auto text-muted-foreground" />}
            title="Zahlung abgebrochen"
            text="Die Zahlung wurde abgebrochen. Sie können den Kauf jederzeit erneut starten."
            ctaHref="/check"
            ctaLabel="Zurück zum Gebäudecheck"
          />
        )}

        {state === "error" && (
          <StatusCard
            icon={<AlertTriangle className="h-8 w-8 mx-auto text-amber-500" />}
            title="Zahlung konnte nicht bestätigt werden"
            text="Falls Sie bezahlt haben, kann es einen Moment dauern. Laden Sie die Seite über den Link aus Ihrer Bestätigungs-E-Mail erneut, oder starten Sie den Kauf neu."
            ctaHref="/check"
            ctaLabel="Zum Gebäudecheck"
          />
        )}

        {state === "pending" && (
          <StatusCard
            icon={<Loader2 className="h-8 w-8 mx-auto text-muted-foreground animate-spin" />}
            title="Zahlung wird verarbeitet"
            text="Ihre Zahlung ist noch nicht abgeschlossen. Bitte laden Sie diese Seite in Kürze erneut."
            ctaHref="/check"
            ctaLabel="Zum Gebäudecheck"
          />
        )}

        {state === "refunded" && (
          <StatusCard
            icon={<XCircle className="h-8 w-8 mx-auto text-rose-600" />}
            title="Zahlung erstattet"
            text="Diese Bestellung wurde erstattet. Der Report ist nicht mehr freigeschaltet. Den Rückerstattungsbeleg haben wir Ihnen per E-Mail geschickt."
            ctaHref="/check"
            ctaLabel="Neuen Gebäudecheck starten"
          />
        )}

        {state === "ready" && report && (
          <>
            <div className="rounded-lg bg-[var(--klard-teal-l)] border border-[var(--klard-teal)] p-4 flex items-start gap-3">
              <Mail className="h-5 w-5 text-[var(--klard-teal-d)] shrink-0 mt-0.5" />
              <div className="text-sm text-[var(--klard-ink)] leading-relaxed">
                <span className="font-semibold">Report freigeschaltet.</span> Sie können ihn jetzt
                ansehen und als PDF speichern. Den Link zu dieser Seite haben wir Ihnen
                zusätzlich per E-Mail geschickt — bewahren Sie ihn auf, um den Report jederzeit
                erneut zu öffnen.
              </div>
            </div>
            <ReportDetail report={report} eurCents={eurCents} />

            <Card className="bg-[var(--klard-ink)] border-0">
              <CardContent className="py-8 px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="font-serif text-xl font-semibold text-white mb-1">
                    Energieausweis benötigt?
                  </h3>
                  <p className="text-white/60 text-sm max-w-md">
                    Bestellen Sie den rechtsgültigen Energieausweis — erstellt von einem
                    zertifizierten Aussteller.
                  </p>
                </div>
                <Link href="/energieausweis">
                  <Button className="bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white font-semibold shrink-0" data-testid="button-to-energieausweis">
                    Energieausweis bestellen
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </>
        )}
      </section>

      <Footer />
    </div>
  );
}

function StatusCard({
  icon, title, text, ctaHref, ctaLabel,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <Card className="border-dashed max-w-xl mx-auto w-full">
      <CardContent className="py-12 text-center space-y-3">
        {icon}
        <h2 className="font-serif text-xl font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">{text}</p>
        <Link href={ctaHref}>
          <Button className="bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white" data-testid="button-to-check">
            {ctaLabel}
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

function ReportDetail({
  report, eurCents,
}: {
  report: FoerderschieneReport;
  eurCents: (c: number) => string;
}) {
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);
  const match = useMatchFoerderschiene();
  const [matchResult, setMatchResult] = useState<FoerderMatchResult | null>(null);

  const d = report.profil as unknown as BuildingInput;

  useEffect(() => {
    setMatchResult(null);
    match
      .mutateAsync({
        data: {
          baujahr: Number(d.baujahr) || 0,
          wohnflaeche: Number(d.wohnflaeche) || 0,
          wohneinheiten: Number(d.wohneinheiten) || null,
          heizung: String(d.heizung || ""),
          massnahmen: [],
          selbstgenutzt: null,
        },
      })
      .then(setMatchResult)
      .catch(() => {
        toast({
          title: "Förderabgleich nicht möglich",
          description: "Die Förderprogramme konnten nicht geladen werden.",
          variant: "destructive",
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.id]);

  const e = calcEnergie(d);
  const isNwg = e.nutzung === "nichtwohngebaeude";
  const w = calcWert(d);
  const val = calcValue(d, e);
  const rest = calcRestnutzung(d, e, w);
  const risk = calcRisk(d);
  const esg = calcESG(e);
  const solar = calcSolar(d);

  function handlePrint() {
    const ok = printReport(printRef.current, `Gebäudereport ${report.adresse ?? ""}`.trim());
    if (!ok) {
      toast({
        title: "Druckdialog blockiert",
        description: "Bitte erlauben Sie Pop-ups, um den Report als PDF zu speichern.",
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-foreground">
            {report.adresse || "Gebäudereport"}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Gekauft am {dateFmt(report.createdAt)} · {eurCents(report.amountCents)}
          </p>
        </div>
        <Button
          onClick={handlePrint}
          variant="outline"
          className="border-[1.5px] font-semibold shrink-0"
          data-testid="button-print-report"
        >
          <FileDown className="h-4 w-4 mr-2" />
          Als PDF speichern
        </Button>
      </div>

      <div ref={printRef} className="print-area space-y-6">
        {/* Energiebericht */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span>{isNwg ? "Energiebilanz (Nichtwohngebäude)" : "Energiebilanz"}</span>
              {isNwg && e.nwgBenchmark ? (
                <Badge style={{ background: e.nwgBenchmark.col, color: "#fff" }} data-testid="badge-report-nwg-benchmark">
                  {e.nwgBenchmark.stufe}
                </Badge>
              ) : (
                <Badge style={{ background: e.klasse.col, color: "#fff" }}>{e.klasse.c}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Metric label="Endenergie" value={`${e.endenergie}`} unit="kWh/(m²·a)" />
              <Metric label="Primärenergie" value={`${e.primaerenergie}`} unit="kWh/(m²·a)" />
              <Metric label="CO₂-Ausstoß" value={`${e.co2Tonnen} t`} unit="pro Jahr" />
              <Metric label="Heizwärmebedarf" value={`${e.qH}`} unit="kWh/(m²·a)" />
            </div>
            <div className="border-t border-border pt-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                Heizlast (Auslegung)
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Metric label="Gebäude-Heizlast" value={e.heizlastKw.toFixed(1)} unit="kW" />
                <Metric label="Spezifisch" value={`${Math.round(e.heizlastWProM2)}`} unit="W/m²" />
                <Metric label="Auslegungstemp." value={`${e.tNorm}`} unit="°C außen" />
                <Metric label="Raumtemperatur" value={`${e.thetaInt}`} unit="°C" />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
                Überschlägige Norm-Heizlast zur ersten Dimensionierung der Wärmeerzeugung.
                Ersetzt keine raumweise Berechnung nach DIN EN 12831.
              </p>
            </div>
            {isNwg && e.nwgBenchmark && (
              <div
                className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 leading-relaxed"
                data-testid="report-nwg-caveat"
              >
                {e.nwgBenchmark.hinweis} Für Nichtwohngebäude erfolgt keine Einordnung in
                die Energieeffizienzklassen A+–H und keine wohnwirtschaftliche
                Wert-/AfA-Schätzung; maßgeblich ist der flächenbezogene Verbrauchskennwert
                bezogen auf die Nettogrundfläche.
              </div>
            )}
            {e.hinweise && e.hinweise.length > 0 && (
              <ul className="space-y-1 text-[11px] text-muted-foreground leading-relaxed">
                {e.hinweise.map((h, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-[var(--klard-teal-d)]">•</span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Wert & Restnutzung — nur für Wohngebäude (NWG ohne wohnwirtschaftliche Bewertung) */}
        {!isNwg && (
        <div className="grid sm:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Gebäudewert (Schätzung)</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Metric label="Aktueller Wert" value={eurWhole(val.total)} />
              <Metric label="Pro m²" value={eurWhole(val.proQm)} />
              <Metric label="Sachwert (NHK)" value={eurWhole(w.wAktuell)} />
              <Metric label="Altersfaktor" value={`${Math.round(w.altersfaktor * 100)} %`} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Restnutzung &amp; AfA</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Metric label="Gebäudealter" value={`${rest.alter} J.`} />
              <Metric label="Restnutzungsdauer" value={`${rest.rndWirtschaftlich} J.`} />
              <Metric label="AfA regulär" value={`${rest.afaRegulaer} %`} />
              <Metric label="AfA verkürzt" value={`${rest.afaVerkuerzt} %`} />
            </CardContent>
          </Card>
        </div>
        )}

        {/* Risk / ESG / Solar */}
        <div className="grid sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Klimarisiko</CardTitle></CardHeader>
            <CardContent>
              <Badge style={{ background: risk.color, color: "#fff" }}>{risk.level}</Badge>
              <p className="text-xs text-muted-foreground mt-2">Risikoindex: {risk.total}/100</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">ESG / Taxonomie</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex items-center justify-between"><span className="text-muted-foreground">CRREM</span><span className="font-semibold">{esg.crrem}</span></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">EU-Taxonomie</span><span className="font-semibold">{esg.euTaxonomie ? "Konform" : "Nicht konform"}</span></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Solarpotenzial</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              <Metric label="Leistung" value={`${solar.kWp} kWp`} />
              <Metric label="Ertrag" value={`${solar.kWhJahr}`} unit="kWh/a" />
              <Metric label="Ersparnis" value={eurWhole(solar.ersparnisEur)} unit="pro Jahr" />
              <Metric label="Dachfläche" value={`${solar.potenzialQm} m²`} />
            </CardContent>
          </Card>
        </div>

        {/* FÖRDERUNG */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Landmark className="h-4 w-4 text-[var(--klard-teal-d)]" />
              Passende Förderprogramme
            </CardTitle>
          </CardHeader>
          <CardContent>
            {match.isPending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Förderprogramme werden abgeglichen…
              </div>
            )}
            {matchResult && (
              <div className="space-y-4">
                <div className="rounded-lg bg-[var(--klard-teal-l)] border border-[var(--klard-teal)] p-4 flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--klard-ink)]">Geschätzte Förderung gesamt</span>
                  <span className="font-serif text-2xl font-bold text-[var(--klard-teal-d)]" data-testid="text-foerderung-gesamt">
                    {eurWhole(matchResult.geschaetzteFoerderungEur)}
                  </span>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  {matchResult.programme.map((p) => (
                    <div key={p.id} className="rounded-lg border border-border p-4 space-y-2" data-testid={`foerder-programm-${p.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-semibold text-sm leading-snug text-foreground">{p.titel}</h4>
                        <div className="flex flex-col gap-1 items-end shrink-0">
                          <Badge variant="secondary" className="text-[0.6rem]">{p.foerdergeber}</Badge>
                          <Badge variant="outline" className="text-[0.6rem]">{p.art}</Badge>
                        </div>
                      </div>
                      <div className="inline-flex w-fit items-center rounded-full bg-[var(--klard-teal-l)] text-[var(--klard-teal-d)] text-xs font-semibold px-2.5 py-0.5">
                        {p.foerderquoteText}
                      </div>
                      <p className="text-xs text-muted-foreground">Max.: {p.maxBetragText}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{p.kurzbeschreibung}</p>
                      {p.besonderheit && (
                        <p className="text-xs text-[var(--klard-teal-d)] leading-relaxed">{p.besonderheit}</p>
                      )}
                      <div className="flex items-center justify-between pt-1">
                        {typeof p.erfolgsquote === "number" && (
                          <span className="text-[0.65rem] text-muted-foreground">Erfolgsquote: {Math.round(p.erfolgsquote * 100)} %</span>
                        )}
                        {p.quelleUrl && (
                          <a
                            href={p.quelleUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[0.65rem] font-medium text-[var(--klard-teal-d)] inline-flex items-center gap-1 hover:underline"
                            data-testid={`link-quelle-${p.id}`}
                          >
                            Zur Quelle <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* MASSNAHMEN */}
        {matchResult && matchResult.massnahmen.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Hammer className="h-4 w-4 text-[var(--klard-teal-d)]" />
                Empfohlene Maßnahmen &amp; Kosten
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {matchResult.massnahmen.map((m) => (
                <div key={m.id} className="rounded-lg border border-border p-4" data-testid={`massnahme-${m.id}`}>
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-[var(--klard-teal-d)] shrink-0" />
                      <h4 className="font-semibold text-sm text-foreground">{m.label}</h4>
                    </div>
                    <Badge variant="outline" className="text-[0.6rem] shrink-0">
                      {m.art === "komplettsanierung" ? "Komplettsanierung" : "Einzelmaßnahme"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-2">{m.beschreibung}</p>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                    <span className="text-foreground">
                      <span className="text-muted-foreground">Kosten: </span>
                      {eurWhole(m.kostenMin)} – {eurWhole(m.kostenMax)}
                    </span>
                    <span className="text-foreground">
                      <span className="text-muted-foreground">Einsparung: </span>{m.einsparung}
                    </span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-lg bg-secondary/50 border border-border p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className="font-serif text-base font-semibold text-foreground leading-tight">{value}</div>
      {unit && <div className="text-[10px] text-muted-foreground">{unit}</div>}
    </div>
  );
}
