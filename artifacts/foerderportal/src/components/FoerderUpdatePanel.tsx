import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  useListFoerderUpdateLog,
  getListFoerderUpdateLogQueryKey,
  useTriggerFoerderUpdate,
} from "@workspace/api-client-react";

function dt(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

const QUELLE_LABEL: Record<string, string> = {
  kfw: "KfW-Produktübersicht",
  bafa: "BAFA-Programmliste",
};

export function FoerderUpdatePanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: logs, isLoading, isError } = useListFoerderUpdateLog({
    query: { queryKey: getListFoerderUpdateLogQueryKey() },
  });
  const trigger = useTriggerFoerderUpdate({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getListFoerderUpdateLogQueryKey(),
        });
        toast({ title: "Aktualisierung abgeschlossen" });
      },
      onError: () =>
        toast({
          title: "Aktualisierung fehlgeschlagen",
          variant: "destructive",
        }),
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-destructive">
          Update-Protokoll konnte nicht geladen werden.
        </CardContent>
      </Card>
    );
  }

  const lastCompleted = logs?.find((l) => l.abgeschlossenAm && !l.fehler);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              Automatische Katalog-Aktualisierung
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Läuft jeden Montag ab 06:00 Uhr. Letzte erfolgreiche
              Aktualisierung: {dt(lastCompleted?.abgeschlossenAm)}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={trigger.isPending}
            onClick={() => trigger.mutate()}
            data-testid="button-foerder-update-now"
          >
            {trigger.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-4 w-4" />
            )}
            Jetzt aktualisieren
          </Button>
        </CardContent>
      </Card>

      {!logs || logs.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            Noch keine Aktualisierungsläufe protokolliert.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <Card key={log.id} data-testid={`update-log-${log.id}`}>
              <CardContent className="p-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-medium min-w-[170px]">
                  {QUELLE_LABEL[log.quelle] ?? log.quelle}
                </span>
                <span className="text-muted-foreground text-xs">
                  {dt(log.gestartetAm)}
                </span>
                {log.fehler ? (
                  <Badge className="bg-red-50 text-red-700 hover:bg-red-50">
                    Fehler
                  </Badge>
                ) : !log.abgeschlossenAm ? (
                  <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50">
                    Läuft…
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {log.eingefuegt} neu · {log.geaendert} geändert ·{" "}
                    {log.deaktiviert} deaktiviert
                  </span>
                )}
                {log.fehler ? (
                  <span className="w-full text-xs text-red-700 truncate">
                    {log.fehler}
                  </span>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
