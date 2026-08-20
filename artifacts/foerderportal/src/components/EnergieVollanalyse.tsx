import { useMemo, useState, useEffect, useRef } from "react";
import {
  BT, HT, INS, WI,
  ZUSTAND, WARMWASSER, LUEFTUNG, ENERGIEAUSWEIS_TYP, SANIERUNG_OPTIONS,
  ageBand, plzKlima, plzBundesland,
  calcEnergie, calcWert, calcValue, calcRestnutzung, calcRisk, calcESG, calcSolar, calcRenovation,
  FOERDERUNG, FOERDER_KATEGORIEN,
  type BuildingInput,
} from "@workspace/energie-calc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EnergyBar } from "@/components/EnergieSchnellcheck";
import { AddressAutocomplete, type AddressResult } from "@/components/AddressAutocomplete";
import { StandortMap } from "@/components/StandortMap";
import { AlertCircle, Save, Sun, TrendingUp, Zap, Shield, Banknote, Hammer, Printer, Lock, MapPin } from "lucide-react";
import { printReport } from "@/lib/printReport";
import { useToast } from "@/hooks/use-toast";

const DEFAULT: BuildingInput = {
  plz: "",
  baujahr: 1985,
  wohnflaeche: 140,
  geschosse: 2,
  wohneinheiten: 1,
  gebaeudetyp: "efh",
  heizung: "gas_kt",
  daemmung: "none",
  fenster: "2f_a",
  heizungBaujahr: 2005,
  zustand: "unsaniert",
  warmwasser: "zentral",
  lueftung: "fenster",
  energieausweisVorhanden: false,
  denkmalschutz: false,
  ensembleschutz: false,
  milieuschutz: false,
  pvVorhanden: false,
  sanierungen: [],
};

interface Props {
  initial?: Partial<BuildingInput>;
  onSave?: (input: BuildingInput, label: string) => Promise<void> | void;
  saving?: boolean;
  showSave?: boolean;
  /** When true, the detailed report is hidden behind a paywall until unlocked. */
  gated?: boolean;
  /** Whether the gated report has been unlocked (credit spent) in this view. */
  unlocked?: boolean;
  /** Current report-credit balance (for the paywall copy). */
  balance?: number;
  /** Opens the credit-package purchase flow. */
  onBuy?: () => void;
}

