import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  BT, HT, INS, WI, EC,
  ageBand, plzKlima, plzPraefix,
  calcEnergie, type BuildingInput,
} from "@workspace/energie-calc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowRight } from "lucide-react";

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
};

interface Props {
  variant?: "card" | "embedded";
  showCta?: boolean;
}

export function EnergieSchnellcheck({ variant = "card", showCta = true }: Props) {
  const [, setLocation] = useLocation();
  const [d, setD] = useState<BuildingInput>(DEFAULT);
  const u = <K extends keyof BuildingInput>(k: K, v: BuildingInput[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  const valid = d.plz.length >= 5 && d.baujahr >= 1850 && d.wohnflaeche >= 20;
  const result = useMemo(() => (valid ? calcEnergie(d) : null), [d, valid]);
  const klima = plzPraefix(d.plz) !== null ? plzKlima(d.plz) : null;
  const ageInfo = ageBand(d.baujahr);

  const cardClass = variant === "card"
    ? "bg-white rounded-[20px] border border-border shadow-md p-6 sm:p-8"
    : "";

  return (
    <div className={cardClass} data-testid="energie-schnellcheck">
      <div className="grid md:grid-cols-2 gap-8">
        <div>
          <div className="mb-5">
            <h3 className="font-serif text-xl font-semibold text-foreground mb-1">
              Energie-Schnellcheck
            </h3>
            <p className="text-sm text-muted-foreground">
              In 30 Sekunden zur Energieklasse Ihrer Immobilie. Anschließend passende
              Energieberater finden.
            </p>
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
            <Field label="Baujahr" hint={ageInfo.d}>
              <Input
                type="number"
                value={d.baujahr}
                onChange={(e) => u("baujahr", Number(e.target.value) || 0)}
                min={1850}
                max={new Date().getFullYear()}
                data-testid="input-baujahr"
              />
            </Field>
            <Field label="Gebäudetyp">
              <SelectField
                value={d.gebaeudetyp}
                options={BT.map((b) => ({ value: b.id, label: b.l }))}
                onChange={(v) => u("gebaeudetyp", v as BuildingInput["gebaeudetyp"])}
                testId="select-gebaeudetyp"
              />
            </Field>
            <Field label="Wohnfläche" suffix="m²">
              <Input
                type="number"
                value={d.wohnflaeche}
                onChange={(e) => u("wohnflaeche", Number(e.target.value) || 0)}
                min={20}
                data-testid="input-wohnflaeche"
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
          </div>

          {klima && (
            <p className="mt-3 text-xs text-muted-foreground">
              Klimaregion: {klima.l} · {klima.hgt} Kd Heizgradtage · ⌀ {klima.t} °C
            </p>
          )}
        </div>

        <div className="flex flex-col">
          {result ? (
            <>
              <div className="mb-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                  Ihre vermutliche Energieklasse
                </div>
                <div className="flex items-baseline gap-3">
                  <span
                    className="font-serif text-5xl font-bold leading-none"
                    style={{ color: result.klasse.col }}
                    data-testid="result-klasse"
                  >
                    {result.klasse.c}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {result.endenergie} kWh / (m²·a)
                  </span>
                </div>
              </div>

              <EnergyBar value={result.endenergie} />

              <div className="grid grid-cols-3 gap-3 mt-4">
                <Stat label="Endenergie" value={`${result.endenergie}`} unit="kWh/(m²·a)" />
                <Stat label="Primärenergie" value={`${result.primaerenergie}`} unit="kWh/(m²·a)" />
                <Stat label="CO₂-Ausstoß" value={`${result.co2Tonnen}`} unit="t / Jahr" />
              </div>

              {result.pflichten.length > 0 && (
                <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 leading-relaxed">
                  <strong className="block mb-1">Hinweis nach GEG 2024:</strong>
                  {result.pflichten[0]}
                </div>
              )}

              {showCta && (
                <Button
                  className="mt-5 w-full rounded-full bg-primary hover:bg-[var(--klard-teal-d)] text-white font-semibold h-11"
                  onClick={() => {
                    const params = new URLSearchParams();
                    params.set("category", "energieberatung");
                    if (d.plz) params.set("city", d.plz);
                    setLocation(`/search?${params.toString()}`);
                  }}
                  data-testid="button-find-berater"
                >
                  Passende Energieberater finden
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              )}

              <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
                Unverbindliche Schätzung auf Basis von Baujahr, Hülle und Heiztechnik.
                Ein rechtsgültiger Energieausweis nach GEG 2024 wird ausschließlich von
                eingetragenen Energieberatern erstellt.
              </p>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground border-2 border-dashed border-border rounded-xl p-6 text-center min-h-[200px]">
              Bitte PLZ, Baujahr und Wohnfläche angeben, um die Schätzung zu sehen.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, suffix, children }: { label: string; hint?: string; suffix?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs font-medium text-muted-foreground mb-1 block">
        {label}{suffix ? ` (${suffix})` : ""}
      </Label>
      {children}
      {hint && <span className="block mt-0.5 text-[10px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function SelectField({
  value, options, onChange, testId,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  testId?: string;
}) {
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

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-lg bg-secondary/50 border border-border p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className="font-serif text-lg font-semibold text-foreground leading-tight">{value}</div>
      {unit && <div className="text-[10px] text-muted-foreground">{unit}</div>}
    </div>
  );
}

export function EnergyBar({ value }: { value: number }) {
  const aktKlasse = EC.find((c) => value <= c.m) ?? EC[EC.length - 1]!;
  return (
    <div className="flex rounded-lg overflow-hidden h-7 border border-border" data-testid="energy-bar">
      {EC.map((c) => {
        const isActive = c.c === aktKlasse.c;
        return (
          <div
            key={c.c}
            className="flex-1 flex items-center justify-center text-[11px] font-bold transition-all"
            style={{
              background: isActive ? c.col : c.col + "22",
              color: isActive ? "#fff" : "#888",
              boxShadow: isActive ? `inset 0 0 0 2px ${c.col}` : undefined,
            }}
          >
            {c.c}
          </div>
        );
      })}
    </div>
  );
}
