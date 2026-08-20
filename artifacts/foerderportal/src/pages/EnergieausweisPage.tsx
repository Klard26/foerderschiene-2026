import { useEffect, useRef, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Loader2, FileBadge, ArrowRight, ClipboardList } from "lucide-react";
import { useLocation } from "wouter";
import {
  useCreateEnergieausweisCheckout, useReconcileEnergieausweis,
  useListMyEnergieausweisOrders, type EnergieausweisOrderInputAusweisTyp,
} from "@workspace/api-client-react";
import { NWG_KATEGORIEN } from "@workspace/energie-calc";

type AusweisTyp = EnergieausweisOrderInputAusweisTyp;

const PRICES: Record<AusweisTyp, { label: string; preis: number; beschreibung: string }> = {
  verbrauch: {
    label: "Energieverbrauchsausweis",
    preis: 79,
    beschreibung: "Basiert auf dem tatsächlichen Energieverbrauch der letzten drei Jahre. Zulässig für viele Bestandsgebäude.",
  },
  bedarf: {
    label: "Energiebedarfsausweis",
    preis: 149,
    beschreibung: "Basiert auf einer technischen Analyse des Gebäudes. Erforderlich u. a. bei kleinen Wohngebäuden mit Baujahr vor 1978 ohne Modernisierung.",
  },
};

const GEBAEUDETYPEN = [
  "Einfamilienhaus", "Doppelhaushälfte", "Reihenhaus", "Mehrfamilienhaus", "Wohn- und Geschäftshaus",
];
const HEIZUNGSARTEN = [
  "Gas", "Öl", "Fernwärme", "Wärmepumpe", "Pellet / Holz", "Nachtspeicher (Strom)", "Sonstige",
];
const ANLAESSE = ["Verkauf", "Vermietung", "Modernisierung", "Sonstiges"];
const NWG_KATEGORIE_LABELS = NWG_KATEGORIEN.map((k) => k.l);
const BETRIEBSZEITEN = [
  "Bis 40 h/Woche", "40–60 h/Woche", "60–80 h/Woche", "Durchgehend (24/7)",
];
const MODERNISIERUNGEN = [
  "Fassade gedämmt", "Dach gedämmt", "Kellerdecke gedämmt", "Fenster erneuert",
  "Heizung erneuert", "Lüftungsanlage", "Photovoltaik / Solarthermie",
];

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Zahlung ausstehend",
  bezahlt: "Zahlung eingegangen",
  in_bearbeitung: "In Bearbeitung",
  ausgestellt: "Fertig",
  storniert: "Storniert",
};


