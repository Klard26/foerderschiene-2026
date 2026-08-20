import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Eye } from "lucide-react";
import {
  useListAdminFoerderLeads,
  getListAdminFoerderLeadsQueryKey,
} from "@workspace/api-client-react";
import type { FoerderFinderLead } from "@workspace/api-client-react";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: "In Bearbeitung", className: "bg-amber-50 text-amber-700" },
  sent: { label: "E-Mail versandt", className: "bg-green-50 text-green-700" },
  failed: { label: "Versand fehlgeschlagen", className: "bg-red-50 text-red-700" },
};

const EINGABE_LABEL: Record<string, string> = {
  gebaeudeTyp: "Gebäudetyp",
  baujahr: "Baujahr",
  massnahmen: "Maßnahmen",
  eigennutzer: "Eigennutzer",
  bundesland: "Bundesland",
};

function dt(s: string): string {
  return new Date(s).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

function fmtEingabe(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "Ja" : "Nein";
  return String(v ?? "—");
}

export function FoerderFinderLeadsPanel() {
  const { data: leads, isLoading, isError } = useListAdminFoerderLeads({
    query: { queryKey: getListAdminFoerderLeadsQueryKey() },
  });
  const [selected, setSelected] = useState<FoerderFinderLead | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-destructive">
          Finder-Anfragen konnten nicht geladen werden.
        </CardContent>
      </Card>
    );
  }
  if (!leads || leads.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted-foreground">
          Noch keine Anfragen über den Förderprogramm-Finder.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {leads.map((lead) => {
          const badge = STATUS_BADGE[lead.emailStatus] ?? STATUS_BADGE.pending;
          return (
            <Card key={lead.id} data-testid={`finder-lead-${lead.id}`}>
              <CardContent className="p-4 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm text-foreground truncate">{lead.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {lead.email}
                    {lead.telefon ? ` · ${lead.telefon}` : ""}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">{dt(lead.createdAt)}</span>
                <Badge variant="secondary" className={`text-[0.65rem] ${badge.className}`}>
                  {badge.label}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelected(lead)}
                  data-testid={`button-finder-lead-detail-${lead.id}`}
                >
                  <Eye className="mr-1 h-3.5 w-3.5" />
                  Details
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Finder-Anfrage von {selected?.name}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {Object.entries(selected.eingaben ?? {}).map(([k, v]) => (
                  <div key={k}>
                    <p className="text-xs text-muted-foreground">{EINGABE_LABEL[k] ?? k}</p>
                    <p className="font-medium">{fmtEingabe(v)}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">KI-Analyse</p>
                {selected.programmAnalyse ? (
                  <p className="whitespace-pre-wrap text-xs leading-relaxed bg-muted rounded-lg p-3">
                    {selected.programmAnalyse}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    Noch keine Analyse generiert.
                  </p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
