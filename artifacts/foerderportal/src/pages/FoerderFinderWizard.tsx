import { useState } from "react";
import { Link } from "wouter";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  MailCheck,
  Sparkles,
  Flame,
  Layers,
  AppWindow,
  Sun,
  Hammer,
  MessageSquare,
} from "lucide-react";
import { useSubmitFoerderFinder } from "@workspace/api-client-react";
import type { FoerderFinderInput } from "@workspace/api-client-react";

const GEBAEUDE_TYPEN = [
  { value: "einfamilienhaus", label: "Einfamilienhaus" },
  { value: "zweifamilienhaus", label: "Zweifamilienhaus" },
  { value: "mehrfamilienhaus", label: "Mehrfamilienhaus" },
  { value: "wohnung", label: "Eigentumswohnung" },
  { value: "nichtwohngebaeude", label: "Nichtwohngebäude" },
] as const;

const MASSNAHMEN = [
  { value: "heizung", label: "Heizungstausch", icon: Flame },
  { value: "daemmung", label: "Dämmung", icon: Layers },
  { value: "fenster", label: "Fenster & Türen", icon: AppWindow },
  { value: "pv", label: "Photovoltaik", icon: Sun },
  { value: "komplett", label: "Komplettsanierung", icon: Hammer },
  { value: "beratung", label: "Energieberatung", icon: MessageSquare },
] as const;

const BUNDESLAENDER = [
  "Baden-Württemberg", "Bayern", "Berlin", "Brandenburg", "Bremen", "Hamburg",
  "Hessen", "Mecklenburg-Vorpommern", "Niedersachsen", "Nordrhein-Westfalen",
  "Rheinland-Pfalz", "Saarland", "Sachsen", "Sachsen-Anhalt",
  "Schleswig-Holstein", "Thüringen",
];

const TOTAL_STEPS = 4;

