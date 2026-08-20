import type { Sparte } from "./types";

/**
 * Neutrale Tarifvergleichs-Logik (echte Berechnung).
 * Der Live-Feed über 300+ Versorger ist in der Demo durch Seed-Tarife
 * abgebildet; die Vergleichs- und Ersparnis-Mathematik ist real.
 */

export interface TarifAngebot {
  id: number;
  sparte: Sparte;
  versorger: string;
  tarifname: string;
  arbeitspreisCtKwh: number;
  grundpreisEurJahr: number;
  laufzeitMonate?: number | null;
  preisgarantieMonate?: number | null;
  oekostrom?: boolean | null;
  minVerbrauchKwh?: number | null;
  maxVerbrauchKwh?: number | null;
  plzGebiet?: string | null;
}

export interface AktuellerVertrag {
  versorger: string;
  arbeitspreisCtKwh: number;
  grundpreisEurJahr: number;
}

/** Jahreskosten = Arbeitspreis (ct/kWh → €) × Verbrauch + Grundpreis. */
export function jahreskosten(
  arbeitspreisCtKwh: number,
  grundpreisEurJahr: number,
  verbrauchKwh: number,
): number {
  return (arbeitspreisCtKwh / 100) * verbrauchKwh + grundpreisEurJahr;
}

export interface VergleichErgebnis {
  bestesAngebot: TarifAngebot | null;
  aktuelleKostenEurJahr: number;
  besteKostenEurJahr: number;
  ersparnisEurJahr: number;
  ersparnisProzent: number;
  anzahlVerglicheneAnbieter: number;
}

/**
 * Filtert passende Angebote (Sparte, Verbrauchsband, PLZ-Gebiet) und
 * ermittelt das günstigste anhand der Jahreskosten beim gegebenen
 * Verbrauch. Liefert die realisierbare Ersparnis ggü. dem Altvertrag.
 */
export function vergleicheTarife(args: {
  sparte: Sparte;
  verbrauchKwh: number;
  plz?: string | null;
  aktuell: AktuellerVertrag;
  angebote: TarifAngebot[];
}): VergleichErgebnis {
  const { sparte, verbrauchKwh, plz, aktuell, angebote } = args;
  const plzGebiet = plz ? plz.slice(0, 2) : null;

  const passend = angebote.filter((a) => {
    if (a.sparte !== sparte) return false;
    if (a.minVerbrauchKwh != null && verbrauchKwh < a.minVerbrauchKwh)
      return false;
    if (a.maxVerbrauchKwh != null && verbrauchKwh > a.maxVerbrauchKwh)
      return false;
    if (
      a.plzGebiet &&
      plzGebiet &&
      a.plzGebiet.slice(0, 2) !== plzGebiet
    )
      return false;
    return true;
  });

  const aktuelleKosten = jahreskosten(
    aktuell.arbeitspreisCtKwh,
    aktuell.grundpreisEurJahr,
    verbrauchKwh,
  );

  let bestesAngebot: TarifAngebot | null = null;
  let besteKosten = aktuelleKosten;
  for (const a of passend) {
    const k = jahreskosten(
      a.arbeitspreisCtKwh,
      a.grundpreisEurJahr,
      verbrauchKwh,
    );
    if (bestesAngebot === null || k < besteKosten) {
      bestesAngebot = a;
      besteKosten = k;
    }
  }

  const ersparnis = Math.max(0, aktuelleKosten - besteKosten);
  const ersparnisProzent =
    aktuelleKosten > 0 ? (ersparnis / aktuelleKosten) * 100 : 0;

  return {
    bestesAngebot,
    aktuelleKostenEurJahr: round2(aktuelleKosten),
    besteKostenEurJahr: round2(besteKosten),
    ersparnisEurJahr: round2(ersparnis),
    ersparnisProzent: round2(ersparnisProzent),
    anzahlVerglicheneAnbieter: passend.length,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
