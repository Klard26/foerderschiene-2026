import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useListMyEnergieausweisOrders } from "@workspace/api-client-react";
import {
  ClipboardList,
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
  CreditCard,
} from "lucide-react";
import { useLocation } from "wouter";

const eurCents = (c: number) =>
  (c / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

const dateFmt = (s: string) =>
  new Date(s).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

type Status = string;

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    extraClass?: string;
    icon: React.ComponentType<{ className?: string }>;
    description: string;
  }
> = {
  pending_payment: {
    label: "Zahlung ausstehend",
    variant: "secondary",
    icon: CreditCard,
    description: "Ihre Zahlung wurde noch nicht bestätigt.",
  },
  bezahlt: {
    label: "Zahlung eingegangen",
    variant: "outline",
    icon: CheckCircle2,
    description: "Ihre Zahlung ist eingegangen. Der Auftrag wird bald bearbeitet.",
  },
  in_bearbeitung: {
    label: "In Bearbeitung",
    variant: "outline",
    icon: Loader2,
    description: "Ein zertifizierter Aussteller erstellt Ihren Energieausweis.",
  },
  ausgestellt: {
    label: "Fertig",
    variant: "default",
    extraClass: "bg-green-600 hover:bg-green-600 text-white",
    icon: CheckCircle2,
    description: "Ihr Energieausweis wurde ausgestellt und zugestellt.",
  },
  storniert: {
    label: "Storniert",
    variant: "destructive",
    icon: XCircle,
    description: "Dieser Auftrag wurde storniert.",
  },
  refunded: {
    label: "Erstattet",
    variant: "destructive",
    icon: XCircle,
    description: "Dieser Auftrag wurde erstattet und wird nicht weiter bearbeitet.",
  },
};

function getFallbackConfig(status: Status) {
  return STATUS_CONFIG[status] ?? {
    label: status,
    variant: "secondary" as const,
    icon: Clock,
    description: "",
  };
}

function StatusTimeline({ status }: { status: string }) {
  const steps: { key: string; label: string }[] = [
    { key: "bezahlt", label: "Zahlung eingegangen" },
    { key: "in_bearbeitung", label: "In Bearbeitung" },
    { key: "ausgestellt", label: "Fertig" },
  ];

  const order = ["pending_payment", "bezahlt", "in_bearbeitung", "ausgestellt"];
  const currentIdx = order.indexOf(status);

  if (status === "storniert" || status === "refunded") return null;

  return (
    <div className="mt-3 flex items-center gap-0">
      {steps.map((step, i) => {
        const stepOrderIdx = order.indexOf(step.key);
        const done = currentIdx >= stepOrderIdx;
        const active = order[currentIdx] === step.key;
        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`h-6 w-6 rounded-full flex items-center justify-center border-2 transition-colors ${
                  done
                    ? "bg-[var(--klard-teal)] border-[var(--klard-teal)]"
                    : "bg-white border-border"
                }`}
              >
                {done && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                )}
              </div>
              <span
                className={`text-[10px] mt-1 text-center leading-tight max-w-[64px] ${
                  active
                    ? "font-semibold text-foreground"
                    : done
                    ? "text-muted-foreground"
                    : "text-muted-foreground/50"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`flex-1 h-0.5 mb-4 mx-1 transition-colors ${
                  currentIdx > stepOrderIdx
                    ? "bg-[var(--klard-teal)]"
                    : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function OrderCard({
  order,
}: {
  order: {
    id: number;
    ausweisTyp: string;
    status: string;
    amountCents: number;
    kontaktName: string;
    kontaktEmail: string;
    createdAt: string;
  };
}) {
  const cfg = getFallbackConfig(order.status);
  const typLabel =
    order.ausweisTyp === "bedarf"
      ? "Energiebedarfsausweis"
      : "Energieverbrauchsausweis";

  return (
    <Card data-testid={`status-card-${order.id}`} className="overflow-hidden">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-sm text-foreground">{typLabel}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Auftrag #{order.id} · {dateFmt(order.createdAt)}
            </p>
          </div>
          <Badge
            variant={cfg.variant}
            className={`shrink-0 ${cfg.extraClass ?? ""}`}
          >
            {cfg.label}
          </Badge>
        </div>

        <StatusTimeline status={order.status} />

        {cfg.description && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {cfg.description}
          </p>
        )}

        <div className="border-t border-border pt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">Betrag</span>
            <br />
            {eurCents(order.amountCents)}
          </div>
          <div>
            <span className="font-medium text-foreground">Kontakt</span>
            <br />
            {order.kontaktName}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EnergieausweisStatusPage() {
  const [, navigate] = useLocation();
  const { data: orders, isLoading, refetch, isFetching } = useListMyEnergieausweisOrders();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <section className="bg-[var(--klard-bg)] py-8 sm:py-12 px-4 sm:px-8 border-b border-border">
        <div className="max-w-[1280px] mx-auto">
          <span className="inline-block bg-[var(--klard-teal-l)] text-[var(--klard-teal-d)] text-[0.7rem] font-bold tracking-wider uppercase px-3 py-1 rounded-full mb-3">
            Energieausweis
          </span>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="font-serif text-3xl sm:text-4xl font-semibold text-foreground mb-2 flex items-center gap-3">
                <ClipboardList className="h-8 w-8 text-[var(--klard-teal-d)]" />
                Meine Aufträge
              </h1>
              <p className="text-muted-foreground text-sm max-w-xl leading-relaxed">
                Hier sehen Sie den aktuellen Bearbeitungsstand Ihrer
                Energieausweis-Aufträge.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh"
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`}
              />
              Aktualisieren
            </Button>
          </div>
        </div>
      </section>

      <section className="px-4 sm:px-8 py-8 max-w-[1280px] mx-auto w-full flex-1">
        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="orders-loading">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-5 space-y-3">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-16 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !orders || orders.length === 0 ? (
          <div
            className="text-center py-16 text-muted-foreground space-y-4"
            data-testid="orders-empty"
          >
            <ClipboardList className="h-12 w-12 mx-auto opacity-30" />
            <p className="text-sm">Sie haben noch keine Energieausweis-Aufträge.</p>
            <Button
              variant="outline"
              onClick={() => navigate("/energieausweis")}
            >
              Jetzt Energieausweis bestellen
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <div
              className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4"
              data-testid="orders-list"
            >
              {orders.map((o) => (
                <OrderCard key={o.id} order={o} />
              ))}
            </div>

            <div className="rounded-xl border border-border bg-[var(--klard-bg)] p-4 max-w-2xl">
              <h3 className="text-sm font-semibold text-foreground mb-2">
                Wie geht es weiter?
              </h3>
              <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal pl-4">
                <li>Ihr Auftrag wird an einen zertifizierten Aussteller übergeben.</li>
                <li>
                  Der Aussteller prüft Ihre Angaben und meldet sich bei Rückfragen
                  per E-Mail.
                </li>
                <li>
                  Der rechtsgültige Energieausweis wird erstellt und Ihnen per
                  E-Mail zugestellt.
                </li>
              </ol>
            </div>
          </div>
        )}
      </section>

      <div className="px-4 sm:px-8 pb-8 max-w-[1280px] mx-auto w-full">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/energieausweis")}
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Neuen Auftrag erstellen
        </Button>
      </div>

      <Footer />
    </div>
  );
}
