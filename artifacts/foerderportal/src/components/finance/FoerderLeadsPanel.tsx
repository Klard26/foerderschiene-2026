import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import {
  financeApi,
  FINANCE_LEAD_STATUS,
  FINANCE_LEAD_STATUS_LABEL,
  FINANCE_LEAD_STATUS_BADGE,
  type FinanceLead,
  type FinanceLeadStatus,
} from "@/lib/financeAffiliateApi";

function eur(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

function dt(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

export function FoerderLeadsPanel() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<FinanceLeadStatus | undefined>(undefined);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["finance-leads", statusFilter ?? "all"],
    queryFn: async () => financeApi.listLeads(await getToken(), { status: statusFilter }),
  });

  const leads = data ?? [];
  const revenue = leads
    .filter((l) => l.status === "converted")
    .reduce((sum, l) => sum + l.feeCents, 0);

  const convert = useMutation({
    mutationFn: async (id: number) => financeApi.convertLead(await getToken(), id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-leads"] });
      toast({ title: "Lead als abgeschlossen markiert" });
    },
    onError: (e) =>
      toast({
        variant: "destructive",
        title: "Fehler",
        description: e instanceof Error ? e.message : "Aktion fehlgeschlagen",
      }),
  });

  const reject = useMutation({
    mutationFn: async (id: number) => financeApi.rejectLead(await getToken(), id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-leads"] });
      toast({ title: "Lead abgelehnt" });
    },
    onError: (e) =>
      toast({
        variant: "destructive",
        title: "Fehler",
        description: e instanceof Error ? e.message : "Aktion fehlgeschlagen",
      }),
  });

  return (
    <Card className="rounded-[20px] border-[1.5px]">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg font-semibold">
            Förder-Leads{data ? ` (${leads.length})` : ""}
          </CardTitle>
          <div className="text-sm text-muted-foreground">
            Umsatz (abgeschlossen):{" "}
            <span className="font-semibold text-foreground" data-testid="text-lead-revenue">
              {eur(revenue)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-2">
          {([undefined, ...FINANCE_LEAD_STATUS] as (FinanceLeadStatus | undefined)[]).map((s) => (
            <button
              key={s ?? "all"}
              onClick={() => setStatusFilter(s)}
              className={`h-7 rounded-full border-[1.5px] px-3 text-xs font-medium transition-colors ${
                statusFilter === s
                  ? "border-[var(--klard-teal)] bg-[var(--klard-teal)] text-white"
                  : "border-border bg-white text-muted-foreground hover:border-[var(--klard-teal)]"
              }`}
              data-testid={`button-lead-filter-${s ?? "all"}`}
            >
              {s ? FINANCE_LEAD_STATUS_LABEL[s] : "Alle"}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <div className="py-10 text-center" data-testid="leads-error">
            <p className="text-sm text-muted-foreground">Leads konnten nicht geladen werden.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
              Erneut versuchen
            </Button>
          </div>
        ) : leads.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Keine Leads{statusFilter ? " mit diesem Status" : ""}. Leads entstehen automatisch,
            wenn ein funding-relevanter Report bezahlt wird und der Käufer der Weitergabe
            zugestimmt hat.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Käufer</th>
                  <th className="py-2 pr-3">Partner</th>
                  <th className="py-2 pr-3">Objekt</th>
                  <th className="py-2 pr-3 text-right">Investition</th>
                  <th className="py-2 pr-3 text-right">Gebühr</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Erstellt</th>
                  <th className="py-2 pr-3 text-right">Aktion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((l: FinanceLead) => (
                  <tr key={l.id} data-testid={`row-lead-${l.id}`}>
                    <td className="py-2.5 pr-3">
                      <div className="font-medium">{l.buyerEmail ?? "—"}</div>
                      {l.consentAt && (
                        <div className="text-xs text-muted-foreground">
                          Einwilligung {dt(l.consentAt)}
                          {l.consentVersion ? ` (v${l.consentVersion})` : ""}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      {l.partnerName ?? `#${l.partnerId}`}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      <div>{l.adresse ?? "—"}</div>
                      {l.postalCode && <div className="text-xs">{l.postalCode}</div>}
                    </td>
                    <td className="py-2.5 pr-3 text-right whitespace-nowrap text-muted-foreground">
                      {eur(l.estimatedInvestmentCents)}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-medium whitespace-nowrap">
                      {eur(l.feeCents)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${FINANCE_LEAD_STATUS_BADGE[l.status]}`}
                      >
                        {FINANCE_LEAD_STATUS_LABEL[l.status]}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-muted-foreground">
                      {dt(l.createdAt)}
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      {l.status === "converted" ||
                      l.status === "rejected" ||
                      l.status === "sending" ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 border-emerald-200 text-emerald-800 hover:bg-emerald-50"
                            disabled={convert.isPending || reject.isPending}
                            onClick={() => convert.mutate(l.id)}
                            data-testid={`button-convert-lead-${l.id}`}
                          >
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Abgeschlossen
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 border-rose-200 text-rose-800 hover:bg-rose-50"
                            disabled={convert.isPending || reject.isPending}
                            onClick={() => reject.mutate(l.id)}
                            data-testid={`button-reject-lead-${l.id}`}
                          >
                            <XCircle className="mr-1 h-3.5 w-3.5" /> Ablehnen
                          </Button>
                        </div>
                      )}
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
