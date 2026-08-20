import { useState, type FormEvent } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Pencil, Trash2, Building2, ClipboardCheck } from "lucide-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListImmobilienPortfolioObjekte,
  useCreateImmobilienPortfolioObjekt,
  useUpdateImmobilienPortfolioObjekt,
  useDeleteImmobilienPortfolioObjekt,
  getListImmobilienPortfolioObjekteQueryKey,
  type ImmobilienPortfolioObjekt,
  type ImmobilienPortfolioObjektInput,
} from "@workspace/api-client-react";
import { GEBAEUDETYPEN, HEIZUNGSARTEN } from "@/lib/kontoTypen";

const NONE = "__none__";
const toIntOrNull = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

type FormState = {
  bezeichnung: string;
  strasse: string;
  hausnummer: string;
  plz: string;
  ort: string;
  gebaeudetyp: string;
  baujahr: string;
  wohnflaeche: string;
  wohneinheiten: string;
  heizung: string;
  notiz: string;
};

const EMPTY: FormState = {
  bezeichnung: "", strasse: "", hausnummer: "", plz: "", ort: "",
  gebaeudetyp: "", baujahr: "", wohnflaeche: "", wohneinheiten: "", heizung: "", notiz: "",
};

export default function Portfolio() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: objekte, isLoading } = useListImmobilienPortfolioObjekte();
  const createM = useCreateImmobilienPortfolioObjekt();
  const updateM = useUpdateImmobilienPortfolioObjekt();
  const deleteM = useDeleteImmobilienPortfolioObjekt();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<ImmobilienPortfolioObjekt | null>(null);

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const saving = createM.isPending || updateM.isPending;

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListImmobilienPortfolioObjekteQueryKey() });

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY);
    setDialogOpen(true);
  };

  const openEdit = (o: ImmobilienPortfolioObjekt) => {
    setEditingId(o.id);
    setForm({
      bezeichnung: o.bezeichnung ?? "",
      strasse: o.strasse ?? "",
      hausnummer: o.hausnummer ?? "",
      plz: o.plz ?? "",
      ort: o.ort ?? "",
      gebaeudetyp: o.gebaeudetyp ?? "",
      baujahr: o.baujahr != null ? String(o.baujahr) : "",
      wohnflaeche: o.wohnflaeche != null ? String(o.wohnflaeche) : "",
      wohneinheiten: o.wohneinheiten != null ? String(o.wohneinheiten) : "",
      heizung: o.heizung ?? "",
      notiz: o.notiz ?? "",
    });
    setDialogOpen(true);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.bezeichnung.trim()) {
      toast({ title: "Bezeichnung fehlt", description: "Bitte geben Sie eine Bezeichnung an.", variant: "destructive" });
      return;
    }
    const input: ImmobilienPortfolioObjektInput = {
      bezeichnung: form.bezeichnung.trim(),
      strasse: form.strasse.trim() || null,
      hausnummer: form.hausnummer.trim() || null,
      plz: form.plz.trim() || null,
      ort: form.ort.trim() || null,
      gebaeudetyp: form.gebaeudetyp.trim() || null,
      baujahr: toIntOrNull(form.baujahr),
      wohnflaeche: toIntOrNull(form.wohnflaeche),
      wohneinheiten: toIntOrNull(form.wohneinheiten),
      heizung: form.heizung.trim() || null,
      notiz: form.notiz.trim() || null,
    };
    try {
      if (editingId != null) {
        await updateM.mutateAsync({ id: editingId, data: input });
      } else {
        await createM.mutateAsync({ data: input });
      }
      await invalidate();
      setDialogOpen(false);
      toast({ title: "Gespeichert", description: "Das Objekt wurde gespeichert." });
    } catch {
      toast({ title: "Fehler", description: "Speichern fehlgeschlagen.", variant: "destructive" });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteM.mutateAsync({ id: deleteTarget.id });
      await invalidate();
      toast({ title: "Gelöscht", description: "Das Objekt wurde entfernt." });
    } catch {
      toast({ title: "Fehler", description: "Löschen fehlgeschlagen.", variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  };

  const list = objekte ?? [];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 w-full max-w-[1100px] mx-auto px-4 sm:px-8 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Immobilienportfolio</h1>
            <p className="text-muted-foreground mt-1">Verwalten Sie die Objekte Ihres Bestands.</p>
          </div>
          <Button onClick={openCreate} className="bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white" data-testid="button-add-objekt">
            <Plus className="h-4 w-4 mr-2" /> Objekt hinzufügen
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-12">
            <Loader2 className="h-4 w-4 animate-spin" /> Lädt …
          </div>
        ) : list.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center text-center gap-3 py-14">
              <Building2 className="h-10 w-10 text-muted-foreground" />
              <div className="font-semibold text-foreground">Noch keine Objekte</div>
              <p className="text-sm text-muted-foreground max-w-sm">
                Legen Sie Ihr erstes Objekt an, um es später mit dem Gebäudecheck zu prüfen.
              </p>
              <Button onClick={openCreate} variant="outline" data-testid="button-add-objekt-empty">
                <Plus className="h-4 w-4 mr-2" /> Objekt hinzufügen
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {list.map((o) => (
              <Card key={o.id} data-testid={`card-objekt-${o.id}`}>
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-foreground">{o.bezeichnung}</div>
                      {(o.strasse || o.ort) && (
                        <div className="text-sm text-muted-foreground">
                          {[o.strasse, o.hausnummer].filter(Boolean).join(" ")}
                          {o.plz || o.ort ? `, ${[o.plz, o.ort].filter(Boolean).join(" ")}` : ""}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(o)} aria-label="Bearbeiten" data-testid={`button-edit-objekt-${o.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(o)} aria-label="Löschen" data-testid={`button-delete-objekt-${o.id}`}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    {o.gebaeudetyp && <span>{o.gebaeudetyp}</span>}
                    {o.baujahr != null && <span>Baujahr {o.baujahr}</span>}
                    {o.wohnflaeche != null && <span>{o.wohnflaeche} m²</span>}
                    {o.wohneinheiten != null && <span>{o.wohneinheiten} WE</span>}
                    {o.heizung && <span>{o.heizung}</span>}
                  </div>
                  {o.notiz && <p className="text-sm text-foreground/80">{o.notiz}</p>}
                  <Link href="/check" className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--klard-teal-d)] hover:underline" data-testid={`link-check-${o.id}`}>
                    <ClipboardCheck className="h-4 w-4" /> Gebäudecheck starten
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
      <Footer />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId != null ? "Objekt bearbeiten" : "Objekt hinzufügen"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bezeichnung">Bezeichnung *</Label>
              <Input id="bezeichnung" value={form.bezeichnung} onChange={(e) => set("bezeichnung")(e.target.value)} placeholder="z. B. Wohnanlage Musterstraße" data-testid="input-bezeichnung" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="strasse">Straße</Label>
                <Input id="strasse" value={form.strasse} onChange={(e) => set("strasse")(e.target.value)} data-testid="input-strasse" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hausnummer">Nr.</Label>
                <Input id="hausnummer" value={form.hausnummer} onChange={(e) => set("hausnummer")(e.target.value)} data-testid="input-hausnummer" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="plz">PLZ</Label>
                <Input id="plz" value={form.plz} onChange={(e) => set("plz")(e.target.value)} data-testid="input-plz" />
              </div>
              <div className="col-span-2 space-y-2">
                <Label htmlFor="ort">Ort</Label>
                <Input id="ort" value={form.ort} onChange={(e) => set("ort")(e.target.value)} data-testid="input-ort" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="gebaeudetyp">Gebäudetyp</Label>
                <Select value={form.gebaeudetyp || NONE} onValueChange={(v) => set("gebaeudetyp")(v === NONE ? "" : v)}>
                  <SelectTrigger id="gebaeudetyp" data-testid="select-gebaeudetyp"><SelectValue placeholder="Auswählen" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— keine Angabe —</SelectItem>
                    {GEBAEUDETYPEN.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="heizung">Heizung</Label>
                <Select value={form.heizung || NONE} onValueChange={(v) => set("heizung")(v === NONE ? "" : v)}>
                  <SelectTrigger id="heizung" data-testid="select-heizung"><SelectValue placeholder="Auswählen" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— keine Angabe —</SelectItem>
                    {HEIZUNGSARTEN.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="baujahr">Baujahr</Label>
                <Input id="baujahr" type="number" value={form.baujahr} onChange={(e) => set("baujahr")(e.target.value)} data-testid="input-baujahr" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wohnflaeche">Wohnfläche m²</Label>
                <Input id="wohnflaeche" type="number" value={form.wohnflaeche} onChange={(e) => set("wohnflaeche")(e.target.value)} data-testid="input-wohnflaeche" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wohneinheiten">WE</Label>
                <Input id="wohneinheiten" type="number" value={form.wohneinheiten} onChange={(e) => set("wohneinheiten")(e.target.value)} data-testid="input-wohneinheiten" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notiz">Notiz</Label>
              <Textarea id="notiz" value={form.notiz} onChange={(e) => set("notiz")(e.target.value)} rows={3} data-testid="input-notiz" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Abbrechen</Button>
              <Button type="submit" disabled={saving} className="bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white" data-testid="button-save-objekt">
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Speichern
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Objekt löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              „{deleteTarget?.bezeichnung}“ wird dauerhaft entfernt. Verknüpfte Kunden bleiben erhalten, verlieren aber die Objektzuordnung.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-objekt">
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
