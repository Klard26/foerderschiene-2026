import { useListProviders, type ProviderSummary } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Star, MapPin, ArrowRight, BadgeCheck, Users } from "lucide-react";

const ENERGIEBERATER_CATEGORY = "energieberatung";

/**
 * Rank Energieberater by proximity to the building's PLZ, then by quality.
 * exact PLZ > same 2-digit PLZ region > same city > rest; within each bucket,
 * Premium first, then higher rating, then more reviews.
 */
function rankByProximity(
  list: ProviderSummary[],
  plz: string,
  city: string,
): ProviderSummary[] {
  const region = plz.length >= 2 ? plz.slice(0, 2) : "";
  const cityNorm = city.trim().toLowerCase();
  const score = (p: ProviderSummary): number => {
    if (plz && p.zip === plz) return 0;
    if (region && p.zip && p.zip.slice(0, 2) === region) return 1;
    if (cityNorm && p.city && p.city.toLowerCase().includes(cityNorm)) return 2;
    return 3;
  };
  return [...list]
    .sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sa !== sb) return sa - sb;
      const pa = a.subscriptionTier === "premium" ? 0 : 1;
      const pb = b.subscriptionTier === "premium" ? 0 : 1;
      if (pa !== pb) return pa - pb;
      if ((b.rating ?? 0) !== (a.rating ?? 0)) return (b.rating ?? 0) - (a.rating ?? 0);
      return (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
    })
    .slice(0, 3);
}

function EnergieberaterCard({ p }: { p: ProviderSummary }) {
  return (
    <Card className="flex flex-col" data-testid={`card-energieberater-${p.id}`}>
      <CardContent className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-serif text-base font-semibold leading-snug text-foreground">
            {p.displayName}
          </h4>
          {p.subscriptionTier === "premium" && (
            <Badge className="shrink-0 bg-[var(--klard-teal)] text-white hover:bg-[var(--klard-teal)]">
              Premium
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 text-[var(--klard-teal-d)]" />
            {p.zip} {p.city}
          </span>
          {p.rating > 0 && (
            <span className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              {p.rating.toFixed(1)}
              <span className="text-xs">({p.reviewCount})</span>
            </span>
          )}
          {p.verified && (
            <span className="flex items-center gap-1 text-[var(--klard-teal-d)]">
              <BadgeCheck className="h-3.5 w-3.5" />
              Verifiziert
            </span>
          )}
        </div>

        {p.bio && (
          <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
            {p.bio}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 pt-2">
          <span className="text-sm text-foreground">
            {p.minPrice > 0 ? (
              <>
                <span className="text-muted-foreground">ab</span>{" "}
                <span className="font-semibold">{Math.round(p.minPrice)} €</span>
              </>
            ) : (
              <span className="text-muted-foreground">auf Anfrage</span>
            )}
          </span>
          <a
            href={`/providers/${p.id}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--klard-teal)] px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--klard-teal-d)]"
            data-testid={`link-buchen-${p.id}`}
          >
            Profil ansehen &amp; buchen
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Shows up to three recommended Energieberater near the given PLZ. Each card
 * links over to the Klard customer app (/providers/:id) to book the advisor's
 * services. Renders nothing while loading or when no providers are available.
 */
export function EnergieberaterEmpfehlung({
  plz,
  city,
  variant = "full",
}: {
  plz?: string;
  city?: string;
  variant?: "full" | "sidebar";
}) {
  const { data, isLoading } = useListProviders({
    category: ENERGIEBERATER_CATEGORY,
    limit: 50,
  });

  if (isLoading) return null;
  const providers = rankByProximity(data ?? [], plz ?? "", city ?? "");
  if (providers.length === 0) return null;

  const sidebar = variant === "sidebar";

  return (
    <div data-testid="section-energieberater">
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-[var(--klard-teal-d)]" />
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--klard-teal-d)]">
          {sidebar
            ? "Empfohlene Energieberater"
            : "Empfohlene Energieberater in Ihrer Nähe"}
        </div>
      </div>
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        {sidebar
          ? "Zertifizierte Energieberater passend zu Ihrer Postleitzahl — direkt buchbar."
          : "Lassen Sie Ihre Sanierung von einem zertifizierten Energieberater begleiten. Wählen Sie einen Berater passend zu Ihrer Postleitzahl und buchen Sie die Leistung direkt online."}
      </p>
      <div className={sidebar ? "space-y-4" : "grid gap-4 md:grid-cols-3"}>
        {providers.map((p) => (
          <EnergieberaterCard key={p.id} p={p} />
        ))}
      </div>
    </div>
  );
}