export default function EnergieausweisPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const checkout = useCreateEnergieausweisCheckout();
  const reconcile = useReconcileEnergieausweis();
  const { data: orders = [] } = useListMyEnergieausweisOrders();
  const reconciledRef = useRef(false);

  const [ausweisTyp, setAusweisTyp] = useState<AusweisTyp>("verbrauch");
  const [nutzung, setNutzung] = useState<"wohngebaeude" | "nichtwohngebaeude">("wohngebaeude");
  const [nwgKategorie, setNwgKategorie] = useState(NWG_KATEGORIE_LABELS[0] ?? "");
  const [nettoflaeche, setNettoflaeche] = useState("");
  const [betriebszeiten, setBetriebszeiten] = useState(BETRIEBSZEITEN[0] ?? "");
  const [kuehlung, setKuehlung] = useState(false);
  const [strasse, setStrasse] = useState("");
  const [plz, setPlz] = useState("");
  const [ort, setOrt] = useState("");
  const [gebaeudetyp, setGebaeudetyp] = useState("Einfamilienhaus");
  const [baujahr, setBaujahr] = useState("");
  const [wohnflaeche, setWohnflaeche] = useState("");
  const [anzahlWohneinheiten, setAnzahlWohneinheiten] = useState("1");
  const [heizungsart, setHeizungsart] = useState("Gas");
  const [baujahrHeizung, setBaujahrHeizung] = useState("");
  const [anlass, setAnlass] = useState("Verkauf");
  const [verbrauch1, setVerbrauch1] = useState("");
  const [verbrauch2, setVerbrauch2] = useState("");
  const [verbrauch3, setVerbrauch3] = useState("");
  const [leerstandsmonate, setLeerstandsmonate] = useState("");
  const [modernisierungen, setModernisierungen] = useState<string[]>([]);
  const [kontaktName, setKontaktName] = useState("");
  const [kontaktEmail, setKontaktEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (reconciledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("status") === "success" && params.get("session_id")) {
      reconciledRef.current = true;
      const sessionId = params.get("session_id") as string;
      reconcile
        .mutateAsync({ data: { sessionId } })
        .then(() => {
          toast({
            title: "Zahlung bestätigt",
            description: "Ihr Auftrag wurde aufgenommen. Ein zertifizierter Aussteller übernimmt nun die Erstellung.",
          });
          const url = new URL(window.location.href);
          url.search = "";
          window.history.replaceState({}, "", url.toString());
          navigate("/energieausweis/status");
        })
        .catch(() => {
          toast({
            title: "Abgleich fehlgeschlagen",
            description: "Die Zahlung konnte nicht bestätigt werden. Bitte später erneut prüfen.",
            variant: "destructive",
          });
          const url = new URL(window.location.href);
          url.search = "";
          window.history.replaceState({}, "", url.toString());
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isNwg = nutzung === "nichtwohngebaeude";
  const emailValid = /.+@.+\..+/.test(kontaktEmail);
  const valid =
    kontaktName.trim().length > 0 && emailValid &&
    plz.length >= 5 && strasse.trim().length > 0 && ort.trim().length > 0 &&
    baujahr.length > 0 && (isNwg ? nettoflaeche.length > 0 : wohnflaeche.length > 0);

  function toggleModernisierung(m: string) {
    setModernisierungen((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m]));
  }

  async function handleSubmit() {
    if (!valid) {
      toast({
        title: "Bitte Pflichtfelder ausfüllen",
        description: "Adresse, Baujahr, Wohnfläche sowie Name und E-Mail sind erforderlich.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);

    const intake: Record<string, unknown> = {
      nutzung,
      gebaeudeadresse: { strasse, plz, ort },
      gebaeudetyp: isNwg ? nwgKategorie : gebaeudetyp,
      baujahr: Number(baujahr) || baujahr,
      heizungsart,
      baujahrHeizung: baujahrHeizung ? Number(baujahrHeizung) || baujahrHeizung : null,
      anlass,
    };
    if (isNwg) {
      intake.nwgKategorie = nwgKategorie;
      intake.nettoflaeche = Number(nettoflaeche) || nettoflaeche;
      intake.betriebszeiten = betriebszeiten;
      intake.kuehlung = kuehlung;
    } else {
      intake.wohnflaeche = Number(wohnflaeche) || wohnflaeche;
      intake.anzahlWohneinheiten = Number(anzahlWohneinheiten) || anzahlWohneinheiten;
    }
    if (ausweisTyp === "verbrauch") {
      intake.verbrauchsdaten = [verbrauch1, verbrauch2, verbrauch3];
      intake.leerstandsmonate = leerstandsmonate ? Number(leerstandsmonate) || leerstandsmonate : 0;
    } else {
      intake.modernisierungen = modernisierungen;
    }

    try {
      const res = await checkout.mutateAsync({
        data: { ausweisTyp, kontaktName, kontaktEmail, intake },
      });
      if (res?.url) {
        window.location.href = res.url;
      } else {
        throw new Error("Keine Checkout-URL erhalten.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      toast({
        title: "Bestellung fehlgeschlagen",
        description: msg.includes("503")
          ? "Zahlungen sind derzeit nicht konfiguriert."
          : msg || "Bitte später erneut versuchen.",
        variant: "destructive",
      });
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <section className="bg-[var(--klard-bg)] py-8 sm:py-12 px-4 sm:px-8 border-b border-border">
        <div className="max-w-[1280px] mx-auto">
          <span className="inline-block bg-[var(--klard-teal-l)] text-[var(--klard-teal-d)] text-[0.7rem] font-bold tracking-wider uppercase px-3 py-1 rounded-full mb-3">
            Energieausweis
          </span>
          <h1 className="font-serif text-3xl sm:text-4xl font-semibold text-foreground mb-2">
            Rechtsgültigen Energieausweis bestellen
          </h1>
          <p className="text-muted-foreground text-sm max-w-2xl leading-relaxed">
            Sie übermitteln Ihre Gebäudedaten, anschließend wird der Energieausweis von einem
            zertifizierten Aussteller nach GEG 2024 erstellt und Ihnen rechtsgültig zugestellt.
          </p>
        </div>
      </section>

      <section className="px-4 sm:px-8 py-8 max-w-[1280px] mx-auto w-full flex-1 space-y-8">
        {/* Compliance notice */}
        <div className="flex items-start gap-3 rounded-xl border border-[var(--klard-teal)] bg-[var(--klard-teal-p)] p-4">
          <ShieldCheck className="h-5 w-5 text-[var(--klard-teal-d)] shrink-0 mt-0.5" />
          <p className="text-sm text-foreground leading-relaxed">
            <strong>Wichtig:</strong> Der Energieausweis wird <strong>nicht</strong> von dieser
            Anwendung erzeugt, sondern von einem <strong>zertifizierten, ausstellungsberechtigten
            Aussteller</strong> erstellt und unterschrieben. Diese Plattform nimmt lediglich Ihren
            Auftrag und Ihre Gebäudedaten auf.
          </p>
        </div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
          {/* FORM */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Auftragsdaten</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Ausweistyp */}
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-2 block">Art des Energieausweises</Label>
                <div className="grid sm:grid-cols-2 gap-3">
                  {(Object.keys(PRICES) as AusweisTyp[]).map((t) => {
                    const sel = ausweisTyp === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setAusweisTyp(t)}
                        className={`text-left rounded-lg border p-3 transition-colors ${
                          sel ? "border-[var(--klard-teal)] bg-[var(--klard-teal-p)]" : "border-border bg-white"
                        }`}
                        data-testid={`button-typ-${t}`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-sm">{PRICES[t].label}</span>
                          <span className="font-serif font-bold text-[var(--klard-teal-d)]">{PRICES[t].preis} €</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-snug">{PRICES[t].beschreibung}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Adresse */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Straße und Hausnummer" full>
                  <Input value={strasse} onChange={(e) => setStrasse(e.target.value)} placeholder="Hauptstraße 12" data-testid="input-strasse" />
                </Field>
                <Field label="PLZ">
                  <Input value={plz} onChange={(e) => setPlz(e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" maxLength={5} placeholder="10115" data-testid="input-plz" />
                </Field>
                <Field label="Ort">
                  <Input value={ort} onChange={(e) => setOrt(e.target.value)} placeholder="Berlin" data-testid="input-ort" />
                </Field>
              </div>

              {/* Gebäudenutzung — steuert Wohn- vs. Nichtwohngebäude-Felder */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Gebäudenutzung" full>
                  <SelectField
                    value={isNwg ? "Nichtwohngebäude" : "Wohngebäude"}
                    onChange={(v) => setNutzung(v === "Nichtwohngebäude" ? "nichtwohngebaeude" : "wohngebaeude")}
                    options={["Wohngebäude", "Nichtwohngebäude"]}
                    testId="select-nutzung"
                  />
                </Field>
              </div>

              {/* Gebäudedaten */}
              <div className="grid grid-cols-2 gap-3">
                {isNwg ? (
                  <Field label="Nutzungsart">
                    <SelectField value={nwgKategorie} onChange={setNwgKategorie} options={NWG_KATEGORIE_LABELS} testId="select-nwg-kategorie" />
                  </Field>
                ) : (
                  <Field label="Gebäudetyp">
                    <SelectField value={gebaeudetyp} onChange={setGebaeudetyp} options={GEBAEUDETYPEN} testId="select-gebaeudetyp" />
                  </Field>
                )}
                <Field label="Baujahr">
                  <Input type="number" value={baujahr} onChange={(e) => setBaujahr(e.target.value)} placeholder="1985" data-testid="input-baujahr" />
                </Field>
                {isNwg ? (
                  <>
                    <Field label="Nettogrundfläche (m²)">
                      <Input type="number" value={nettoflaeche} onChange={(e) => setNettoflaeche(e.target.value)} placeholder="800" data-testid="input-nettoflaeche" />
                    </Field>
                    <Field label="Betriebszeiten">
                      <SelectField value={betriebszeiten} onChange={setBetriebszeiten} options={BETRIEBSZEITEN} testId="select-betriebszeiten" />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Wohnfläche (m²)">
                      <Input type="number" value={wohnflaeche} onChange={(e) => setWohnflaeche(e.target.value)} placeholder="140" data-testid="input-wohnflaeche" />
                    </Field>
                    <Field label="Anzahl Wohneinheiten">
                      <Input type="number" value={anzahlWohneinheiten} onChange={(e) => setAnzahlWohneinheiten(e.target.value)} placeholder="1" data-testid="input-wohneinheiten" />
                    </Field>
                  </>
                )}
                <Field label="Heizungsart">
                  <SelectField value={heizungsart} onChange={setHeizungsart} options={HEIZUNGSARTEN} testId="select-heizungsart" />
                </Field>
                <Field label="Baujahr Heizung">
                  <Input type="number" value={baujahrHeizung} onChange={(e) => setBaujahrHeizung(e.target.value)} placeholder="2005" data-testid="input-baujahr-heizung" />
                </Field>
                {isNwg && (
                  <Field label="Kühlung / Klimatisierung" full>
                    <label className="flex items-center gap-2 text-sm cursor-pointer h-9" data-testid="check-kuehlung">
                      <Checkbox checked={kuehlung} onCheckedChange={(v) => setKuehlung(v === true)} />
                      <span className="text-foreground">Gebäude ist gekühlt / klimatisiert</span>
                    </label>
                  </Field>
                )}
                <Field label="Anlass" full>
                  <SelectField value={anlass} onChange={setAnlass} options={ANLAESSE} testId="select-anlass" />
                </Field>
              </div>

              {/* Typ-spezifisch */}
              {ausweisTyp === "verbrauch" ? (
                <div className="rounded-lg border border-border p-4 space-y-3">
                  <p className="text-xs font-semibold text-foreground">Energieverbrauch der letzten 3 Jahre</p>
                  <div className="grid sm:grid-cols-3 gap-3">
                    <Field label="Jahr 1 (kWh)">
                      <Input value={verbrauch1} onChange={(e) => setVerbrauch1(e.target.value)} placeholder="z. B. 24.000" data-testid="input-verbrauch-1" />
                    </Field>
                    <Field label="Jahr 2 (kWh)">
                      <Input value={verbrauch2} onChange={(e) => setVerbrauch2(e.target.value)} placeholder="z. B. 23.500" data-testid="input-verbrauch-2" />
                    </Field>
                    <Field label="Jahr 3 (kWh)">
                      <Input value={verbrauch3} onChange={(e) => setVerbrauch3(e.target.value)} placeholder="z. B. 25.100" data-testid="input-verbrauch-3" />
                    </Field>
                  </div>
                  <Field label="Leerstand (Monate gesamt)">
                    <Input type="number" value={leerstandsmonate} onChange={(e) => setLeerstandsmonate(e.target.value)} placeholder="0" data-testid="input-leerstand" />
                  </Field>
                </div>
              ) : (
                <div className="rounded-lg border border-border p-4 space-y-3">
                  <p className="text-xs font-semibold text-foreground">Dämmzustand / durchgeführte Modernisierungen</p>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {MODERNISIERUNGEN.map((m) => (
                      <label key={m} className="flex items-center gap-2 text-sm cursor-pointer" data-testid={`check-mod-${m}`}>
                        <Checkbox
                          checked={modernisierungen.includes(m)}
                          onCheckedChange={() => toggleModernisierung(m)}
                        />
                        <span className="text-foreground">{m}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Kontakt */}
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Name (Pflicht)">
                  <Input value={kontaktName} onChange={(e) => setKontaktName(e.target.value)} placeholder="Max Mustermann" data-testid="input-kontakt-name" />
                </Field>
                <Field label="E-Mail (Pflicht)">
                  <Input type="email" value={kontaktEmail} onChange={(e) => setKontaktEmail(e.target.value)} placeholder="max@beispiel.de" data-testid="input-kontakt-email" />
                </Field>
              </div>
            </CardContent>
          </Card>

          {/* SUMMARY / SUBMIT */}
          <Card className="lg:sticky lg:top-20">
            <CardContent className="py-6 px-6 space-y-4">
              <div className="flex items-center gap-2">
                <FileBadge className="h-5 w-5 text-[var(--klard-teal-d)]" />
                <h3 className="font-serif text-lg font-semibold text-foreground">Zusammenfassung</h3>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{PRICES[ausweisTyp].label}</span>
                <span className="font-semibold">{PRICES[ausweisTyp].preis} €</span>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-3">
                <span className="text-sm font-semibold text-foreground">Gesamt</span>
                <span className="font-serif text-2xl font-bold text-[var(--klard-teal-d)]">{PRICES[ausweisTyp].preis} €</span>
              </div>
              <Button
                className="w-full bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white font-semibold h-11"
                disabled={!valid || submitting}
                onClick={handleSubmit}
                data-testid="button-order"
              >
                {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                Kostenpflichtig bestellen
              </Button>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Nach der Zahlung übernimmt ein zertifizierter Aussteller die Erstellung. Bei
                Rückfragen kontaktiert er Sie unter der angegebenen E-Mail-Adresse.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* EXISTING ORDERS — summary + link to dedicated status page */}
        {orders.length > 0 && (
          <div className="rounded-xl border border-border bg-[var(--klard-bg)] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <ClipboardList className="h-6 w-6 text-[var(--klard-teal-d)] shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Sie haben {orders.length} {orders.length === 1 ? "Auftrag" : "Aufträge"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Zuletzt:{" "}
                  {orders[0]
                    ? `${orders[0].ausweisTyp === "bedarf" ? "Energiebedarfsausweis" : "Energieverbrauchsausweis"} – ${STATUS_LABELS[orders[0].status] ?? orders[0].status}`
                    : ""}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/energieausweis/status")}
              data-testid="button-view-orders"
            >
              <ClipboardList className="h-4 w-4 mr-2" />
              Auftragsübersicht
            </Button>
          </div>
        )}
      </section>

      <Footer />
    </div>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <Label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</Label>
      {children}
    </div>
  );
}

function SelectField({
  value, onChange, options, testId,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  testId?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 text-sm" data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>{o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
