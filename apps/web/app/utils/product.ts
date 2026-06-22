import type { LegalCategoryCode } from "~/types/product"

// Short badge label for a French prefectural legal category. `none` means the
// item is freely sold (no authorization/declaration).
const LEGAL_LABELS: Record<LegalCategoryCode, string> = {
  A: "Catégorie A",
  B: "Catégorie B",
  C: "Catégorie C",
  D: "Catégorie D",
  none: "Vente libre",
}

export function legalCategoryLabel(code: LegalCategoryCode | null | undefined): string {
  return code ? (LEGAL_LABELS[code] ?? "Vente libre") : "Vente libre"
}

/** A regulated category (A/B/C/D) — shown with an accent badge vs. free sale. */
export function isRegulated(code: LegalCategoryCode | null | undefined): boolean {
  return Boolean(code) && code !== "none"
}

export function inStock(stockQty: number | null | undefined): boolean {
  return (stockQty ?? 0) > 0
}

/** Human stock state for a catalogue card / detail page. */
export function stockLabel(stockQty: number | null | undefined): string {
  const qty = stockQty ?? 0
  if (qty <= 0) return "Rupture de stock"
  if (qty <= 5) return `Plus que ${qty} en stock`
  return "En stock"
}

// French labels for the required legal document types (codes from the API).
const DOC_LABELS: Record<string, string> = {
  cni: "Carte nationale d'identité",
  permis_chasse: "Permis de chasser validé",
  autorisation_det: "Autorisation de détention préfectorale",
  sia: "Numéro SIA (compte personnel)",
  expertise: "Certificat d'expertise",
}

export function legalDocLabel(code: string): string {
  return DOC_LABELS[code] ?? code
}