export function EnergieVollanalyse({
  initial, onSave, saving, showSave,
  gated = false, unlocked = false, balance = 0, onBuy,
}: Props) {
  const [d, setD] = useState<BuildingInput>({ ...DEFAULT, ...initial });
  const [label, setLabel] = useState("");
  const [addressText, setAddressText] = useState(() => {
    const s = [initial?.strasse, initial?.hausnummer].filter(Boolean).join(" ");
    return s;
  });

  useEffect(() => {
    if (initial) {
      setD((p) => ({ ...p, ...initial }));
      const s = [initial.strasse, initial.hausnummer].filter(Boolean).join(" ");
      if (s) setAddressText(s);
    }
  }, [initial]);

  const u = <K extends keyof BuildingInput>(k: K, v: BuildingInput[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  const applyAddress = (r: AddressResult) => {
    setD((p) => ({
      ...p,
      strasse: r.strasse ?? p.strasse,
      hausnummer: r.hausnummer ?? p.hausnummer,
      plz: r.plz ?? p.plz,
      city: r.city ?? p.city,
      lat: r.lat,
      lng: r.lng,
    }));
  };

  const valid = d.plz.length >= 5 && d.baujahr >= 1850 && d.wohnflaeche >= 20;

  const energie = useMemo(() => (valid ? calcEnergie(d) : null), [d, valid]);
  const wert = useMemo(() => (valid ? calcWert(d) : null), [d, valid]);
  const value = useMemo(() => (valid && energie ? calcValue(d, energie) : null), [d, valid, energie]);
  const restnutz = useMemo(() => (valid && energie && wert ? calcRestnutzung(d, energie, wert) : null), [d, valid, energie, wert]);
  const risk = useMemo(() => (valid ? calcRisk(d) : null), [d, valid]);
  const esg = useMemo(() => (energie ? calcESG(energie) : null), [energie]);
  const solar = useMemo(() => (valid ? calcSolar(d) : null), [d, valid]);
  const renovation = useMemo(() => (valid && energie ? calcRenovation(d, energie) : null), [d, valid, energie]);

  const klima = valid ? plzKlima(d.plz) : null;
  const land = valid ? plzBundesland(d.plz) : "";

  const reportRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const handlePrint = () => {
    const ok = printReport(reportRef.current);
    if (!ok) {
      toast({
        title: "Pop-up blockiert",
        description:
          "Bitte erlauben Sie Pop-ups für diese Seite, um den Report als PDF zu speichern.",
        variant: "destructive",
      });
    }
  };

  return (
    <div ref={reportRef} className="grid lg:grid-cols-[380px_1fr] gap-6 print-area">
      {/* INPUTS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gebäudedaten</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Adresse (mit Autovervollständigung)">
            <AddressAutocomplete
              value={addressText}
              onChange={setAddressText}
              onSelect={applyAddress}
              placeholder="z. B. Hauptstraße 12, Berlin"
              testId="input-address-autocomplete"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Straße (optional)">
              <Input
                value={d.strasse ?? ""}
                onChange={(e) => u("strasse", e.target.value)}
                placeholder="Hauptstraße"
                data-testid="input-strasse"
              />
            </Field>
            <Field label="Hausnummer (optional)">
              <Input
                value={d.hausnummer ?? ""}
                onChange={(e) => u("hausnummer", e.target.value)}
                placeholder="12"
                data-testid="input-hausnummer"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="PLZ">
              <Input
                value={d.plz}
                onChange={(e) => u("plz", e.target.value.replace(/\D/g, "").slice(0, 5))}
                placeholder="10115"
                inputMode="numeric"
                maxLength={5}
                data-testid="input-plz"
              />
            </Field>
            <Field label="Stadt (optional)">
              <Input
                value={d.city ?? ""}
                onChange={(e) => u("city", e.target.value)}
                placeholder="Berlin"
                data-testid="input-city"
              />
            </Field>
            <Field label="Baujahr" hint={ageBand(d.baujahr).d}>
              <Input
                type="number"
                value={d.baujahr}
                onChange={(e) => u("baujahr", Number(e.target.value) || 0)}
                min={1850}
                max={new Date().getFullYear()}
                data-testid="input-baujahr"
              />
            </Field>
            <Field label="Wohnfläche (m²)">
              <Input
                type="number"
                value={d.wohnflaeche}
                onChange={(e) => u("wohnflaeche", Number(e.target.value) || 0)}
                min={20}
                data-testid="input-wohnflaeche"
              />
            </Field>
            <Field label="Geschosse">
              <Input
                type="number"
                value={d.geschosse}
                onChange={(e) => u("geschosse", Math.max(1, Number(e.target.value) || 1))}
                min={1}
                max={20}
                data-testid="input-geschosse"
              />
            </Field>
            <Field label="Wohneinheiten">
              <Input
                type="number"
                value={d.wohneinheiten}
                onChange={(e) => u("wohneinheiten", Math.max(1, Number(e.target.value) || 1))}
                min={1}
                data-testid="input-wohneinheiten"
              />
            </Field>
          </div>

          <Field label="Gebäudetyp">
            <SelectField
              value={d.gebaeudetyp}
              options={BT.map((b) => ({ value: b.id, label: b.l }))}
              onChange={(v) => u("gebaeudetyp", v as BuildingInput["gebaeudetyp"])}
              testId="select-gebaeudetyp"
            />
          </Field>
          <Field label="Heizung">
            <SelectField
              value={d.heizung}
              options={HT.map((h) => ({ value: h.id, label: h.l }))}
              onChange={(v) => u("heizung", v)}
              testId="select-heizung"
            />
          </Field>
          <Field label="Heizung Baujahr">
            <Input
              type="number"
              value={d.heizungBaujahr ?? ""}
              onChange={(e) => u("heizungBaujahr", Number(e.target.value) || undefined)}
              min={1950}
              max={new Date().getFullYear()}
              data-testid="input-heizung-baujahr"
            />
          </Field>
          <Field label="Dämmung">
            <SelectField
              value={d.daemmung}
              options={INS.map((i) => ({ value: i.id, label: i.l }))}
              onChange={(v) => u("daemmung", v)}
              testId="select-daemmung"
            />
          </Field>
          <Field label="Fenster">
            <SelectField
              value={d.fenster}
              options={WI.map((w) => ({ value: w.id, label: w.l }))}
              onChange={(v) => u("fenster", v)}
              testId="select-fenster"
            />
          </Field>

          <div className="border-t pt-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
              Energetischer Zustand
            </div>
            <div className="space-y-3">
              <Field label="Gesamtzustand">
                <SelectField
                  value={d.zustand ?? "unsaniert"}
                  options={ZUSTAND.map((z) => ({ value: z.id, label: z.l }))}
                  onChange={(v) => u("zustand", v as BuildingInput["zustand"])}
                  testId="select-zustand"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Warmwasser">
                  <SelectField
                    value={d.warmwasser ?? "zentral"}
                    options={WARMWASSER.map((w) => ({ value: w.id, label: w.l }))}
                    onChange={(v) => u("warmwasser", v)}
                    testId="select-warmwasser"
                  />
                </Field>
                <Field label="Lüftung">
                  <SelectField
                    value={d.lueftung ?? "fenster"}
                    options={LUEFTUNG.map((l) => ({ value: l.id, label: l.l }))}
                    onChange={(v) => u("lueftung", v)}
                    testId="select-lueftung"
                  />
                </Field>
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Bereits durchgeführte Sanierungen
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {SANIERUNG_OPTIONS.map((s) => {
                    const active = (d.sanierungen ?? []).includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          const cur = new Set(d.sanierungen ?? []);
                          if (cur.has(s.id)) cur.delete(s.id);
                          else cur.add(s.id);
                          u("sanierungen", Array.from(cur));
                        }}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-white text-muted-foreground border-border hover:border-primary/40"
                        }`}
                        data-testid={`chip-sanierung-${s.id}`}
                      >
                        {s.l}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t pt-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
              Energieausweis
            </div>
            <CheckRow
              label="Gültiger Energieausweis vorhanden"
              checked={!!d.energieausweisVorhanden}
              onChange={(v) => u("energieausweisVorhanden", v)}
              testId="check-energieausweis"
            />
            {d.energieausweisVorhanden && (
              <div className="grid grid-cols-2 gap-3 mt-2">
                <Field label="Art">
                  <SelectField
                    value={d.energieausweisTyp ?? "bedarf"}
                    options={ENERGIEAUSWEIS_TYP.map((t) => ({ value: t.id, label: t.l }))}
                    onChange={(v) => u("energieausweisTyp", v as BuildingInput["energieausweisTyp"])}
                    testId="select-ausweis-typ"
                  />
                </Field>
                <Field label="Endenergie kWh/(m²·a)">
                  <Input
                    type="number"
                    value={d.energiekennwert ?? ""}
                    onChange={(e) => u("energiekennwert", Number(e.target.value) || undefined)}
                    placeholder="z. B. 145"
                    min={10}
                    max={600}
                    data-testid="input-energiekennwert"
                  />
                </Field>
              </div>
            )}
          </div>

          <div className="border-t pt-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
              Schutzstatus &amp; Anlagen
            </div>
            <div className="space-y-1.5">
              <CheckRow label="Denkmalschutz (Einzeldenkmal)" checked={!!d.denkmalschutz} onChange={(v) => u("denkmalschutz", v)} testId="check-denkmalschutz" />
              <CheckRow label="Ensemble-/Erhaltungssatzung" checked={!!d.ensembleschutz} onChange={(v) => u("ensembleschutz", v)} testId="check-ensembleschutz" />
              <CheckRow label="Milieuschutz (soziale Erhaltungssatzung)" checked={!!d.milieuschutz} onChange={(v) => u("milieuschutz", v)} testId="check-milieuschutz" />
              <CheckRow label="Photovoltaik/Solar bereits vorhanden" checked={!!d.pvVorhanden} onChange={(v) => u("pvVorhanden", v)} testId="check-pv" />
            </div>
          </div>

          {klima && (
            <div className="text-xs text-muted-foreground rounded-md bg-secondary/40 p-2.5 leading-relaxed">
              <div><strong>Region:</strong> {land || klima.l}</div>
              <div>{klima.hgt} Kd Heizgradtage · ⌀ {klima.t} °C</div>
            </div>
          )}

          {showSave && onSave && valid && (
            <div className="border-t pt-3 space-y-2">
              <Field label="Bezeichnung der Analyse">
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="z. B. Mein Haus, Hauptstr. 12"
                  data-testid="input-analysis-label"
                />
              </Field>
              {gated && !unlocked ? (
                balance > 0 ? (
                  <Button
                    className="w-full"
                    disabled={!label.trim() || saving}
                    onClick={() => onSave(d, label.trim())}
                    data-testid="button-unlock-report"
                  >
                    <Lock className="h-4 w-4 mr-2" />
                    {saving ? "Wird freigeschaltet…" : "Report freischalten (1 Guthaben)"}
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    onClick={onBuy}
                    data-testid="button-buy-credits-inline"
                  >
                    <Lock className="h-4 w-4 mr-2" />
                    Guthaben kaufen, um Report freizuschalten
                  </Button>
                )
              ) : (
                <Button
                  className="w-full"
                  disabled={!label.trim() || saving}
                  onClick={() => onSave(d, label.trim())}
                  data-testid="button-save-analysis"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? "Speichert…" : "Analyse speichern"}
                </Button>
              )}
              {gated && !unlocked && balance > 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  Verfügbares Guthaben: {balance} Report{balance === 1 ? "" : "s"}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* RESULTS */}
      <div>
        {!valid ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              Bitte PLZ, Baujahr und Wohnfläche angeben, um die Vollanalyse zu sehen.
            </CardContent>
          </Card>
        ) : gated && !unlocked ? (
          <Card className="border-dashed">
            <CardContent className="py-14 px-6 text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Lock className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">Ausführlicher Report gesperrt</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Der Schnellcheck mit Energieklasse ist kostenlos. Der ausführliche
                  Report mit Energiebilanz, Wert &amp; Steuer (AfA/Restnutzungsdauer),
                  Risiko &amp; ESG, Sanierungsfahrplan und Solarpotenzial wird mit
                  1 Guthaben freigeschaltet.
                </p>
              </div>
              {balance > 0 ? (
                <p className="text-sm">
                  Verfügbares Guthaben: <span className="font-semibold">{balance}</span> Report{balance === 1 ? "" : "s"}.
                  Vergeben Sie links eine Bezeichnung und schalten Sie den Report frei.
                </p>
              ) : (
                <Button onClick={onBuy} data-testid="button-buy-credits-paywall">
                  <Lock className="h-4 w-4 mr-2" />
                  Guthaben kaufen
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="energie">
            <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full">
              <TabsTrigger value="energie" data-testid="tab-energie">
                <Zap className="h-4 w-4 mr-1.5" />
                Energie
              </TabsTrigger>
              <TabsTrigger value="wert" data-testid="tab-wert">
                <Banknote className="h-4 w-4 mr-1.5" />
                Wert &amp; Steuer
              </TabsTrigger>
              <TabsTrigger value="risiko" data-testid="tab-risiko">
                <Shield className="h-4 w-4 mr-1.5" />
                Risiko &amp; ESG
              </TabsTrigger>
              <TabsTrigger value="standort" data-testid="tab-standort">
                <MapPin className="h-4 w-4 mr-1.5" />
                Standort
              </TabsTrigger>
            </TabsList>

            <TabsContent value="energie" className="space-y-4 mt-4">
              {energie && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center justify-between">
                      <span>Energieklasse</span>
                      <Badge style={{ background: energie.klasse.col, color: "#fff" }}>
                        {energie.klasse.c}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <EnergyBar value={energie.endenergie} />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <Stat label="Endenergie" v={`${energie.endenergie}`} u="kWh/(m²·a)" />
                      <Stat label="Primärenergie" v={`${energie.primaerenergie}`} u="kWh/(m²·a)" />
                      <Stat label="CO₂" v={`${energie.co2Tonnen} t`} u="pro Jahr" />
                      <Stat label="HT'" v={`${energie.htP}`} u="W/K" />
                    </div>
                    {energie.pflichten.length > 0 && (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 leading-relaxed flex gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <ul className="space-y-1">
                          {energie.pflichten.map((p, i) => <li key={i}>{p}</li>)}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {renovation && renovation.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Hammer className="h-4 w-4" />
                      Sanierungsszenarien
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid sm:grid-cols-3 gap-3">
                      {renovation.map((s) => (
                        <div key={s.klasse} className="rounded-lg border border-border p-3">
                          <div className="font-serif text-2xl font-semibold mb-1">
                            Klasse {s.klasse}
                          </div>
                          <ul className="text-xs space-y-1 mb-2 text-muted-foreground">
                            {s.massnahmen.map((m, i) => (
                              <li key={i}>· {m.name}</li>
                            ))}
                          </ul>
                          <div className="text-xs text-muted-foreground">Investition</div>
                          <div className="font-semibold text-sm">{s.gesamtKosten.toLocaleString("de")} €</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {solar && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sun className="h-4 w-4" />
                      Solar-Potenzial Dach
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <Stat label="Nutzbare Fläche" v={`${solar.potenzialQm} m²`} />
                      <Stat label="Anlage" v={`${solar.kWp} kWp`} />
                      <Stat label="Ertrag" v={`${solar.kWhJahr.toLocaleString("de")} kWh`} u="pro Jahr" />
                      <Stat label="Ersparnis" v={`${solar.ersparnisEur.toLocaleString("de")} €`} u="pro Jahr" />
                    </div>
                  </CardContent>
                </Card>
              )}

              <Foerderliste />
            </TabsContent>

            <TabsContent value="wert" className="space-y-4 mt-4">
              {wert && value && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Marktwert &amp; Sachwert
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <Stat label="Marktwert (Schätzung)" v={`${value.total.toLocaleString("de")} €`} u={`${value.proQm} €/m²`} />
                      <Stat label="Sachwert (NHK 2010 + BPI)" v={`${wert.wAktuell.toLocaleString("de")} €`} />
                      <Stat label="Mark 1914" v={`${wert.w1914.toLocaleString("de")} M`} u="für Versicherung" />
                    </div>
                  </CardContent>
                </Card>
              )}

              {restnutz && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">AfA &amp; Restnutzungsdauer</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <Stat label="Gebäudealter" v={`${restnutz.alter} J.`} />
                      <Stat label="Gesamtnutzungsdauer" v={`${restnutz.gnd} J.`} />
                      <Stat label="Restnutzung regulär" v={`${restnutz.rndRegulaer} J.`} />
                      <Stat label="Restnutzung wirtsch." v={`${restnutz.rndWirtschaftlich} J.`} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Stat label={`AfA regulär ${restnutz.afaRegulaer}%`} v={`${restnutz.afaRegulaerJahr.toLocaleString("de")} €`} u="pro Jahr" />
                      <Stat label={`AfA verkürzt ${restnutz.afaVerkuerzt}%`} v={`${restnutz.afaVerkuerztJahr.toLocaleString("de")} €`} u="pro Jahr" />
                    </div>
                    {restnutz.gutachtenLohnt && (
                      <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-900 leading-relaxed">
                        <strong className="block mb-1">Steuergutachten lohnt sich:</strong>
                        Mehrabschreibung von ca. {restnutz.mehrabschreibung.toLocaleString("de")} €/Jahr,
                        geschätzte Steuerersparnis {restnutz.steuerersparnis.toLocaleString("de")} €/Jahr (bei Grenzsteuersatz 35 %).
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="risiko" className="space-y-4 mt-4">
              {risk && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center justify-between">
                      <span>Standort- &amp; Klimarisiko</span>
                      <Badge style={{ background: risk.color, color: "#fff" }}>
                        {risk.level}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <Stat label="Sturm/Niederschlag" v={`${risk.standortRisiko}/3`} />
                      <Stat label="Hitze/Trockenheit" v={`${risk.hitzeRisiko}/3`} />
                      <Stat label="Bauzustand" v={`${risk.baujahrRisiko}/3`} />
                      <Stat label="Gesamt-Score" v={`${risk.total}/100`} />
                    </div>
                  </CardContent>
                </Card>
              )}

              {esg && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">ESG &amp; Pfade</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3">
                    <Stat
                      label="CRREM Decarbonisation Pathway"
                      v={esg.crrem}
                      u={esg.crrem === "On Track" ? "auf Klimazielpfad" : "Stranding-Risiko"}
                    />
                    <Stat
                      label="EU-Taxonomie"
                      v={esg.euTaxonomie ? "konform" : "nicht konform"}
                      u="Top-15 % EE-Bestand"
                    />
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="standort" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Standortanalyse
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {d.lat != null && d.lng != null ? (
                    <>
                      <StandortMap
                        lat={d.lat}
                        lng={d.lng}
                        label={
                          [d.strasse, d.hausnummer].filter(Boolean).join(" ") ||
                          [d.plz, d.city].filter(Boolean).join(" ") ||
                          undefined
                        }
                      />
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Stat
                          label="Adresse"
                          v={[d.strasse, d.hausnummer].filter(Boolean).join(" ") || "—"}
                        />
                        <Stat label="Ort" v={[d.plz, d.city].filter(Boolean).join(" ") || "—"} />
                        <Stat label="Breitengrad" v={d.lat.toFixed(5)} />
                        <Stat label="Längengrad" v={d.lng.toFixed(5)} />
                      </div>
                      {klima && (
                        <div className="text-xs text-muted-foreground rounded-md bg-secondary/40 p-2.5 leading-relaxed">
                          <div><strong>Region:</strong> {land || klima.l}</div>
                          <div>{klima.hgt} Kd Heizgradtage · ⌀ {klima.t} °C</div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                      Geben Sie oben eine Adresse mit Autovervollständigung ein, um den
                      Standort auf der interaktiven Karte anzuzeigen.
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 no-print">
          <p className="text-[11px] text-muted-foreground leading-relaxed flex-1 min-w-[220px]">
            Alle Werte sind unverbindliche Schätzungen auf Basis vereinfachter Modelle
            (DIN V 18599, NHK 2010 mit BPI {`${(1.487).toFixed(3)}`}, ImmoWertV).
            Rechtsgültige Energieausweise, Verkehrswertgutachten und Sanierungsfahrpläne
            erstellen ausschließlich qualifizierte Sachverständige bzw. eingetragene
            Energieberater.
          </p>
          {valid && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full border-[1.5px] gap-1.5 shrink-0"
              onClick={handlePrint}
              data-testid="button-export-pdf"
            >
              <Printer className="h-3.5 w-3.5" />
              Als PDF speichern
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Foerderliste() {
  const [filter, setFilter] = useState<string>("alle");
  const list = filter === "alle" ? FOERDERUNG : FOERDERUNG.filter((f) => f.tags.includes(filter));
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Förderungen 2025/2026</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5 mb-3">
          <FilterChip active={filter === "alle"} onClick={() => setFilter("alle")}>Alle</FilterChip>
          {FOERDER_KATEGORIEN.map((k) => (
            <FilterChip key={k.id} active={filter === k.id} onClick={() => setFilter(k.id)}>
              {k.l}
            </FilterChip>
          ))}
        </div>
        <div className="space-y-2">
          {list.map((f) => (
            <div key={f.name} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-3 mb-1">
                <div className="font-semibold text-sm">{f.name}</div>
                <Badge variant="secondary" className="shrink-0 text-[10px]">{f.satz}</Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-1">{f.beschreibung}</p>
              <p className="text-[11px] text-muted-foreground"><strong>Max:</strong> {f.max}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
        active ? "bg-primary text-primary-foreground border-primary" : "bg-white text-muted-foreground border-border hover:border-primary/40"
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</Label>
      {children}
      {hint && <span className="block mt-0.5 text-[10px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function CheckRow({
  label, checked, onChange, testId,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
        data-testid={testId}
      />
      <span className="text-xs text-foreground">{label}</span>
    </label>
  );
}

function SelectField({
  value, options, onChange, testId,
}: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; testId?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 text-sm" data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Stat({ label, v, u }: { label: string; v: string; u?: string }) {
  return (
    <div className="rounded-lg bg-secondary/50 border border-border p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className="font-serif text-base font-semibold text-foreground leading-tight">{v}</div>
      {u && <div className="text-[10px] text-muted-foreground">{u}</div>}
    </div>
  );
}
