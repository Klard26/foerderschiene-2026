import type { VollmachtStatus, VollmachtModus } from "./types";

/**
 * Vollmacht-Lebenszyklus.
 * Widerruf ist aus JEDEM aktiven Status möglich (gesetzlich jederzeit
 * widerrufbar, unabhängig von der Laufzeit).
 */
const VOLLMACHT_UEBERGAENGE: Record<VollmachtStatus, VollmachtStatus[]> = {
  entwurf: ["aktiv", "widerrufen"],
  aktiv: ["pausiert", "widerrufen", "abgelaufen"],
  pausiert: ["aktiv", "widerrufen", "abgelaufen"],
  widerrufen: [], // terminal
  abgelaufen: [], // terminal
};

export function vollmachtUebergangErlaubt(
  von: VollmachtStatus,
  nach: VollmachtStatus,
): boolean {
  return VOLLMACHT_UEBERGAENGE[von]?.includes(nach) ?? false;
}

export interface VollmachtPruefung {
  status: VollmachtStatus;
  modus: VollmachtModus;
  darfKuendigen: boolean;
  darfAbschliessen: boolean;
  gueltigAb?: Date | string | null;
  gueltigBis?: Date | string | null;
}

function toDate(d: Date | string | null | undefined): Date | null {
  if (d == null) return null;
  return d instanceof Date ? d : new Date(d);
}

/** Darf unter dieser Vollmacht überhaupt gewechselt werden? */
export function darfWechseln(v: VollmachtPruefung): {
  erlaubt: boolean;
  grund?: string;
} {
  if (v.status !== "aktiv")
    return { erlaubt: false, grund: "Vollmacht nicht aktiv" };
  if (v.modus === "nur_vorschlag")
    return { erlaubt: false, grund: "Modus erlaubt nur Vorschläge" };
  if (!v.darfKuendigen || !v.darfAbschliessen)
    return {
      erlaubt: false,
      grund: "Umfang deckt Kündigung/Abschluss nicht ab",
    };
  const heute = new Date();
  const ab = toDate(v.gueltigAb);
  const bis = toDate(v.gueltigBis);
  if (ab && heute < ab)
    return { erlaubt: false, grund: "Vollmacht noch nicht gültig" };
  if (bis && heute > bis)
    return { erlaubt: false, grund: "Vollmacht abgelaufen" };
  return { erlaubt: true };
}
