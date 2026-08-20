import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Building2, FileText, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { vorgangApi, type Expose, type ExposeInput } from "@/lib/vorgangApi";

function numOrUndef(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

export function ExposePanel() {
  const { getToken } = useAuth();
  const { toast } = useToast();

  const [titel, setTitel] = useState("");
  const [wohnflaeche, setWohnflaeche] = useState("");
  const [zimmer, setZimmer] = useState("");
  const [kaufpreis, setKaufpreis] = useState("");
  const [kennwert, setKennwert] = useState("");
  const [klasse, setKlasse] = useState("");
  const [traeger, setTraeger] = useState("");
  const [beschreibung, setBeschreibung] = useState("");

  const [result, setResult] = useState<{ expose: Expose; pflichtangaben_hinweis: string } | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      const body: ExposeInput = {
        titel: titel.trim(),
        wohnflaeche_m2: numOrUndef(wohnflaeche),
        zimmer: numOrUndef(zimmer),
        kaufpreis_eur: numOrUndef(kaufpreis),
        energie_kennwert_kwh_m2a: numOrUndef(kennwert),
        energie_klasse: klasse.trim() || undefined,
        energietraeger: traeger.trim() || undefined,
        beschreibung: beschreibung.trim() || undefined,
      };
      return vorgangApi.createExpose(await getToken(), body);
    },
    onSuccess: (data) => {
      setResult(data);
      toast({ title: "Exposé erstellt" });
    },
    onError: (e) =>
      toast({
        variant: "destructive",
        title: "Fehler",
        description: e instanceof Error ? e.message : "Aktion fehlgeschlagen",
      }),
  });

  const pflichtOk = result?.pflichtangaben_hinweis.startsWith("Alle");

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="rounded-[20px] border-[1.5px]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <Building2 className="h-5 w-5 text-[var(--klard-teal-d)]" />
            Exposé erstellen
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Eckdaten erfassen — ohne Beschreibung wird automatisch ein sachlicher Fließtext erzeugt.
          </p>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (titel.trim()) mut.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="expose-titel">Titel *</Label>
              <Input
                id="expose-titel"
                value={titel}
                onChange={(e) => setTitel(e.target.value)}
                placeholder="z. B. 3-Zimmer-Wohnung in Freiburg"
                data-testid="input-expose-titel"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="expose-flaeche">Wohnfläche (m²)</Label>
                <Input id="expose-flaeche" inputMode="decimal" value={wohnflaeche}
                  onChange={(e) => setWohnflaeche(e.target.value)} placeholder="85" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="expose-zimmer">Zimmer</Label>
                <Input id="expose-zimmer" inputMode="decimal" value={zimmer}
                  onChange={(e) => setZimmer(e.target.value)} placeholder="3" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expose-preis">Kaufpreis (€)</Label>
              <Input id="expose-preis" inputMode="decimal" value={kaufpreis}
                onChange={(e) => setKaufpreis(e.target.value)} placeholder="420000" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="expose-kennwert">Energiekennwert (kWh/m²a)</Label>
                <Input id="expose-kennwert" inputMode="decimal" value={kennwert}
                  onChange={(e) => setKennwert(e.target.value)} placeholder="95" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="expose-klasse">Effizienzklasse</Label>
                <Input id="expose-klasse" value={klasse}
                  onChange={(e) => setKlasse(e.target.value)} placeholder="C" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expose-traeger">Wesentlicher Energieträger</Label>
              <Input id="expose-traeger" value={traeger}
                onChange={(e) => setTraeger(e.target.value)} placeholder="z. B. Gas, Fernwärme" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expose-text">Beschreibung (optional)</Label>
              <Textarea id="expose-text" value={beschreibung} rows={3}
                onChange={(e) => setBeschreibung(e.target.value)}
                placeholder="Leer lassen für automatisch erzeugten Text" />
            </div>
            <Button type="submit" disabled={mut.isPending || !titel.trim()} data-testid="button-expose-erstellen">
              {mut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Exposé erstellen
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="rounded-[20px] border-[1.5px]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <FileText className="h-5 w-5 text-[var(--klard-teal-d)]" />
            Vorschau
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!result ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Noch kein Exposé erstellt. Füllen Sie das Formular aus und klicken Sie auf
              „Exposé erstellen“.
            </p>
          ) : (
            <div className="space-y-4" data-testid="expose-result">
              <div
                className={`flex items-start gap-2 rounded-xl p-3 text-sm ${
                  pflichtOk ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"
                }`}
              >
                {pflichtOk ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span>{result.pflichtangaben_hinweis}</span>
              </div>
              <div>
                <h3 className="text-base font-semibold">{result.expose.titel}</h3>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {result.expose.wohnflaeche_m2 != null && (
                    <Row label="Wohnfläche" value={`${result.expose.wohnflaeche_m2} m²`} />
                  )}
                  {result.expose.zimmer != null && (
                    <Row label="Zimmer" value={String(result.expose.zimmer)} />
                  )}
                  {result.expose.kaufpreis_eur != null && (
                    <Row label="Kaufpreis" value={`${result.expose.kaufpreis_eur.toLocaleString("de-DE")} €`} />
                  )}
                  {result.expose.energie_kennwert_kwh_m2a != null && (
                    <Row label="Energiekennwert" value={`${result.expose.energie_kennwert_kwh_m2a} kWh/m²a`} />
                  )}
                  {result.expose.energie_klasse && (
                    <Row label="Effizienzklasse" value={result.expose.energie_klasse} />
                  )}
                  {result.expose.energietraeger && (
                    <Row label="Energieträger" value={result.expose.energietraeger} />
                  )}
                </dl>
              </div>
              {result.expose.beschreibung && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Beschreibung
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                    {result.expose.beschreibung}
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </>
  );
}
