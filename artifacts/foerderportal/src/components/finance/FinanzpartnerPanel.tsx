import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Loader2, Pencil } from "lucide-react";
import {
  financeApi, type FinancePartner, type FinancePartnerInput,
} from "@/lib/financeAffiliateApi";

function eur(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

function joinList(xs: string[]): string {
  return xs.length ? xs.join(", ") : "—";
}

export function FinanzpartnerPanel() {
  const { getToken } = useAuth();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["finance-partners"],
    queryFn: async () => financeApi.listPartners(await getToken()),
  });

  const partners = data ?? [];

  return (
    <Card className="rounded-[20px] border-[1.5px]">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg font-semibold">
            Finanzpartner{data ? ` (${partners.length})` : ""}
          </CardTitle>
          <PartnerDialog mode="create" />
        </div>
        <p className="pt-1 text-sm text-muted-foreground">
          Banken und Kreditinstitute, die für funding-relevante Reports
          passende Finanzierungs-Leads erhalten. Pro Lead wird eine feste Gebühr
          als Umsatz erfasst.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <div className="py-10 text-center" data-testid="partners-error">
            <p className="text-sm text-muted-foreground">
              Finanzpartner konnten nicht geladen werden.
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
              Erneut versuchen
            </Button>
          </div>
        ) : partners.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Noch keine Finanzpartner. Legen Sie oben den ersten Partner an.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Kontakt</th>
                  <th className="py-2 pr-3">Regionen / PLZ</th>
                  <th className="py-2 pr-3 text-right">Invest-Fenster</th>
                  <th className="py-2 pr-3 text-right">Gebühr/Lead</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {partners.map((p) => (
                  <tr key={p.id} data-testid={`row-partner-${p.id}`}>
                    <td className="py-2.5 pr-3">
                      <div className="font-medium">{p.name}</div>
                      {p.productTypes.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          {joinList(p.productTypes)}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      <div>{p.contactEmail}</div>
                      {p.contactName && (
                        <div className="text-xs">{p.contactName}</div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      <div>{joinList(p.regions)}</div>
                      {p.postalPrefixes.length > 0 && (
                        <div className="text-xs">PLZ {joinList(p.postalPrefixes)}</div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right whitespace-nowrap text-muted-foreground">
                      {eur(p.minInvestmentCents)} – {eur(p.maxInvestmentCents)}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-medium whitespace-nowrap">
                      {eur(p.feePerLeadCents)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          p.active
                            ? "bg-emerald-100 text-emerald-900"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {p.active ? "Aktiv" : "Inaktiv"}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <PartnerDialog mode="edit" partner={p} />
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

function toEuroInput(cents: number | null): string {
  return cents == null ? "" : String(Math.round(cents / 100));
}

function parseEuroToCents(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function parseCsv(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function PartnerDialog({
  mode,
  partner,
}: {
  mode: "create" | "edit";
  partner?: FinancePartner;
}) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(partner?.name ?? "");
  const [contactEmail, setContactEmail] = useState(partner?.contactEmail ?? "");
  const [contactName, setContactName] = useState(partner?.contactName ?? "");
  const [productTypes, setProductTypes] = useState(
    partner?.productTypes.join(", ") ?? "",
  );
  const [regions, setRegions] = useState(partner?.regions.join(", ") ?? "");
  const [postalPrefixes, setPostalPrefixes] = useState(
    partner?.postalPrefixes.join(", ") ?? "",
  );
  const [minEur, setMinEur] = useState(toEuroInput(partner?.minInvestmentCents ?? null));
  const [maxEur, setMaxEur] = useState(toEuroInput(partner?.maxInvestmentCents ?? null));
  const [feeEur, setFeeEur] = useState(
    partner ? String(Math.round(partner.feePerLeadCents / 100)) : "",
  );
  const [active, setActive] = useState(partner?.active ?? true);
  const [notes, setNotes] = useState(partner?.notes ?? "");

  const reset = () => {
    if (mode === "create") {
      setName("");
      setContactEmail("");
      setContactName("");
      setProductTypes("");
      setRegions("");
      setPostalPrefixes("");
      setMinEur("");
      setMaxEur("");
      setFeeEur("");
      setActive(true);
      setNotes("");
    }
  };

  const mut = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const body: FinancePartnerInput = {
        name: name.trim(),
        contactEmail: contactEmail.trim(),
        contactName: contactName.trim() || null,
        productTypes: parseCsv(productTypes),
        regions: parseCsv(regions),
        postalPrefixes: parseCsv(postalPrefixes),
        minInvestmentCents: parseEuroToCents(minEur),
        maxInvestmentCents: parseEuroToCents(maxEur),
        feePerLeadCents: parseEuroToCents(feeEur) ?? 0,
        active,
        notes: notes.trim() || null,
      };
      return mode === "create"
        ? financeApi.createPartner(token, body)
        : financeApi.updatePartner(token, partner!.id, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-partners"] });
      toast({ title: mode === "create" ? "Partner angelegt" : "Partner gespeichert" });
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

  const canSubmit = name.trim().length > 0 && contactEmail.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button
            size="sm"
            className="h-9 bg-[var(--klard-teal)] text-white hover:bg-[var(--klard-teal-d)]"
            data-testid="button-neuer-partner"
          >
            <Plus className="mr-1 h-4 w-4" /> Neuer Partner
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            data-testid={`button-edit-partner-${partner!.id}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Neuer Finanzpartner" : "Finanzpartner bearbeiten"}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) mut.mutate();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="partner-name">Name *</Label>
              <Input
                id="partner-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Modernisierungsbank AG"
                data-testid="input-partner-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-email">Kontakt-E-Mail *</Label>
              <Input
                id="partner-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="leads@bank.de"
                data-testid="input-partner-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-contact">Ansprechpartner</Label>
              <Input
                id="partner-contact"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="optional"
                data-testid="input-partner-contact"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="partner-products">Produkttypen (kommagetrennt)</Label>
              <Input
                id="partner-products"
                value={productTypes}
                onChange={(e) => setProductTypes(e.target.value)}
                placeholder="modernisierungskredit, sanierungskredit"
                data-testid="input-partner-products"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-regions">Regionen (kommagetrennt)</Label>
              <Input
                id="partner-regions"
                value={regions}
                onChange={(e) => setRegions(e.target.value)}
                placeholder="bundesweit"
                data-testid="input-partner-regions"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-plz">PLZ-Präfixe (kommagetrennt)</Label>
              <Input
                id="partner-plz"
                value={postalPrefixes}
                onChange={(e) => setPostalPrefixes(e.target.value)}
                placeholder="80, 81"
                data-testid="input-partner-plz"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-min">Invest. min (€)</Label>
              <Input
                id="partner-min"
                inputMode="numeric"
                value={minEur}
                onChange={(e) => setMinEur(e.target.value)}
                placeholder="leer = unbegrenzt"
                data-testid="input-partner-min"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-max">Invest. max (€)</Label>
              <Input
                id="partner-max"
                inputMode="numeric"
                value={maxEur}
                onChange={(e) => setMaxEur(e.target.value)}
                placeholder="leer = unbegrenzt"
                data-testid="input-partner-max"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-fee">Gebühr pro Lead (€) *</Label>
              <Input
                id="partner-fee"
                inputMode="numeric"
                value={feeEur}
                onChange={(e) => setFeeEur(e.target.value)}
                placeholder="z. B. 45"
                data-testid="input-partner-fee"
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm" htmlFor="partner-active">
                <input
                  id="partner-active"
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="h-4 w-4 accent-[var(--klard-teal)]"
                  data-testid="checkbox-partner-active"
                />
                Aktiv (erhält Leads)
              </label>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="partner-notes">Notizen</Label>
              <Input
                id="partner-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="optional"
                data-testid="input-partner-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={mut.isPending || !canSubmit}>
              {mut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {mode === "create" ? "Anlegen" : "Speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
