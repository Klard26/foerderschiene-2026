import { FileText, Zap, Banknote, Shield, Sun, Hammer, MapPin } from "lucide-react";

/**
 * Branded A4 preview of the paid Gebäude-Report with sample data. Shown to all
 * users (especially signed-out visitors) to demonstrate the value of the report
 * before purchase. Purely presentational — no live data.
 *
 * Two sample sheets: the Gebäude-Wertreport and the energetische Einordnung &
 * Sanierungsempfehlung (Förderwege / Maßnahmen-Kosten / iSFP-Hebel).
 */
export function ReportPreviewDemo() {
  return (
    <div className="space-y-8">
      <WertReportSheet />
      <EnergetischeEinordnungSheet />
    </div>
  );
}

function WertReportSheet() {
  return (
    <div className="relative">
      <div
        className="mx-auto w-full max-w-[760px] overflow-hidden rounded-xl border border-border bg-white shadow-[0_12px_40px_-12px_rgba(0,0,0,0.25)]"
        aria-label="Beispiel-Report"
      >
        {/* Letterhead */}
        <div className="flex items-start justify-between gap-4 border-b border-border bg-[var(--klard-bg)] px-6 py-5 sm:px-9">
          <div>
            <div className="flex items-center gap-2 text-[var(--klard-teal-d)]">
              <FileText className="h-5 w-5" />
              <span className="font-serif text-lg font-semibold">Klard Gebäude-Report</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Energieklasse · Marktwert · Klimarisiko · Sanierungsfahrplan
            </p>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            <div className="font-semibold text-foreground">Beispiel-Report</div>
            <div>Erstellt am 09.06.2026</div>
            <div>Report-Nr. KL-2026-0481</div>
          </div>
        </div>

        {/* Object header */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-6 py-4 sm:px-9">
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="h-4 w-4 text-[var(--klard-teal-d)]" />
            <span className="font-medium text-foreground">Hauptstraße 12, 10115 Berlin</span>
          </div>
          <span className="text-xs text-muted-foreground">Mehrfamilienhaus · Baujahr 1962 · 480 m²</span>
        </div>

        <div className="space-y-6 px-6 py-6 sm:px-9">
          {/* Energy class hero */}
          <Section icon={<Zap className="h-4 w-4" />} title="Energiebilanz">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-lg text-white" style={{ background: "#f59e0b" }}>
                <span className="font-serif text-2xl font-bold leading-none">E</span>
                <span className="text-[9px]">Klasse</span>
              </div>
              <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="Endenergie" value="168" unit="kWh/(m²·a)" />
                <Metric label="Primärenergie" value="201" unit="kWh/(m²·a)" />
                <Metric label="CO₂" value="34 t" unit="pro Jahr" />
                <Metric label="HT'" value="0,68" unit="W/(m²·K)" />
              </div>
            </div>
            <Bar />
          </Section>

          {/* Value & tax */}
          <Section icon={<Banknote className="h-4 w-4" />} title="Wert & Steuer">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric label="Marktwert (Schätzung)" value="1.840.000 €" unit="3.833 €/m²" />
              <Metric label="Sachwert (NHK 2010)" value="2.110.000 €" />
              <Metric label="AfA verkürzt 4,0 %" value="73.600 €" unit="pro Jahr" />
            </div>
            <Note tone="emerald">
              Steuergutachten lohnt sich: Mehrabschreibung ca. 41.200 €/Jahr, geschätzte
              Steuerersparnis 14.400 €/Jahr (bei Grenzsteuersatz 35 %).
            </Note>
          </Section>

          {/* Risk & ESG */}
          <Section icon={<Shield className="h-4 w-4" />} title="Risiko & ESG">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Standort-Score" value="22/100" unit="niedriges Risiko" />
              <Metric label="CRREM-Pfad" value="Stranding" unit="Nachrüstbedarf" />
              <Metric label="EU-Taxonomie" value="nicht konform" />
              <Metric label="Hitze/Trockenheit" value="2/3" />
            </div>
          </Section>

          {/* Renovation + solar two-up */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Section icon={<Hammer className="h-4 w-4" />} title="Sanierungsfahrplan">
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>· Klasse C — Dämmung + Wärmepumpe — 285.000 €</li>
                <li>· Klasse B — zzgl. Fenster + PV — 412.000 €</li>
              </ul>
            </Section>
            <Section icon={<Sun className="h-4 w-4" />} title="Solarpotenzial Dach">
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Anlage" value="38 kWp" />
                <Metric label="Ersparnis" value="6.900 €" unit="pro Jahr" />
              </div>
            </Section>
          </div>

          <p className="border-t border-border pt-3 text-[10px] leading-relaxed text-muted-foreground">
            Beispielhafte Darstellung. Alle Werte sind unverbindliche Schätzungen auf Basis
            vereinfachter Modelle (DIN V 18599, NHK 2010, ImmoWertV). Der vollständige Report
            wird auf Grundlage Ihrer Objektdaten erstellt und kann als PDF gespeichert werden.
          </p>
        </div>
      </div>

      {/* Watermark badge */}
      <div className="pointer-events-none absolute -right-2 -top-2 rotate-3 rounded-full bg-[var(--klard-teal-d)] px-3 py-1 text-[0.65rem] font-bold uppercase tracking-wider text-white shadow-lg">
        Vorschau
      </div>
    </div>
  );
}

/**
 * Second sample sheet: the "Energetische Einordnung & Sanierungsempfehlung"
 * document — a presentational mirror of the report the backend generates
 * (Ampel-Bewertung, Maßnahmen & Kosten, iSFP-Hebel, Förderwege). Sample data.
 */
function EnergetischeEinordnungSheet() {
  const INK = "#13243D";
  const AMBER = "#B86A14";
  const TEAL = "#1F7A6D";
  const RED = "#A32D2D";
  const ampel = (a: "rot" | "gelb" | "gruen") =>
    a === "rot" ? RED : a === "gelb" ? AMBER : TEAL;

  return (
    <div className="relative">
      <div
        className="mx-auto w-full max-w-[760px] overflow-hidden rounded-xl border border-border bg-white shadow-[0_12px_40px_-12px_rgba(0,0,0,0.25)]"
        aria-label="Beispiel-Report — Energetische Einordnung"
      >
        {/* Letterhead */}
        <div className="border-b border-border bg-[var(--klard-bg)] px-6 py-5 sm:px-9">
          <div className="font-serif text-base font-semibold" style={{ color: INK }}>
            ENERGETISCHE EINORDNUNG &amp; SANIERUNGSEMPFEHLUNG
          </div>
          <div className="mt-0.5 text-xs italic" style={{ color: AMBER }}>
            Ergänzung zum Gebäude-Wertreport
          </div>
          <div className="mt-2 text-xs font-semibold text-foreground">
            Objekt: Hauptstraße 12, 10115 Berlin
          </div>
          <div className="text-[11px] text-muted-foreground">
            Wohngebäude · 6 Wohneinheiten · BGF 480 m² · Baujahr 1962
          </div>
        </div>

        <div className="space-y-5 px-6 py-6 sm:px-9">
          {/* Datenbasis-Hinweis */}
          <Callout accent={RED} fill="#FCEBEB" title="Wichtiger Hinweis zur Datenbasis">
            Die energetischen Kennwerte sind Schätzungen aus den baulichen
            Merkmalen, keine Messwerte. Für verbindliche Werte ist eine Vor-Ort-
            Begehung durch eine dena-gelistete Fachperson erforderlich.
          </Callout>

          {/* 1. Energetische Einordnung */}
          <DocSection title="1. Energetische Einordnung (Schätzung)">
            <p className="text-xs text-foreground">
              Geschätzte Effizienzklasse:{" "}
              <span className="font-semibold">E–G</span>{" "}
              <span className="text-muted-foreground">
                (Endenergie ca. 130–200 kWh/(m²·a))
              </span>
            </p>
            <DocTable
              head={["Bauteil", "Ist-Zustand", "Bewertung"]}
              widths={[0.32, 0.34, 0.34]}
              rows={[
                ["Außenwände", "Mauerwerk, Anstrich", { text: "keine erkennbare Dämmung", color: ampel("rot") }],
                ["Dach / oberste Geschossdecke", "Spitzdach, nicht ausgebaut", { text: "vermutlich ungedämmt", color: ampel("rot") }],
                ["Fenster", "Ein-/Zweifachverglasung", { text: "energetisch veraltet", color: ampel("rot") }],
                ["Heizung", "Gas", { text: "fossil, mittlerer Stand", color: ampel("gelb") }],
              ]}
            />
          </DocSection>

          {/* 2. Maßnahmen & Kosten */}
          <DocSection title="2. Empfohlene Maßnahmen & Kosten (Preisniveau 2026)">
            <DocTable
              head={["Maßnahme", "Menge", "Kosten (ca.)", "Förderstelle"]}
              widths={[0.4, 0.16, 0.26, 0.18]}
              rows={[
                ["Dämmung oberste Geschossdecke", "~160 m²", "8.000 – 11.000 €", "BAFA"],
                ["Fassadendämmung (WDVS)", "~430 m²", "66.000 – 89.000 €", "BAFA"],
                ["Fenstertausch (3-fach)", "~30 Stk.", "24.000 – 33.000 €", "BAFA"],
                ["Heizungstausch (Wärmepumpe)", "1 Anlage", "40.000 – 54.000 €", "KfW"],
                ["Lüftung mit Wärmerückgewinnung", "6 WE", "33.000 – 45.000 €", "BAFA"],
              ]}
              total={["Summe (grobe Spanne)", "", "171.000 – 232.000 €", ""]}
            />
          </DocSection>

          {/* 3. iSFP-Hebel */}
          <DocSection title="3. iSFP & iSFP-Bonus">
            <p className="text-xs text-foreground">
              Der individuelle Sanierungsfahrplan (iSFP) ist der zentrale
              Förderhebel: +5 Prozentpunkte auf BAFA-Einzelmaßnahmen und
              Verdopplung der förderfähigen Kosten je Wohneinheit.
            </p>
            <DocTable
              head={["Förderrahmen Gebäudehülle", "ohne iSFP", "mit iSFP"]}
              widths={[0.46, 0.27, 0.27]}
              rows={[
                ["Förderfähige Kosten (6 WE)", "180.000 €", "360.000 €"],
                ["Fördersatz", "15 %", "20 %"],
                ["iSFP-Erstellung", "—", "50 % Zuschuss, max. 850 € (+250 € EV)"],
              ]}
            />
            <Callout accent={TEAL} fill="#E2F0ED" title="Beispiel: Fassadendämmung (WDVS) (~77.500 €)">
              Ohne iSFP: 11.625 € · Mit iSFP: 15.500 € = rund 3.875 €
              Mehrförderung allein bei dieser Maßnahme.
            </Callout>
          </DocSection>

          {/* 4. Förderwege */}
          <DocSection title="4. Passende Förderwege">
            <DocTable
              head={["Maßnahme", "Förderstelle", "Konditionen 2026"]}
              widths={[0.3, 0.24, 0.46]}
              rows={[
                ["Gebäudehülle (Dämmung, Fenster)", "BAFA (BEG EM)", "15 % + 5 % iSFP-Bonus; ff. Kosten bis 60.000 €/WE"],
                ["Heizungstausch (Wärmepumpe)", "KfW (458)", "30 % Grund + Boni, bis 70 %"],
                ["iSFP-Erstellung", "BAFA (EBW)", "50 % Zuschuss, max. 850 € (+250 € EV-Bonus)"],
                ["Fachplanung / Baubegleitung", "BAFA", "50 % Zuschuss auf Experten-Honorar"],
              ]}
            />
          </DocSection>

          <p className="border-t border-border pt-3 text-[10px] leading-relaxed text-muted-foreground">
            Beispielhafte Darstellung. Kostenschätzungen sind marktübliche
            Richtwerte (Preisniveau 2026), keine Angebote. Förderkonditionen Stand
            2026; vor Antragstellung an der amtlichen Quelle prüfen.
          </p>
        </div>
      </div>

      {/* Watermark badge */}
      <div className="pointer-events-none absolute -right-2 -top-2 rotate-3 rounded-full bg-[var(--klard-teal-d)] px-3 py-1 text-[0.65rem] font-bold uppercase tracking-wider text-white shadow-lg">
        Vorschau
      </div>
    </div>
  );
}

function DocSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 border-b-2 border-[var(--klard-teal-d)] pb-1 text-sm font-semibold text-foreground">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

type DocCell = string | { text: string; color?: string };
function DocTable({
  head, widths, rows, total,
}: {
  head: string[];
  widths: number[];
  rows: DocCell[][];
  total?: DocCell[];
}) {
  const cols = widths.map((w) => `${(w * 100).toFixed(2)}%`);
  const cellText = (c: DocCell) => (typeof c === "string" ? c : c.text);
  const cellColor = (c: DocCell) => (typeof c === "string" ? undefined : c.color);
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full table-fixed border-collapse text-[11px]">
        <colgroup>
          {cols.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-[#13243D] text-white">
            {head.map((h, i) => (
              <th key={i} className="px-2 py-1.5 text-left font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className={ri % 2 === 1 ? "bg-[#F7F4EE]" : "bg-white"}>
              {r.map((c, ci) => (
                <td
                  key={ci}
                  className="px-2 py-1.5 align-top text-foreground"
                  style={{ color: cellColor(c) }}
                >
                  {cellText(c)}
                </td>
              ))}
            </tr>
          ))}
          {total && (
            <tr className="border-t border-border bg-white font-semibold">
              {total.map((c, ci) => (
                <td key={ci} className="px-2 py-1.5 align-top text-foreground">
                  {cellText(c)}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Callout({
  accent, fill, title, children,
}: {
  accent: string;
  fill: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-md border-l-4 p-2.5"
      style={{ background: fill, borderColor: accent }}
    >
      <div className="text-[11px] font-semibold" style={{ color: accent }}>
        {title}
      </div>
      <div className="mt-0.5 text-[11px] leading-relaxed text-[#333]">
        {children}
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="text-[var(--klard-teal-d)]">{icon}</span>
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-2">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-serif text-sm font-semibold leading-tight text-foreground">{value}</div>
      {unit && <div className="text-[9px] text-muted-foreground">{unit}</div>}
    </div>
  );
}

function Bar() {
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full">
      {["#16a34a", "#65a30d", "#ca8a04", "#f59e0b", "#ea580c", "#dc2626", "#991b1b"].map((c, i) => (
        <div key={i} className="flex-1" style={{ background: c, opacity: i === 3 ? 1 : 0.45 }} />
      ))}
    </div>
  );
}

function Note({ tone, children }: { tone: "emerald"; children: React.ReactNode }) {
  const cls =
    tone === "emerald"
      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
      : "bg-amber-50 border-amber-200 text-amber-900";
  return <div className={`rounded-lg border p-2.5 text-[11px] leading-relaxed ${cls}`}>{children}</div>;
}
