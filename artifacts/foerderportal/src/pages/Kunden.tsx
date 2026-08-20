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
import { Loader2, Plus, Pencil, Trash2, Users, Building2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListVerwalteteKunden,
  useCreateVerwalteterKunde,
  useUpdateVerwalteterKunde,
  useDeleteVerwalteterKunde,
  useListImmobilienPortfolioObjekte,
  getListVerwalteteKundenQueryKey,
  type VerwalteterKunde,
  type VerwalteterKundeInput,
} from "@workspace/api-client-react";
import { KUNDEN_TYPEN } from "@/lib/kontoTypen";

const NONE = "__none__";

type FormState = {
  name: string;
  typ: string;
  ansprechpartner: string;
  telefon: string;
  email: string;
  portfolioObjektId: string;
  notiz: string;
};

const EMPTY: FormState = {
  name: "", typ: "", ansprechpartner: "", telefon: "", email: "", portfolioObjektId: "", notiz: "",
};

export default function Kunden() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: kunden, isLoading } = useListVerwalteteKunden();
  const { data: objekte } = useListImmobilienPortfolioObjekte();
  const createM = useCreateVerwalteterKunde();
  const updateM = useUpdateVerwalteterKunde();
  const deleteM = useDeleteVerwalteterKunde();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<VerwalteterKunde | null>(null);

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const saving = createM.isPending || updateM.isPending;
  const objektList = objekte ?? [];
  const objektName = (id: number | null | undefined) =>
    id == null ? null : objektList.find((o) => o.id === id)?.bezeichnung ?? null;

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListVerwalteteKundenQueryKey() });

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY);
    setDialogOpen(true);
  };

  const openEdit = (k: VerwalteterKunde) => {
    setEditingId(k.id);
    setForm({
      name: k.name ?? "",
      typ: k.typ ?? "",
      ansprechpartner: k.ansprechpartner ?? "",
      telefon: k.telefon ?? "",
      email: k.email ?? "",
      portfolioObjektId: k.portfolioObjektId != null ? String(k.portfolioObjektId) : "",
      notiz: k.notiz ?? "",
    });
    setDialogOpen(true);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "Name fehlt", description: "Bitte geben Sie einen Namen an.", variant: "destructive" });
      return;
    }
    const input: VerwalteterKundeInput = {
      name: form.name.trim(),
      typ: form.typ.trim() || null,
      ansprechpartner: form.ansprechpartner.trim() || null,
      telefon: form.telefon.trim() || null,
      email: form.email.trim() || null,
      portfolioObjektId: form.portfolioObjektId ? Number(form.portfolioObjektId) : null,
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
      toast({ title: "Gespeichert", description: "Der Kunde wurde gespeichert." });
    } catch {
      toast({ title: "Fehler", description: "Speichern fehlgeschlagen.", variant: "destructive" });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteM.mutateAsync({ id: deleteTarget.id });
      await invalidate();
      toast({ title: "Gelöscht", description: "Der Kunde wurde entfernt." });
    } catch {
      toast({ title: "Fehler", description: "Löschen fehlgeschlagen.", variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  };

  const list = kunden ?? [];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 w-full max-w-[1100px] mx-auto px-4 sm:px-8 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Verwaltete Kunden</h1>
            <p className="text-muted-foreground mt-1">Erfassen Sie die von Ihnen betreuten Kunden.</p>
          </div>
          <Button onClick={openCreate} className="bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white" data-testid="button-add-kunde">
            <Plus className="h-4 w-4 mr-2" /> Kunde hinzufügen
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-12">
            <Loader2 className="h-4 w-4 animate-spin" /> Lädt …
          </div>
        ) : list.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center text-center gap-3 py-14">
              <Users className="h-10 w-10 text-muted-foreground" />
              <div className="font-semibold text-foreground">Noch keine Kunden</div>
              <p className="text-sm text-muted-foreground max-w-sm">
                Legen Sie Ihren ersten betreuten Kunden an und ordnen Sie ihn optional einem Objekt zu.
              </p>
              <Button onClick={openCreate} variant="outline" data-testid="button-add-kunde-empty">
                <Plus className="h-4 w-4 mr-2" /> Kunde hinzufügen
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {list.map((k) => {
              const obj = objektName(k.portfolioObjektId);
              return (
                <Card key={k.id} data-testid={`card-kunde-${k.id}`}>
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-foreground">{k.name}</div>
                        {k.typ && <div className="text-sm text-muted-foreground">{k.typ}</div>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(k)} aria-label="Bearbeiten" data-testid={`button-edit-kunde-${k.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(k)} aria-label="Löschen" data-testid={`button-delete-kunde-${k.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      {k.ansprechpartner && <div>{k.ansprechpartner}</div>}
                      {k.telefon && <div>{k.telefon}</div>}
                      {k.email && <div>{k.email}</div>}
                    </div>
                    {obj && (
                      <div className="inline-flex items-center gap-1.5 text-sm text-[var(--klard-teal-d)]">
                        <Building2 className="h-4 w-4" /> {obj}
                      </div>
                    )}
                    {k.notiz && <p className="text-sm text-foreground/80">{k.notiz}</p>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
      <Footer />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId != null ? "Kunde bearbeiten" : "Kunde hinzufügen"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="z. B. Familie Mustermann" data-testid="input-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="typ">Kundentyp</Label>
                <Select value={form.typ || NONE} onValueChange={(v) => set("typ")(v === NONE ? "" : v)}>
                  <SelectTrigger id="typ" data-testid="select-kundentyp"><SelectValue placeholder="Auswählen" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— keine Angabe —</SelectItem>
                    {KUNDEN_TYPEN.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="objekt">Zugeordnetes Objekt</Label>
                <Select value={form.portfolioObjektId || NONE} onValueChange={(v) => set("portfolioObjektId")(v === NONE ? "" : v)}>
                  <SelectTrigger id="objekt" data-testid="select-objekt"><SelectValue placeholder="Kein Objekt" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Kein Objekt</SelectItem>
                    {objektList.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.bezeichnung}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ansprechpartner">Ansprechpartner</Label>
                <Input id="ansprechpartner" value={form.ansprechpartner} onChange={(e) => set("ansprechpartner")(e.target.value)} data-testid="input-kunde-ansprechpartner" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="telefon">Telefon</Label>
                <Input id="telefon" value={form.telefon} onChange={(e) => set("telefon")(e.target.value)} data-testid="input-kunde-telefon" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} data-testid="input-kunde-email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notiz">Notiz</Label>
              <Textarea id="notiz" value={form.notiz} onChange={(e) => set("notiz")(e.target.value)} rows={3} data-testid="input-kunde-notiz" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Abbrechen</Button>
              <Button type="submit" disabled={saving} className="bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white" data-testid="button-save-kunde">
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Speichern
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kunde löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              „{deleteTarget?.name}“ wird dauerhaft entfernt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-kunde">
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