export default function FoerderFinderWizard() {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [done, setDone] = useState(false);

  const [gebaeudeTyp, setGebaeudeTyp] = useState<string>("");
  const [baujahr, setBaujahr] = useState<string>("");
  const [massnahmen, setMassnahmen] = useState<string[]>([]);
  const [eigennutzer, setEigennutzer] = useState<boolean | null>(null);
  const [bundesland, setBundesland] = useState<string>("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [telefon, setTelefon] = useState("");
  const [consent, setConsent] = useState(false);

  const submit = useSubmitFoerderFinder();

  const baujahrNum = Number(baujahr);
  const baujahrValid =
    Number.isInteger(baujahrNum) && baujahrNum >= 1800 && baujahrNum <= 2026;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const canNext =
    step === 1
      ? gebaeudeTyp !== "" && baujahrValid
      : step === 2
        ? massnahmen.length > 0
        : step === 3
          ? eigennutzer !== null && bundesland !== ""
          : name.trim().length > 0 && emailValid && consent;

  function toggleMassnahme(v: string) {
    setMassnahmen((prev) =>
      prev.includes(v) ? prev.filter((m) => m !== v) : [...prev, v],
    );
  }

  async function handleSubmit() {
    const body: FoerderFinderInput = {
      name: name.trim(),
      email: email.trim(),
      ...(telefon.trim() ? { telefon: telefon.trim() } : {}),
      gebaeudeTyp: gebaeudeTyp as FoerderFinderInput["gebaeudeTyp"],
      baujahr: baujahrNum,
      massnahmen: massnahmen as FoerderFinderInput["massnahmen"],
      eigennutzer: eigennutzer === true,
      bundesland,
      dsgvoConsent: true,
    };
    try {
      await submit.mutateAsync({ data: body });
      setDone(true);
    } catch {
      toast({
        variant: "destructive",
        title: "Absenden fehlgeschlagen",
        description: "Bitte prüfen Sie Ihre Angaben und versuchen Sie es erneut.",
      });
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <section className="bg-[var(--klard-bg)] px-4 sm:px-8 py-12 border-b border-border">
        <div className="max-w-[760px] mx-auto text-center">
          <span className="inline-flex items-center gap-1.5 bg-[var(--klard-teal-l)] text-[var(--klard-teal-d)] text-[0.7rem] font-bold tracking-wider uppercase px-3 py-1 rounded-full mb-4">
            <Sparkles className="h-3.5 w-3.5" />
            Förderprogramm-Finder
          </span>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold text-foreground mb-3">
            Welche Förderung passt zu Ihrem Vorhaben?
          </h1>
          <p className="text-muted-foreground leading-relaxed">
            Beantworten Sie ein paar kurze Fragen — Sie erhalten eine persönliche
            KI-Analyse der passenden Förderprogramme kostenlos per E-Mail.
          </p>
        </div>
      </section>

      <section className="px-4 sm:px-8 py-10 max-w-[680px] mx-auto w-full flex-1">
        {done ? (
          <Card data-testid="finder-success">
            <CardContent className="p-10 text-center">
              <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[var(--klard-teal-l)] text-[var(--klard-teal-d)]">
                <MailCheck className="h-7 w-7" />
              </div>
              <h2 className="font-serif text-2xl font-semibold text-foreground mb-2">
                Ihre Analyse ist unterwegs
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto mb-6">
                Ihre Anfrage ist eingegangen. Wir analysieren die passenden
                Förderprogramme für Ihr Vorhaben und senden das Ergebnis an{" "}
                <strong className="text-foreground">{email.trim()}</strong>.
                Schauen Sie ggf. auch im Spam-Ordner nach — sollte innerhalb
                eines Tages keine E-Mail ankommen, melden Sie sich gerne bei
                uns.
              </p>
              <Link href="/check">
                <Button className="rounded-full bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white font-semibold" data-testid="button-success-check">
                  Kostenlosen Gebäudecheck starten
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-6 sm:p-8">
              {/* Progress */}
              <div className="mb-8">
                <div className="flex justify-between text-xs text-muted-foreground mb-2">
                  <span>Schritt {step} von {TOTAL_STEPS}</span>
                  <span>{Math.round((step / TOTAL_STEPS) * 100)} %</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--klard-teal)] transition-all"
                    style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
                  />
                </div>
              </div>

              {step === 1 && (
                <div className="space-y-5">
                  <h2 className="font-serif text-xl font-semibold text-foreground">
                    Ihr Gebäude
                  </h2>
                  <div className="space-y-1.5">
                    <Label>Gebäudetyp</Label>
                    <Select value={gebaeudeTyp} onValueChange={setGebaeudeTyp}>
                      <SelectTrigger data-testid="select-gebaeudetyp">
                        <SelectValue placeholder="Bitte wählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {GEBAEUDE_TYPEN.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="baujahr">Baujahr</Label>
                    <Input
                      id="baujahr"
                      type="number"
                      inputMode="numeric"
                      placeholder="z. B. 1978"
                      value={baujahr}
                      onChange={(e) => setBaujahr(e.target.value)}
                      data-testid="input-baujahr"
                    />
                    {baujahr !== "" && !baujahrValid && (
                      <p className="text-xs text-destructive">
                        Bitte ein Baujahr zwischen 1800 und 2026 angeben.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-5">
                  <div>
                    <h2 className="font-serif text-xl font-semibold text-foreground mb-1">
                      Geplante Maßnahmen
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Mehrfachauswahl möglich.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {MASSNAHMEN.map((m) => {
                      const active = massnahmen.includes(m.value);
                      const Icon = m.icon;
                      return (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => toggleMassnahme(m.value)}
                          data-testid={`massnahme-${m.value}`}
                          className={`flex flex-col items-center gap-2 rounded-xl border-[1.5px] p-4 text-center transition-colors ${
                            active
                              ? "border-[var(--klard-teal)] bg-[var(--klard-teal-l)] text-[var(--klard-teal-d)]"
                              : "border-border hover:border-[var(--klard-teal)]/50 text-foreground"
                          }`}
                        >
                          <Icon className="h-5 w-5" />
                          <span className="text-xs font-semibold leading-tight">{m.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-5">
                  <h2 className="font-serif text-xl font-semibold text-foreground">
                    Nutzung & Region
                  </h2>
                  <div className="space-y-1.5">
                    <Label>Nutzen Sie das Gebäude selbst?</Label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setEigennutzer(true)}
                        data-testid="button-eigennutzer"
                        className={`rounded-xl border-[1.5px] p-4 text-sm font-semibold transition-colors ${
                          eigennutzer === true
                            ? "border-[var(--klard-teal)] bg-[var(--klard-teal-l)] text-[var(--klard-teal-d)]"
                            : "border-border hover:border-[var(--klard-teal)]/50"
                        }`}
                      >
                        Ja, Eigennutzer
                      </button>
                      <button
                        type="button"
                        onClick={() => setEigennutzer(false)}
                        data-testid="button-vermieter"
                        className={`rounded-xl border-[1.5px] p-4 text-sm font-semibold transition-colors ${
                          eigennutzer === false
                            ? "border-[var(--klard-teal)] bg-[var(--klard-teal-l)] text-[var(--klard-teal-d)]"
                            : "border-border hover:border-[var(--klard-teal)]/50"
                        }`}
                      >
                        Nein, ich vermiete
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Bundesland</Label>
                    <Select value={bundesland} onValueChange={setBundesland}>
                      <SelectTrigger data-testid="select-bundesland">
                        <SelectValue placeholder="Bitte wählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {BUNDESLAENDER.map((b) => (
                          <SelectItem key={b} value={b}>
                            {b}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-5">
                  <div>
                    <h2 className="font-serif text-xl font-semibold text-foreground mb-1">
                      Wohin dürfen wir Ihre Analyse senden?
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Sie erhalten die KI-Analyse Ihrer Top-Förderprogramme kostenlos per E-Mail.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Vor- und Nachname"
                      data-testid="input-name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email">E-Mail</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@beispiel.de"
                      data-testid="input-email"
                    />
                    {email !== "" && !emailValid && (
                      <p className="text-xs text-destructive">Bitte eine gültige E-Mail-Adresse angeben.</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="telefon">Telefon (optional)</Label>
                    <Input
                      id="telefon"
                      type="tel"
                      value={telefon}
                      onChange={(e) => setTelefon(e.target.value)}
                      placeholder="+49 …"
                      data-testid="input-telefon"
                    />
                  </div>
                  <div className="flex items-start gap-3 rounded-lg border border-border p-4">
                    <Checkbox
                      id="dsgvo"
                      checked={consent}
                      onCheckedChange={(v) => setConsent(v === true)}
                      data-testid="checkbox-dsgvo"
                    />
                    <Label htmlFor="dsgvo" className="text-xs font-normal leading-relaxed text-muted-foreground cursor-pointer">
                      Ich willige ein, dass meine Angaben zur Erstellung und Zusendung der
                      Förderanalyse verarbeitet werden. Die Einwilligung kann ich jederzeit
                      mit Wirkung für die Zukunft widerrufen.
                    </Label>
                  </div>
                </div>
              )}

              <div className="mt-8 flex items-center justify-between">
                {step > 1 ? (
                  <Button
                    variant="ghost"
                    onClick={() => setStep((s) => s - 1)}
                    disabled={submit.isPending}
                    data-testid="button-back"
                  >
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Zurück
                  </Button>
                ) : (
                  <span />
                )}
                {step < TOTAL_STEPS ? (
                  <Button
                    onClick={() => setStep((s) => s + 1)}
                    disabled={!canNext}
                    className="rounded-full bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white font-semibold px-6"
                    data-testid="button-next"
                  >
                    Weiter
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    onClick={handleSubmit}
                    disabled={!canNext || submit.isPending}
                    className="rounded-full bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white font-semibold px-6"
                    data-testid="button-submit"
                  >
                    {submit.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Wird gesendet…
                      </>
                    ) : (
                      <>
                        Analyse anfordern
                        <Sparkles className="ml-1.5 h-4 w-4" />
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      <Footer />
    </div>
  );
}
