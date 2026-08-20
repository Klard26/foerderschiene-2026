import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL;

export function Footer() {
  return (
    <footer className="bg-[var(--klard-ink)] text-white/45 mt-16 px-4 sm:px-8 pt-14 pb-8">
      <div className="max-w-[1100px] mx-auto grid gap-9 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr] mb-9">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="fp-logo text-[1.3rem] text-white">
              Förder<span className="text-[var(--klard-teal)]">schiene</span>
            </span>
          </div>
          <p className="text-[0.78rem] leading-[1.7] max-w-[280px]">
            Fördermittel, Sanierungskosten und rechtsgültiger Energieausweis für Ihre
            Immobilie — aus einer Hand. Der Energieausweis wird von einem zertifizierten
            Aussteller erstellt.
          </p>
        </div>

        <div>
          <h4 className="text-white/70 text-[0.74rem] font-bold tracking-wider uppercase mb-3">Leistungen</h4>
          <Link href="/check" className="block text-[0.78rem] text-white/35 hover:text-white/70 mb-2">Gebäudecheck</Link>
          <Link href="/report" className="block text-[0.78rem] text-white/35 hover:text-white/70 mb-2">Gebäudereport &amp; Förderung</Link>
          <Link href="/energieausweis" className="block text-[0.78rem] text-white/35 hover:text-white/70 mb-2">Energieausweis</Link>
        </div>

        <div>
          <h4 className="text-white/70 text-[0.74rem] font-bold tracking-wider uppercase mb-3">Für wen</h4>
          <p className="text-[0.78rem] text-white/35 mb-2">Eigentümer</p>
          <p className="text-[0.78rem] text-white/35 mb-2">Vermieter</p>
          <p className="text-[0.78rem] text-white/35 mb-2">Verkäufer</p>
          <div className="mt-5">
            <h4 className="text-white/70 text-[0.74rem] font-bold tracking-wider uppercase mb-3">Partner</h4>
            <Link href="/berater" className="block text-[0.78rem] text-white/35 hover:text-white/70 mb-2">Für Energieberater</Link>
          </div>
        </div>

        <div>
          <h4 className="text-white/70 text-[0.74rem] font-bold tracking-wider uppercase mb-3">Ratgeber</h4>
          <a href={`${BASE}ratgeber/`} className="block text-[0.78rem] text-white/60 hover:text-white mb-2 font-medium">Ratgeber-Übersicht</a>
          <a href={`${BASE}ratgeber/kfw-458-heizungsfoerderung/`} className="block text-[0.78rem] text-white/35 hover:text-white/70 mb-2">KfW 458 Heizungsförderung</a>
          <a href={`${BASE}ratgeber/energieausweis-pflicht/`} className="block text-[0.78rem] text-white/35 hover:text-white/70 mb-2">Energieausweis-Pflicht</a>
          <a href={`${BASE}ratgeber/beg-foerderung/`} className="block text-[0.78rem] text-white/35 hover:text-white/70 mb-2">BEG-Förderung</a>
        </div>
      </div>

      <div className="max-w-[1100px] mx-auto border-t border-white/10 pt-6 text-center text-[0.7rem]">
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 mb-3">
          <a href={`${BASE}impressum/`} className="text-white/45 hover:text-white/80">Impressum</a>
          <a href={`${BASE}datenschutz/`} className="text-white/45 hover:text-white/80">Datenschutz</a>
          <a href={`${BASE}agb/`} className="text-white/45 hover:text-white/80">AGB</a>
        </div>
        © {new Date().getFullYear()} Förderschiene · Fördermittel &amp; Energieausweis für Immobilien
      </div>
    </footer>
  );
}
