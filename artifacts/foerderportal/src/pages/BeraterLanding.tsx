import { Link } from "wouter";
import { useAuth } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, FileCheck2, MapPin, Users, ArrowRight, BadgeCheck, CircleHelp } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

const BASE = import.meta.env.BASE_URL;

export default function BeraterLanding() {
  const { isLoaded, isSignedIn } = useAuth();
  const registrationPath = `${BASE.replace(/\/$/, "")}/berater/registrieren`;
  const hasActiveSession = isLoaded && isSignedIn;
  const startProfileHref = hasActiveSession
    ? "/berater/registrieren"
    : `/sign-up?redirect_url=${encodeURIComponent(registrationPath)}`;
  const existingProfileHref = hasActiveSession
    ? "/berater/registrieren"
    : `/sign-in?redirect_url=${encodeURIComponent(registrationPath)}`;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-white">
      <Navbar />
      <main className="flex-1">
        <section className="bg-[var(--klard-bg)] py-20 px-4 sm:px-8 border-b border-border relative overflow-hidden">
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, black 1px, transparent 0)', backgroundSize: '32px 32px' }}></div>
          <div className="max-w-[1100px] mx-auto grid md:grid-cols-2 gap-12 items-center relative z-10">
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--klard-teal-p)] text-[var(--klard-teal-d)] text-xs font-bold tracking-wide uppercase mb-6 border border-[var(--klard-teal-l)]">
                Für Energieberater
              </div>
              <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6 leading-[1.1]">
                Kunden gewinnen als <span className="text-[var(--klard-teal)]">zertifizierter Experte</span>
              </h1>
              <p className="text-lg text-muted-foreground mb-8 max-w-[480px]">
                Werden Sie Partner von Förderschiene und erhalten Sie qualifizierte Anfragen für Gebäudechecks, Sanierungsfahrpläne und Fördermittelberatung – direkt aus Ihrer Region.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button size="lg" asChild className="bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white font-semibold h-12 px-8 rounded-full shadow-md hover-elevate">
                  <Link href={startProfileHref}>
                    Partnerprofil erstellen <ArrowRight className="w-4 h-4 ml-2" />
                  </Link>
                </Button>
                <Button variant="outline" size="lg" asChild className="h-12 px-7 rounded-full font-semibold border-[var(--klard-teal-l)] text-[var(--klard-teal-d)] hover:bg-[var(--klard-teal-p)]">
                  <Link href={existingProfileHref}>
                    {hasActiveSession ? "Mein Beraterprofil öffnen" : "Bereits registriert? Einloggen"}
                  </Link>
                </Button>
              </div>
              <div className="flex items-center gap-2 text-sm text-foreground/70 mt-6 font-medium">
                <CheckCircle2 className="w-5 h-5 text-[var(--klard-teal)]" /> 
                <span>Kein Abo-Zwang. Die ersten 2 Kundenanfragen sind kostenlos.</span>
              </div>
            </div>
            
            <div className="bg-white p-8 sm:p-10 rounded-[2rem] shadow-xl border border-border/60 relative animate-in fade-in slide-in-from-right-8 duration-700 delay-150 fill-mode-both">
              <h3 className="font-serif text-2xl font-bold mb-8">Ihre Vorteile im Netzwerk</h3>
              <ul className="space-y-8">
                <li className="flex gap-5">
                  <div className="bg-[var(--klard-bg)] w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border border-border/50">
                    <Users className="w-6 h-6 text-[var(--klard-teal)]" />
                  </div>
                  <div>
                    <h4 className="font-bold text-foreground text-lg">Vorgeprüfte Kunden</h4>
                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                      Kunden haben bereits den Gebäudecheck durchlaufen. Sie erhalten strukturierte Objektdaten statt vager Anfragen.
                    </p>
                  </div>
                </li>
                <li className="flex gap-5">
                  <div className="bg-[var(--klard-bg)] w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border border-border/50">
                    <MapPin className="w-6 h-6 text-[var(--klard-teal)]" />
                  </div>
                  <div>
                    <h4 className="font-bold text-foreground text-lg">Regionale Zuteilung</h4>
                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                      Unser System schlägt Sie gezielt Kunden in Ihrem PLZ-Gebiet vor – ideal für kurze Wege bei Vor-Ort-Begehungen.
                    </p>
                  </div>
                </li>
                <li className="flex gap-5">
                  <div className="bg-[var(--klard-bg)] w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border border-border/50">
                    <FileCheck2 className="w-6 h-6 text-[var(--klard-teal)]" />
                  </div>
                  <div>
                    <h4 className="font-bold text-foreground text-lg">Einfache Abwicklung</h4>
                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                      Präsentieren Sie Ihr Profil, empfangen Sie Buchungen online und verwalten Sie alle Aufträge zentral an einem Ort.
                    </p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </section>
        
        <section className="py-24 px-4 sm:px-8 text-center bg-white">
          <div className="max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--klard-bg)] text-[var(--klard-teal-d)] text-xs font-bold tracking-wide uppercase mb-5">
              So werden Sie Partner
            </div>
            <h2 className="font-serif text-3xl font-bold mb-3">In 3 Schritten zum ersten Kunden</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Für die Registrierung benötigen Sie Ihre Kontaktdaten und eine gültige dena-Kundennummer. Die Angaben prüfen wir vor der Freischaltung persönlich.
            </p>
            <div className="grid sm:grid-cols-3 gap-8 mt-12">
              <div>
                <div className="w-12 h-12 rounded-full bg-[var(--klard-teal)] text-white font-bold flex items-center justify-center mx-auto mb-4 text-lg shadow-sm">1</div>
                <h4 className="font-bold mb-2">Registrieren</h4>
                <p className="text-sm text-muted-foreground">Basisdaten, dena-Nummer und Qualifikationen hinterlegen.</p>
              </div>
              <div>
                <div className="w-12 h-12 rounded-full bg-[var(--klard-teal)] text-white font-bold flex items-center justify-center mx-auto mb-4 text-lg shadow-sm">2</div>
                <h4 className="font-bold mb-2">Freischaltung</h4>
                <p className="text-sm text-muted-foreground">Wir prüfen Ihre Angaben. Nach Freigabe ist Ihr Profil online.</p>
              </div>
              <div>
                <div className="w-12 h-12 rounded-full bg-[var(--klard-teal)] text-white font-bold flex items-center justify-center mx-auto mb-4 text-lg shadow-sm">3</div>
                <h4 className="font-bold mb-2">Anfragen erhalten</h4>
                <p className="text-sm text-muted-foreground">Kunden aus Ihrer Region können nun Leistungen bei Ihnen anfragen.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 sm:px-8 pb-24 bg-white">
          <div className="max-w-4xl mx-auto rounded-[2rem] bg-[var(--klard-ink)] px-6 py-10 sm:p-12 text-center text-white">
            <BadgeCheck className="w-9 h-9 mx-auto mb-5 text-[var(--klard-teal)]" />
            <h2 className="font-serif text-3xl font-bold">Bereit für qualifizierte Anfragen?</h2>
            <p className="max-w-2xl mx-auto mt-4 text-white/70">
              Erstellen Sie jetzt Ihr Profil. Die Registrierung dauert nur wenige Minuten; nach erfolgreicher Prüfung informieren wir Sie über die Freischaltung.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
              <Button size="lg" asChild className="bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white rounded-full px-8 h-12 font-semibold">
                <Link href={startProfileHref}>Jetzt Partner werden <ArrowRight className="w-4 h-4 ml-2" /></Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white rounded-full px-8 h-12 font-semibold">
                <a href={`${BASE}ratgeber/`}>Im Ratgeber informieren <CircleHelp className="w-4 h-4 ml-2" /></a>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
