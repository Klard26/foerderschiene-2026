import { Link, useLocation } from "wouter";
import { Sparkles, Database } from "lucide-react";

/**
 * Shared sub-navigation ("Leiste") that combines the two Förderprogramm-Ansichten
 * — Förder-Schnellcheck (guided 2-question matcher) and Förderdatenbank (full
 * browse/filter) — into one strip. The main Navbar carries a single
 * "Förderprogramme" entry; this strip lets the user switch between both views.
 */
const TABS = [
  { href: "/schnellcheck", label: "Förder-Schnellcheck", icon: Sparkles, testid: "tab-schnellcheck" },
  { href: "/foerderung", label: "Förderdatenbank", icon: Database, testid: "tab-foerderdatenbank" },
] as const;

export function FoerderpilotTabs() {
  const [location] = useLocation();

  return (
    <div className="border-b border-border bg-white">
      <div className="max-w-[1180px] mx-auto px-4 sm:px-8">
        <nav className="flex gap-1" aria-label="Förderprogramme">
          {TABS.map((t) => {
            const active =
              location === t.href ||
              (t.href === "/foerderung" && location.startsWith("/foerderung"));
            const Icon = t.icon;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  active
                    ? "border-[var(--klard-teal)] text-[var(--klard-teal-d)]"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                data-testid={t.testid}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
