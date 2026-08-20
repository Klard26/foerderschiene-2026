import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MailCheck, MailWarning, RotateCw } from "lucide-react";
import type { useEmailDeliveryHealth } from "@/lib/vorgangApi";

/**
 * Displays email delivery health at the top of the admin Verwaltung page.
 *
 * Three visible states:
 *  - loading  → skeleton card
 *  - error    → amber warning card with retry button   (data-testid="email-health-error")
 *  - healthy  → green card with "OK" badge             (data-testid="email-health-healthy")
 *  - failures → red card with count + latest error     (data-testid="email-health-failures")
 */
export function EmailHealthStatus({
  health,
}: {
  health: ReturnType<typeof useEmailDeliveryHealth>;
}) {
  if (health.isLoading) {
    return (
      <Card className="mb-6 rounded-[20px] border-[1.5px]" data-testid="email-health-loading">
        <CardContent className="flex items-center gap-3 py-4">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-64 max-w-[70vw]" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (health.isError || !health.data) {
    return (
      <Card
        className="mb-6 rounded-[20px] border-amber-300 bg-amber-50/70"
        data-testid="email-health-error"
      >
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-start gap-3">
            <MailWarning className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <p className="font-semibold text-amber-950">E-Mail-Status nicht verfügbar</p>
              <p className="mt-1 text-sm text-amber-900/80">
                Der Versandstatus konnte nicht geprüft werden.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-amber-300 bg-white text-amber-950 hover:bg-amber-100"
            onClick={() => health.refetch()}
            disabled={health.isFetching}
            data-testid="button-refresh-email-health"
          >
            <RotateCw className={`mr-1.5 h-3.5 w-3.5 ${health.isFetching ? "animate-spin" : ""}`} />
            Erneut prüfen
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { data } = health;
  const latestFailure = data.failures[0];

  if (data.healthy) {
    return (
      <Card
        className="mb-6 rounded-[20px] border-emerald-200 bg-emerald-50/70"
        data-testid="email-health-healthy"
      >
        <CardContent className="flex items-center justify-between gap-3 py-4">
          <div className="flex items-start gap-3">
            <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            <div>
              <p className="font-semibold text-emerald-950">E-Mail-Versand ist gesund</p>
              <p className="mt-1 text-sm text-emerald-900/80">
                Keine fehlgeschlagenen Transaktions-E-Mails in den letzten {data.windowHours} Stunden.
              </p>
            </div>
          </div>
          <Badge className="border-emerald-200 bg-emerald-100 text-emerald-800">OK</Badge>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="mb-6 rounded-[20px] border-red-300 bg-red-50/80"
      data-testid="email-health-failures"
    >
      <CardContent className="flex flex-wrap items-start justify-between gap-4 py-4">
        <div className="flex items-start gap-3">
          <MailWarning className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
          <div className="min-w-0">
            <p className="font-semibold text-red-950">
              {data.failedCount} fehlgeschlagene {data.failedCount === 1 ? "E-Mail" : "E-Mails"} erkannt
            </p>
            <p className="mt-1 text-sm text-red-900/80">
              Im Prüfzeitraum von {data.windowHours} Stunden sind Zustellfehler aufgetreten.
            </p>
            {latestFailure && (
              <p className="mt-2 max-w-3xl break-words rounded-md border border-red-200 bg-white/70 px-2.5 py-2 text-sm text-red-950">
                <span className="font-medium">Letzter Fehler:</span>{" "}
                {latestFailure.error || "Unbekannter Zustellfehler"}
              </p>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-red-300 bg-white text-red-950 hover:bg-red-100"
          onClick={() => health.refetch()}
          disabled={health.isFetching}
          data-testid="button-refresh-email-health"
        >
          <RotateCw className={`mr-1.5 h-3.5 w-3.5 ${health.isFetching ? "animate-spin" : ""}`} />
          Aktualisieren
        </Button>
      </CardContent>
    </Card>
  );
}
