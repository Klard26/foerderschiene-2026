import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Show, UserButton } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { useIsAdmin } from "@/lib/vorgangApi";

const BASE = import.meta.env.BASE_URL;

export function Navbar() {
  const [, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: adminMe } = useIsAdmin();
  const isAdmin = !!adminMe?.isAdmin;

  return (
    <header
      className="sticky top-0 z-40 w-full border-b border-border bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
      data-testid="navbar"
    >
      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 flex h-16 items-center gap-4">
        <Link href="/" className="shrink-0 flex items-center gap-2" data-testid="link-logo">
          <span className="fp-logo text-xl">Förder<span>schiene</span></span>
        </Link>

        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium ml-auto">
          <Link
            href="/check"
            className="text-muted-foreground hover:text-[var(--klard-teal-d)] transition-colors"
            data-testid="link-gebaeudecheck"
          >
            Gebäudecheck
          </Link>
          <Link
            href="/schnellcheck"
            className="text-muted-foreground hover:text-[var(--klard-teal-d)] transition-colors"
            data-testid="link-foerderprogramme"
          >
            Förderprogramme
          </Link>
          <Link
            href="/energieausweis"
            className="text-muted-foreground hover:text-[var(--klard-teal-d)] transition-colors"
            data-testid="link-energieausweis"
          >
            Energieausweis
          </Link>
          <a
            href={`${BASE}ratgeber/`}
            className="text-muted-foreground hover:text-[var(--klard-teal-d)] transition-colors"
            data-testid="link-ratgeber"
          >
            Ratgeber
          </a>
          <Link
            href="/berater"
            className="text-muted-foreground hover:text-[var(--klard-teal-d)] transition-colors"
            data-testid="link-berater"
          >
            Für Berater
          </Link>
          <Show when="signed-in">
            <Link
              href="/report"
              className="text-muted-foreground hover:text-[var(--klard-teal-d)] transition-colors"
              data-testid="link-reports"
            >
              Meine Reports
            </Link>
            <Link
              href="/portfolio"
              className="text-muted-foreground hover:text-[var(--klard-teal-d)] transition-colors"
              data-testid="link-portfolio"
            >
              Portfolio
            </Link>
            <Link
              href="/kunden"
              className="text-muted-foreground hover:text-[var(--klard-teal-d)] transition-colors"
              data-testid="link-kunden"
            >
              Kunden
            </Link>
            <Link
              href="/konto"
              className="text-muted-foreground hover:text-[var(--klard-teal-d)] transition-colors"
              data-testid="link-konto"
            >
              Mein Konto
            </Link>
          </Show>
          {isAdmin && (
            <Link
              href="/verwaltung"
              className="font-semibold text-[var(--klard-teal-d)] hover:text-[var(--klard-teal)] transition-colors"
              data-testid="link-verwaltung"
            >
              Verwaltung
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-2 ml-auto lg:ml-0">
          <Show when="signed-in">
            <UserButton />
          </Show>
          <Show when="signed-out">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation("/sign-in")}
                className="rounded-full border-[1.5px] px-4 h-9 text-xs font-semibold"
                data-testid="button-signin"
              >
                Einloggen
              </Button>
              <Button
                size="sm"
                onClick={() => setLocation("/sign-up")}
                className="rounded-full bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white px-4 h-9 text-xs font-semibold"
                data-testid="button-signup"
              >
                Kostenlos starten
              </Button>
            </div>
          </Show>

          <button
            className="lg:hidden p-1 text-muted-foreground hover:text-foreground"
            onClick={() => setMobileOpen(!mobileOpen)}
            data-testid="button-mobile-menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="lg:hidden border-t border-border bg-white">
          <nav className="flex flex-col px-4 py-3 gap-1">
            <Link href="/check" className="py-2 text-sm text-foreground" onClick={() => setMobileOpen(false)}>
              Gebäudecheck
            </Link>
            <Link href="/schnellcheck" className="py-2 text-sm text-foreground" onClick={() => setMobileOpen(false)} data-testid="link-foerderprogramme-mobile">
              Förderprogramme
            </Link>
            <Link href="/energieausweis" className="py-2 text-sm text-foreground" onClick={() => setMobileOpen(false)}>
              Energieausweis
            </Link>
            <a href={`${BASE}ratgeber/`} className="py-2 text-sm text-foreground" onClick={() => setMobileOpen(false)}>
              Ratgeber
            </a>
            <Link href="/berater" className="py-2 text-sm text-foreground" onClick={() => setMobileOpen(false)}>
              Für Energieberater
            </Link>
            <Show when="signed-in">
              <Link href="/report" className="py-2 text-sm text-foreground" onClick={() => setMobileOpen(false)}>
                Meine Reports
              </Link>
              <Link href="/portfolio" className="py-2 text-sm text-foreground" onClick={() => setMobileOpen(false)} data-testid="link-portfolio-mobile">
                Portfolio
              </Link>
              <Link href="/kunden" className="py-2 text-sm text-foreground" onClick={() => setMobileOpen(false)} data-testid="link-kunden-mobile">
                Kunden
              </Link>
              <Link href="/konto" className="py-2 text-sm text-foreground" onClick={() => setMobileOpen(false)} data-testid="link-konto-mobile">
                Mein Konto
              </Link>
            </Show>
            {isAdmin && (
              <Link
                href="/verwaltung"
                className="py-2 text-sm font-semibold text-[var(--klard-teal-d)]"
                onClick={() => setMobileOpen(false)}
                data-testid="link-verwaltung-mobile"
              >
                Verwaltung
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
