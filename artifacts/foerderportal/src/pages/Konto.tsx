import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, FolderKanban, Users, ArrowRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyImmobilienKunde,
  useUpsertMyImmobilienKunde,
  getGetMyImmobilienKundeQueryKey,
  type ImmobilienKundeInput,
  type ImmobilienKundeInputTyp,
} from "@workspace/api-client-react";
import { KOMMERZIELLE_KONTO_TYPEN } from "@/lib/kontoTypen";

const toIntOrNull = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

export default function Konto() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: existing, isLoading } = useGetMyImmobilienKunde();
  const upsert = useUpsertMyImmobilienKunde();

  const [typ, setTyp] = useState<ImmobilienKundeInputTyp>("hausverwaltung");
  const [firma, setFirma] = useState("");
  const [ansprechpartner, setAnsprechpartner] = useState("");
  const [telefon, setTelefon] = useState("");
  const [email, setEmail] = useState("");
  const [anzahlGebaeude, setAnzahlGebaeude] = useState("");
  const [wohneinheitenGesamt, setWohneinheitenGesamt] = useState("");

  useEffect(() => {
    if (!existing) return;
    setTyp(existing.typ === "privat" ? "hausverwaltung" : existing.typ);
    setFirma(existing.firma ?? "");
    setAnsprechpartner(existing.ansprechpartner ?? "");
    setTelefon(existing.telefon ?? "");
    setEmail(existing.email ?? "");
    setAnzahlGebaeude(existing.anzahlGebaeude != null ? String(existing.anzahlGebaeude) : "");
    setWohneinheitenGesamt(
      existing.wohneinheitenGesamt != null ? String(existing.wohneinheitenGesamt) : "",
    );
  }, [existing]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!firma.trim()) {
      toast({ title: "Firmenname fehlt", description: "Bitte geben Sie einen Firmennamen an.", variant: "destructive" });
      return;
    }
    const input: ImmobilienKundeInput = {
      typ,
      firma: firma.trim(),
      ansprechpartner: ansprechpartner.trim() || null,
      telefon: telefon.trim() || null,
      email: email.trim() || null,
      anzahlGebaeude: toIntOrNull(anzahlGebaeude),
      wohneinheitenGesamt: toIntOrNull(wohneinheitenGesamt),
    };
    try {
      await upsert.mutateAsync({ data: input });
      await qc.invalidateQueries({ queryKey: getGetMyImmobilienKundeQueryKey() });
      toast({ title: "Gespeichert", description: "Ihr Unternehmensprofil wurde aktualisiert." });
    } catch {
      toast({ title: "Fehler", description: "Speichern fehlgeschlagen. Bitte erneut versuchen.", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 w-full max-w-[1100px] mx-auto px-4 sm:px-8 py-10">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Mein Unternehmenskonto</h1>
          <p className="text-muted-foreground mt-1">
            Hinterlegen Sie Ihr Unternehmensprofil und verwalten Sie Ihr Immobilienportfolio sowie Ihre betreuten Kunden.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 mb-8">
          <Link href="/portfolio" data-testid="link-portfolio">
            <Card className="h-full transition-colors hover:border-[var(--klard-teal)]">
              <CardContent className="flex items-center gap-4 p-5">
                <div className="rounded-lg bg-[var(--klard-teal)]/10 p-3 text-[var(--klard-teal-d)]">
                  <FolderKanban className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-foreground">Immobilienportfolio</div>
                  <div className="text-sm text-muted-foreground">Objekte anlegen und verwalten</div>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          <Link href="/kunden" data-testid="link-kunden">
            <Card className="h-full transition-colors hover:border-[var(--klard-teal)]">
              <CardContent className="flex items-center gap-4 p-5">
                <div className="rounded-lg bg-[var(--klard-teal)]/10 p-3 text-[var(--klard-teal-d)]">
                  <Users className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-foreground">Verwaltete Kunden</div>
                  <div className="text-sm text-muted-foreground">Betreute Kunden erfassen</div>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Unternehmensprofil</CardTitle>
            <CardDescription>
              Diese Angaben helfen uns, passende Förderungen und Leistungen für Sie bereitzustellen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-8">
                <Loader2 className="h-4 w-4 animate-spin" /> Lädt …
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="typ">Art des Unternehmens</Label>
                    <Select value={typ} onValueChange={(v) => setTyp(v as ImmobilienKundeInputTyp)}>
                      <SelectTrigger id="typ" data-testid="select-typ">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {KOMMERZIELLE_KONTO_TYPEN.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="firma">Firmenname *</Label>
                    <Input id="firma" value={firma} onChange={(e) => setFirma(e.target.value)} data-testid="input-firma" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ansprechpartner">Ansprechpartner</Label>
                    <Input id="ansprechpartner" value={ansprechpartner} onChange={(e) => setAnsprechpartner(e.target.value)} data-testid="input-ansprechpartner" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="telefon">Telefon</Label>
                    <Input id="telefon" value={telefon} onChange={(e) => setTelefon(e.target.value)} data-testid="input-telefon" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">E-Mail</Label>
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="anzahlGebaeude">Anzahl Gebäude</Label>
                    <Input id="anzahlGebaeude" type="number" min="0" value={anzahlGebaeude} onChange={(e) => setAnzahlGebaeude(e.target.value)} data-testid="input-anzahl-gebaeude" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="wohneinheitenGesamt">Wohneinheiten gesamt</Label>
                    <Input id="wohneinheitenGesamt" type="number" min="0" value={wohneinheitenGesamt} onChange={(e) => setWohneinheitenGesamt(e.target.value)} data-testid="input-wohneinheiten" />
                  </div>
                </div>
                <Button type="submit" disabled={upsert.isPending} className="bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white" data-testid="button-save-konto">
                  {upsert.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Speichern
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}
