export interface Foerdermittel {
  name: string;
  satz: string;
  max: string;
  tags: string[];
  beschreibung: string;
}

export const FOERDERUNG: Foerdermittel[] = [
  {
    name: "BEG-EM Heizungstausch (KfW 458)",
    satz: "30 % Grundförderung + Boni bis 70 %",
    max: "30.000 € pro Wohneinheit",
    tags: ["heizung"],
    beschreibung: "Förderung für klimafreundliche Heizungen (Wärmepumpe, Pellet, Solarthermie, Biomasse).",
  },
  {
    name: "BEG-EM Gebäudehülle (BAFA)",
    satz: "15 % + 5 % iSFP-Bonus = 20 %",
    max: "60.000 € pro Wohneinheit/Jahr",
    tags: ["daemmung", "fenster"],
    beschreibung: "Zuschuss für Dämmung von Fassade, Dach, Kellerdecke und für Fenstertausch.",
  },
  {
    name: "Effizienzhaus (KfW 261)",
    satz: "Tilgungszuschuss bis 45 %",
    max: "150.000 € pro Wohneinheit",
    tags: ["komplett"],
    beschreibung: "Kreditförderung für Sanierung zum Effizienzhaus 85, 70, 55, 40 oder Denkmal.",
  },
  {
    name: "§ 35c EStG Steuerbonus",
    satz: "20 % verteilt auf 3 Jahre",
    max: "40.000 € pro Objekt",
    tags: ["steuer"],
    beschreibung: "Steuerermäßigung für energetische Sanierung bei selbstgenutztem Wohneigentum.",
  },
  {
    name: "iSFP (BAFA-geförderte Beratung)",
    satz: "80 % Zuschuss",
    max: "1.700 € (EFH/ZFH), 2.700 € (MFH)",
    tags: ["beratung"],
    beschreibung: "Individueller Sanierungsfahrplan durch zertifizierten Energieberater.",
  },
];

export const FOERDER_KATEGORIEN = [
  { id: "heizung", l: "Heizung" },
  { id: "daemmung", l: "Dämmung / Fassade" },
  { id: "fenster", l: "Fenster" },
  { id: "komplett", l: "Komplettsanierung" },
  { id: "beratung", l: "Beratung / iSFP" },
  { id: "steuer", l: "Steuer" },
] as const;

export type FoerderKategorieId = (typeof FOERDER_KATEGORIEN)[number]["id"];
