import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, Circle, AlertCircle, ArrowDownLeft, ArrowUpRight,
  FileText, Loader2, Plus, ClipboardCheck,
} from "lucide-react";
import {
  vorgangApi, VORGANG_STATUS, VORGANG_STATUS_LABEL, VORGANG_STATUS_BADGE,
  KANAL_LABEL, EBENE_LABEL,
  type VorgangStatus, type NachrichtKanal, type NachrichtRichtung,
} from "@/lib/vorgangApi";

function dt(s: string): string {
  return new Date(s).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

export function VorgangDetailDialog({
  vorgangId,
  open,
  onClose,
}: {
  vorgangId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const detailKey = ["fp-vorgang", vorgangId];
  const checklisteKey = ["fp-checkliste", vorgangId];

  const { data: detail, isLoading, isError, refetch } = useQuery({
    queryKey: detailKey,
    enabled: open && !!vorgangId,
    queryFn: async () => vorgangApi.detail(await getToken(), vorgangId!),
  });

  const { data: checkliste } = useQuery({
    queryKey: checklisteKey,
    enabled: open && !!vorgangId,
    queryFn: async () => vorgangApi.checkliste(await getToken(), vorgangId!),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: detailKey });
    qc.invalidateQueries({ queryKey: checklisteKey });
    qc.invalidateQueries({ queryKey: ["fp-vorgaenge"] });
  };

  const onErr = (e: unknown) =>
    toast({
      variant: "destructive",
      title: "Fehler",
      description: e instanceof Error ? e.message : "Aktion fehlgeschlagen",
    });

  const statusMut = useMutation({
    mutationFn: async (status: VorgangStatus) =>
      vorgangApi.setStatus(await getToken(), vorgangId!, status),
    onSuccess: () => {
      invalidate();
      toast({ title: "Status aktualisiert" });
    },
    onError: onErr,
  });

  const pruefMut = useMutation({
    mutationFn: async (dokId: string) => vorgangApi.pruefeDokument(await getToken(), dokId),
    onSuccess: () => {
      invalidate();
      toast({ title: "Dokument als geprüft markiert" });
    },
    onError: onErr,
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        {isLoading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : isError || !detail ? (
          <div className="py-10 text-center" data-testid="vorgang-detail-error">
            <p className="text-sm text-muted-foreground">Vorgang konnte nicht geladen werden.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
              Erneut versuchen
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold pr-8">{detail.titel}</DialogTitle>
              <div className="flex flex-wrap items-center gap-2 pt-1 text-sm text-muted-foreground">
                {detail.programm && <span>{detail.programm}</span>}
                {detail.organisation && <span>· {detail.organisation}</span>}
                {detail.faellig_am && (
                  <span>· fällig {new Date(detail.faellig_am).toLocaleDateString("de-DE")}</span>
                )}
              </div>
            </DialogHeader>

            {/* Status */}
            <section className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
              <span className="text-sm font-medium">Status</span>
              <Select
                value={detail.status}
                onValueChange={(v) => statusMut.mutate(v as VorgangStatus)}
              >
                <SelectTrigger className="w-[220px] h-9" data-testid="select-vorgang-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VORGANG_STATUS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {VORGANG_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {statusMut.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </section>

            {/* Checkliste */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <ClipboardCheck className="h-4 w-4 text-[var(--klard-teal-d)]" />
                  Pflichtunterlagen
                </h3>
                {checkliste && checkliste.unterlagen.length > 0 &&
                  (checkliste.ausweis_vollstaendig ? (
                    <Badge className="bg-emerald-100 text-emerald-900 border-0">Vollständig</Badge>
                  ) : (
                    <Badge className="bg-amber-100 text-amber-900 border-0">
                      {checkliste.offen} offen
                    </Badge>
                  ))}
              </div>
              {!checkliste || checkliste.unterlagen.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Keine Pflichtunterlagen hinterlegt. Verknüpfen Sie den Vorgang mit einem
                  Förderprogramm, damit die Checkliste greift.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {checkliste.unterlagen.map((u) => (
                    <ChecklisteRow
                      key={u.id}
                      item={u}
                      vorgangId={vorgangId!}
                      onAdded={invalidate}
                    />
                  ))}
                </ul>
              )}
            </section>

            {/* Dokumente */}
            <section className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4 text-[var(--klard-teal-d)]" />
                Dokumente ({detail.dokumente.length})
              </h3>
              {detail.dokumente.length === 0 ? (
                <p className="text-sm text-muted-foreground">Noch keine Dokumente erfasst.</p>
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {detail.dokumente.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-3 p-2.5"
                      data-testid={`row-dokument-${d.id}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{d.dateiname}</div>
                        <div className="text-xs text-muted-foreground">{EBENE_LABEL[d.ebene]}</div>
                      </div>
                      {d.geprueft ? (
                        <Badge className="bg-emerald-100 text-emerald-900 border-0 gap-1 shrink-0">
                          <CheckCircle2 className="h-3 w-3" /> Geprüft
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 shrink-0"
                          disabled={pruefMut.isPending}
                          onClick={() => pruefMut.mutate(d.id)}
                          data-testid={`button-pruefen-${d.id}`}
                        >
                          Als geprüft markieren
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <AddDokumentForm vorgangId={vorgangId!} onAdded={invalidate} />
            </section>

            {/* Nachrichten */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Nachrichten ({detail.nachrichten.length})</h3>
              {detail.nachrichten.length === 0 ? (
                <p className="text-sm text-muted-foreground">Noch keine Nachrichten.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.nachrichten.map((n, i) => (
                    <li
                      key={i}
                      className="rounded-xl border border-border p-3"
                      data-testid={`row-nachricht-${i}`}
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {n.richtung === "eingehend" ? (
                          <ArrowDownLeft className="h-3.5 w-3.5 text-sky-600" />
                        ) : (
                          <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600" />
                        )}
                        <Badge variant="outline" className="h-5 text-[10px]">
                          {KANAL_LABEL[n.kanal]}
                        </Badge>
                        {n.von && <span>{n.von}</span>}
                        <span className="ml-auto">{dt(n.erstellt_am)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm">{n.inhalt}</p>
                    </li>
                  ))}
                </ul>
              )}
              <AddNachrichtForm vorgangId={vorgangId!} onAdded={invalidate} />
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChecklisteRow({
  item,
  vorgangId,
  onAdded,
}: {
  item: { id: string; bezeichnung: string; pflicht: boolean; vorhanden: boolean; geprueft: boolean };
  vorgangId: string;
  onAdded: () => void;
}) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [dateiname, setDateiname] = useState("");

  const addMut = useMutation({
    mutationFn: async () =>
      vorgangApi.addDokument(await getToken(), vorgangId, {
        dateiname: dateiname.trim(),
        ebene: "pflichtunterlage",
        pflichtunterlage_id: item.id,
      }),
    onSuccess: () => {
      setEditing(false);
      setDateiname("");
      onAdded();
      toast({ title: "Dokument erfasst" });
    },
    onError: (e) =>
      toast({
        variant: "destructive",
        title: "Fehler",
        description: e instanceof Error ? e.message : "Aktion fehlgeschlagen",
      }),
  });

  return (
    <li className="rounded-lg border border-border p-2.5" data-testid={`row-checkliste-${item.id}`}>
      <div className="flex items-center gap-2">
        {item.geprueft ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        ) : item.vorhanden ? (
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
        ) : (
          <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="text-sm">{item.bezeichnung}</span>
        {item.pflicht && (
          <Badge variant="outline" className="h-5 text-[10px]">
            Pflicht
          </Badge>
        )}
        {!item.vorhanden && !editing && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 text-xs"
            onClick={() => setEditing(true)}
            data-testid={`button-erfassen-${item.id}`}
          >
            <Plus className="mr-1 h-3 w-3" /> Dokument erfassen
          </Button>
        )}
        {item.vorhanden && !item.geprueft && (
          <span className="ml-auto text-xs text-amber-600">vorhanden, ungeprüft</span>
        )}
      </div>
      {editing && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (dateiname.trim()) addMut.mutate();
          }}
        >
          <Input
            autoFocus
            value={dateiname}
            onChange={(e) => setDateiname(e.target.value)}
            placeholder="Dateiname, z. B. Energieausweis.pdf"
            className="h-8"
            data-testid={`input-dateiname-${item.id}`}
          />
          <Button type="submit" size="sm" className="h-8" disabled={addMut.isPending || !dateiname.trim()}>
            Speichern
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)}>
            Abbrechen
          </Button>
        </form>
      )}
    </li>
  );
}

function AddDokumentForm({ vorgangId, onAdded }: { vorgangId: string; onAdded: () => void }) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [dateiname, setDateiname] = useState("");

  const addMut = useMutation({
    mutationFn: async () =>
      vorgangApi.addDokument(await getToken(), vorgangId, {
        dateiname: dateiname.trim(),
        ebene: "vorgang",
      }),
    onSuccess: () => {
      setDateiname("");
      onAdded();
      toast({ title: "Dokument hinzugefügt" });
    },
    onError: (e) =>
      toast({
        variant: "destructive",
        title: "Fehler",
        description: e instanceof Error ? e.message : "Aktion fehlgeschlagen",
      }),
  });

  return (
    <form
      className="flex flex-wrap items-center gap-2 pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (dateiname.trim()) addMut.mutate();
      }}
    >
      <Input
        value={dateiname}
        onChange={(e) => setDateiname(e.target.value)}
        placeholder="Dokument zum Vorgang hinzufügen…"
        className="h-9 flex-1 min-w-[180px]"
        data-testid="input-add-dokument"
      />
      <Button type="submit" size="sm" className="h-9" disabled={addMut.isPending || !dateiname.trim()}>
        <Plus className="mr-1 h-4 w-4" /> Hinzufügen
      </Button>
    </form>
  );
}

function AddNachrichtForm({ vorgangId, onAdded }: { vorgangId: string; onAdded: () => void }) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [kanal, setKanal] = useState<NachrichtKanal>("email");
  const [richtung, setRichtung] = useState<NachrichtRichtung>("eingehend");
  const [von, setVon] = useState("");
  const [inhalt, setInhalt] = useState("");

  const addMut = useMutation({
    mutationFn: async () =>
      vorgangApi.addNachricht(await getToken(), vorgangId, {
        kanal,
        richtung,
        von: von.trim() || undefined,
        inhalt: inhalt.trim(),
      }),
    onSuccess: () => {
      setInhalt("");
      setVon("");
      onAdded();
      toast({ title: "Nachricht erfasst" });
    },
    onError: (e) =>
      toast({
        variant: "destructive",
        title: "Fehler",
        description: e instanceof Error ? e.message : "Aktion fehlgeschlagen",
      }),
  });

  return (
    <form
      className="space-y-2 rounded-xl border border-border bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (inhalt.trim()) addMut.mutate();
      }}
    >
      <div className="flex flex-wrap gap-2">
        <Select value={kanal} onValueChange={(v) => setKanal(v as NachrichtKanal)}>
          <SelectTrigger className="h-9 w-[140px]" data-testid="select-nachricht-kanal">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(KANAL_LABEL) as NachrichtKanal[]).map((k) => (
              <SelectItem key={k} value={k}>
                {KANAL_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={richtung} onValueChange={(v) => setRichtung(v as NachrichtRichtung)}>
          <SelectTrigger className="h-9 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="eingehend">Eingehend</SelectItem>
            <SelectItem value="ausgehend">Ausgehend</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={von}
          onChange={(e) => setVon(e.target.value)}
          placeholder="Von (optional)"
          className="h-9 flex-1 min-w-[140px]"
        />
      </div>
      <Textarea
        value={inhalt}
        onChange={(e) => setInhalt(e.target.value)}
        placeholder="Nachricht…"
        rows={2}
        data-testid="textarea-nachricht"
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={addMut.isPending || !inhalt.trim()}>
          Nachricht erfassen
        </Button>
      </div>
    </form>
  );
}
