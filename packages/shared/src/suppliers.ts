/**
 * The suppliers whose catalogues are collected (story 12.2), by the name
 * written in the Fournisseur column of their triage files.
 *
 * One list for both ends: the collector writes these names, and the seed
 * declares them, because the import only accepts a declared supplier (story
 * 12.5). A name changed on one side only would refuse every row of the file.
 */
export const CATALOG_SUPPLIERS = {
  agoraTec: "Agora-Tec",
  bgmWinfield: "BGM Winfield",
  corCaroli: "Cor Caroli",
  espFrance: "ESP France",
  humbert: "Humbert",
  toroDistribution: "Toro Distribution",
} as const
