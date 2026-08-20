import type { WechselStatus, VollmachtModus } from "./types";

/**
 * Wechselvorgang-Orchestrierung.
 * Compliance-kritische Übergänge an EINER Stelle, damit kein Wechsel
 * ohne gültige Vollmacht + korrekten Modus läuft.
 */
const WECHSEL_UEBERGAENGE: Record<WechselStatus, WechselStatus[]> = {
  analyse: ["empfehlung", "fehlgeschlagen"],
  empfehlung: ["wartet_freigabe", "freigegeben"],
  wartet_freigabe: ["freigegeben", "abgelehnt", "widersprochen"],
  freigegeben: ["kuendigung_alt", "fehlgeschlagen"],
  kuendigung_alt: ["anmeldung_neu", "fehlgeschlagen"],
  anmeldung_neu: ["aktiv", "fehlgeschlagen"],
  aktiv: [], // terminal (Erfolg)
  abgelehnt: [], // terminal
  fehlgeschlagen: ["analyse"], // Wiederaufnahme möglich
  widersprochen: [], // terminal
};

export function wechselUebergangErlaubt(
  von: WechselStatus,
  nach: WechselStatus,
): boolean {
  return WECHSEL_UEBERGAENGE[von]?.includes(nach) ?? false;
}

/**
 * Kern-Orchestrierung: nächster Schritt nach der Empfehlung,
 * abhängig vom Vollmacht-Modus.
 *
 *  - nur_vorschlag         → bleibt bei 'empfehlung' (Mensch handelt extern)
 *  - freigabe_erforderlich → 'wartet_freigabe' (aktive Zustimmung nötig)
 *  - vollautomatisch       → 'wartet_freigabe' MIT Widerspruchsfenster;
 *                            nach Ablauf ohne Widerspruch → 'freigegeben'
 *
 * Bewusst KEIN sofortiger Wechsel ohne Fenster: rechtlich sauber,
 * Widerspruchsrecht bleibt gewahrt.
 */
export function nachEmpfehlung(
  modus: VollmachtModus,
  widerspruchsfristTage: number,
): { naechsterStatus: WechselStatus; widerspruchBis?: Date } {
  switch (modus) {
    case "nur_vorschlag":
      return { naechsterStatus: "empfehlung" };
    case "freigabe_erforderlich":
      return { naechsterStatus: "wartet_freigabe" };
    case "vollautomatisch": {
      const bis = new Date();
      bis.setDate(bis.getDate() + widerspruchsfristTage);
      return { naechsterStatus: "wartet_freigabe", widerspruchBis: bis };
    }
  }
}

/** Cron/Worker: vollautomatische Vorgänge nach Fristablauf freigeben. */
export function autoFreigabeFaellig(vorgang: {
  status: WechselStatus;
  widerspruchBis?: Date | string | null;
}): boolean {
  if (vorgang.status !== "wartet_freigabe" || !vorgang.widerspruchBis)
    return false;
  const bis =
    vorgang.widerspruchBis instanceof Date
      ? vorgang.widerspruchBis
      : new Date(vorgang.widerspruchBis);
  return new Date() >= bis;
}

/** Die Demo-Abschlusskette nach Freigabe (simulierte Markt-Schritte). */
export const ABSCHLUSS_KETTE: readonly WechselStatus[] = [
  "kuendigung_alt",
  "anmeldung_neu",
  "aktiv",
] as const;
