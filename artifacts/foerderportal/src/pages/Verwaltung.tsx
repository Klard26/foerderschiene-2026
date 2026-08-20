import { useState } from "react";
import { useAuth, useUser } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Shield, FolderKanban, Building2, Plus, Loader2, MessageSquare, Landmark, HandCoins, Sparkles, RefreshCw, RotateCw, ReceiptText } from "lucide-react";
import {
  vorgangApi, VORGANG_STATUS, VORGANG_STATUS_LABEL, VORGANG_STATUS_BADGE, useIsAdmin,
  useEmailDeliveryHealth,
  type VorgangStatus,
} from "@/lib/vorgangApi";
import { EmailHealthStatus } from "@/components/EmailHealthStatus";
import { fetchProgramme, type Programm } from "@/lib/foerderpilotApi";
import { VorgangDetailDialog } from "@/components/vorgang/VorgangDetailDialog";
import { ExposePanel } from "@/components/vorgang/ExposePanel";
import { FinanzpartnerPanel } from "@/components/finance/FinanzpartnerPanel";
import { FoerderLeadsPanel } from "@/components/finance/FoerderLeadsPanel";
import { FoerderFinderLeadsPanel } from "@/components/FoerderFinderLeadsPanel";
import { FoerderUpdatePanel } from "@/components/FoerderUpdatePanel";
import type { AdminRefundedOrder } from "@workspace/api-client-react";

function dt(s: string): string {
  return new Date(s).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

export default function Verwaltung() {
  const { isLoaded } = useUser();
  const { data: me, isLoading: meLoading } = useIsAdmin();

  if (!isLoaded || meLoading) {
    return (
      <Shell>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      </Shell>
    );
  }

  if (!me?.isAdmin) {
    return (
      <Shell>
        <Card className="rounded-[20px] border-[1.5px] max-w-xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Shield className="h-5 w-5 text-muted-foreground" /> Zugriff verweigert
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground" data-testid="text-verwaltung-forbidden">
            Diese Seite ist nur für Plattform-Administratoren zugänglich.
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return <VerwaltungContent />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <Navbar />
      <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-8 sm:px-8">{children}</main>
      <Footer />
    </div>
  );
}

function VerwaltungContent() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const emailHealth = useEmailDeliveryHealth();

  const openDetail = (id: string) => {
    setSelectedId(id);
    setDetailOpen(true);
  };

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-verwaltung-title">
            Förderpilot-Verwaltung
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vorgänge, Unterlagen-Checklisten, Kommunikation und Exposés für die Wohnungswirtschaft.
          </p>
        </div>
        <Badge variant="outline" className="gap-1 rounded-full border-[1.5px]">
          <Shield className="h-3 w-3" /> Admin
        </Badge>
      </div>

      <EmailHealthStatus health={emailHealth} />

      <Tabs defaultValue="vorgaenge">
        <TabsList>
          <TabsTrigger value="vorgaenge" data-testid="tab-vorgaenge">
            <FolderKanban className="mr-1.5 h-4 w-4" /> Vorgänge
          </TabsTrigger>
          <TabsTrigger value="expose" data-testid="tab-expose">
            <Building2 className="mr-1.5 h-4 w-4" /> Exposés
          </TabsTrigger>
          <TabsTrigger value="finanzpartner" data-testid="tab-finanzpartner">
            <Landmark className="mr-1.5 h-4 w-4" /> Finanzpartner
          </TabsTrigger>
          <TabsTrigger value="foerder-leads" data-testid="tab-foerder-leads">
            <HandCoins className="mr-1.5 h-4 w-4" /> Förder-Leads
          </TabsTrigger>
          <TabsTrigger value="finder-anfragen" data-testid="tab-finder-anfragen">
            <Sparkles className="mr-1.5 h-4 w-4" /> Finder-Anfragen
          </TabsTrigger>
          <TabsTrigger value="katalog-updates" data-testid="tab-katalog-updates">
            <RefreshCw className="mr-1.5 h-4 w-4" /> Katalog-Updates
          </TabsTrigger>
          <TabsTrigger value="rueckerstattungen" data-testid="tab-rueckerstattungen">
            <ReceiptText className="mr-1.5 h-4 w-4" /> Rückerstattungen
          </TabsTrigger>
        </TabsList>

        <TabsContent value="vorgaenge" className="mt-4">
          <VorgaengePanel onOpen={openDetail} />
        </TabsContent>

        <TabsContent value="expose" className="mt-4">
          <ExposePanel />
        </TabsContent>

        <TabsContent value="finanzpartner" className="mt-4">
          <FinanzpartnerPanel />
        </TabsContent>

        <TabsContent value="finder-anfragen" className="mt-4">
          <FoerderFinderLeadsPanel />
        </TabsContent>

        <TabsContent value="katalog-updates" className="mt-4">
          <FoerderUpdatePanel />
        </TabsContent>

        <TabsContent value="foerder-leads" className="mt-4">
          <FoerderLeadsPanel />
        </TabsContent>

        <TabsContent value="rueckerstattungen" className="mt-4">
          <RefundedOrdersPanel />
        </TabsContent>
      </Tabs>

      <VorgangDetailDialog
        vorgangId={selectedId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      />
    </Shell>
  );
}

export function RefundedOrdersPanel() {
  const { getToken } = useAuth();
  const refunds = useQuery({
    queryKey: ["fp-admin-refunded-orders"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/admin/refunded-orders", {
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) throw new Error("Rückerstattungen konnten nicht geladen werden.");
      return (await res.json()) as AdminRefundedOrder[];
    },
  });

  return (
    <Card className="rounded-[20px] border-[1.5px]" data-testid="refunded-orders-panel">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-lg">Rückerstattete Bestellungen</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Diese Käufe wurden von Stripe erstattet und sind nicht mehr als erfüllt markiert.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refunds.refetch()} disabled={refunds.isFetching}>
          <RotateCw className={`mr-1.5 h-3.5 w-3.5 ${refunds.isFetching ? "animate-spin" : ""}`} />
          Aktualisieren
        </Button>
      </CardHeader>
      <CardContent>
        {refunds.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-11 w-full" />)}
          </div>
        ) : refunds.isError ? (
          <p className="text-sm text-destructive">Die Rückerstattungen konnten nicht geladen werden.</p>
        ) : refunds.data?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Produkt</th>
                  <th className="pb-2 pr-3 font-medium">Kunde</th>
                  <th className="pb-2 pr-3 font-medium">Betrag</th>
                  <th className="pb-2 pr-3 font-medium">Guthaben gekauft</th>
                  <th className="pb-2 pr-3 font-medium">Guthaben zurückgeholt</th>
                  <th className="pb-2 pr-3 font-medium">Reports genutzt</th>
                  <th className="pb-2 pr-3 font-medium">Erstattet am</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {refunds.data.map((order) => (
                  <tr key={`${order.product}-${order.id}`} className="border-b last:border-0">
                    <td className="py-3 pr-3 font-medium">{order.product}</td>
                    <td className="py-3 pr-3 text-muted-foreground">{order.buyerEmail ?? "E-Mail nicht verfügbar"}</td>
                    <td className="py-3 pr-3">{(order.amountCents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</td>
                    <td className="py-3 pr-3" data-testid={`refunded-credits-${order.id}`}>
                      {order.product === "Gebäudecheck-Guthaben" ? order.credits : "—"}
                    </td>
                    <td className="py-3 pr-3" data-testid={`refunded-credits-reclaimed-${order.id}`}>
                      {order.product === "Gebäudecheck-Guthaben" ? order.creditsDeducted : "—"}
                    </td>
                    <td className="py-3 pr-3" data-testid={`refunded-credits-used-${order.id}`}>
                      {order.product === "Gebäudecheck-Guthaben" ? order.creditsAlreadyUsed : "—"}
                    </td>
                    <td className="py-3 pr-3 text-muted-foreground">{dt(order.refundedAt ?? order.createdAt)}</td>
                    <td className="py-3"><Badge variant="destructive">Refunded</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground" data-testid="refunded-orders-empty">
            Noch keine erstatteten Bestellungen.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function VorgaengePanel({ onOpen }: { onOpen: (id: string) => void }) {
  const { getToken } = useAuth();
  const [statusFilter, setStatusFilter] = useState<VorgangStatus | undefined>(undefined);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["fp-vorgaenge", statusFilter ?? "all"],
    queryFn: async () => vorgangApi.list(await getToken(), statusFilter),
  });

  const vorgaenge = data?.vorgaenge ?? [];

  return (
    <Card className="rounded-[20px] border-[1.5px]">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg font-semibold">
            Vorgänge{data ? ` (${data.anzahl})` : ""}
          </CardTitle>
          <NewVorgangDialog />
        </div>
        <div className="flex flex-wrap gap-1.5 pt-2">
          {([undefined, ...VORGANG_STATUS] as (VorgangStatus | undefined)[]).map((s) => (
            <button
              key={s ?? "all"}
              onClick={() => setStatusFilter(s)}
              className={`h-7 rounded-full border-[1.5px] px-3 text-xs font-medium transition-colors ${
                statusFilter === s
                  ? "border-[var(--klard-teal)] bg-[var(--klard-teal)] text-white"
                  : "border-border bg-white text-muted-foreground hover:border-[var(--klard-teal)]"
              }`}
              data-testid={`button-filter-${s ?? "all"}`}
            >
              {s ? VORGANG_STATUS_LABEL[s] : "Alle"}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <div className="py-10 text-center" data-testid="vorgaenge-error">
            <p className="text-sm text-muted-foreground">Vorgänge konnten nicht geladen werden.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
              Erneut versuchen
            </Button>
          </div>
        ) : vorgaenge.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground" data-testid="vorgaenge-empty">
            Keine Vorgänge{statusFilter ? " mit diesem Status" : ""}. Legen Sie oben einen neuen
            Vorgang an.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Titel</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Programm</th>
                  <th className="py-2 pr-3 text-right">Pflicht</th>
                  <th className="py-2 pr-3 text-right">Nachrichten</th>
                  <th className="py-2 pr-3">Fällig</th>
                  <th className="py-2 pr-3">Aktualisiert</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {vorgaenge.map((v) => (
                  <tr
                    key={v.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => onOpen(v.id)}
                    data-testid={`row-vorgang-${v.id}`}
                  >
                    <td className="py-2.5 pr-3">
                      <div className="font-medium">{v.titel}</div>
                      {v.organisation && (
                        <div className="text-xs text-muted-foreground">{v.organisation}</div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${VORGANG_STATUS_BADGE[v.status]}`}
                      >
                        {VORGANG_STATUS_LABEL[v.status]}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{v.programm ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-right">
                      <span
                        className={
                          v.pflicht_soll > 0 && v.pflicht_ist >= v.pflicht_soll
                            ? "font-medium text-emerald-700"
                            : "text-muted-foreground"
                        }
                      >
                        {v.pflicht_ist}/{v.pflicht_soll}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <MessageSquare className="h-3.5 w-3.5" /> {v.nachrichten}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-muted-foreground">
                      {v.faellig_am ? new Date(v.faellig_am).toLocaleDateString("de-DE") : "—"}
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-muted-foreground">
                      {dt(v.aktualisiert_am)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NewVorgangDialog() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [titel, setTitel] = useState("");
  const [programmId, setProgrammId] = useState<string>("none");
  const [faellig, setFaellig] = useState("");

  const { data: programmData } = useQuery({
    queryKey: ["fp-programme-options"],
    enabled: open,
    queryFn: () => fetchProgramme({ limit: 200, offset: 0 }),
  });
  const programme: Programm[] = programmData?.programme ?? [];

  const reset = () => {
    setTitel("");
    setProgrammId("none");
    setFaellig("");
  };

  const mut = useMutation({
    mutationFn: async () =>
      vorgangApi.create(await getToken(), {
        titel: titel.trim(),
        programm_id: programmId !== "none" ? programmId : undefined,
        faellig_am: faellig || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fp-vorgaenge"] });
      toast({ title: "Vorgang angelegt" });
      reset();
      setOpen(false);
    },
    onError: (e) =>
      toast({
        variant: "destructive",
        title: "Fehler",
        description: e instanceof Error ? e.message : "Aktion fehlgeschlagen",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className="h-9 bg-[var(--klard-teal)] text-white hover:bg-[var(--klard-teal-d)]"
          data-testid="button-neuer-vorgang"
        >
          <Plus className="mr-1 h-4 w-4" /> Neuer Vorgang
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Neuer Vorgang</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (titel.trim()) mut.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="vorgang-titel">Titel *</Label>
            <Input
              id="vorgang-titel"
              autoFocus
              value={titel}
              onChange={(e) => setTitel(e.target.value)}
              placeholder="z. B. Sanierung Musterstraße 1"
              data-testid="input-vorgang-titel"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vorgang-programm">Förderprogramm (optional)</Label>
            <Select value={programmId} onValueChange={setProgrammId}>
              <SelectTrigger id="vorgang-programm" data-testid="select-vorgang-programm">
                <SelectValue placeholder="Kein Programm" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="none">Kein Programm</SelectItem>
                {programme.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.titel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Mit Programm greift die Pflichtunterlagen-Checkliste.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vorgang-faellig">Fällig am (optional)</Label>
            <Input
              id="vorgang-faellig"
              type="date"
              value={faellig}
              onChange={(e) => setFaellig(e.target.value)}
              data-testid="input-vorgang-faellig"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={mut.isPending || !titel.trim()}>
              {mut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Anlegen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
