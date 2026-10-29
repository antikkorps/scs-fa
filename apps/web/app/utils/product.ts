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

// Condition grades of a collection weapon (mirror the ancient_weapons values).
const CONDITION_LABELS: Record<string, string> = {
  excellent: "Excellent",
  bon: "Bon",
  moyen: "Moyen",
  restaure: "Restauré",
}

export function conditionLabel(condition: string | null | undefined): string {
  if (!condition) return "—"
  return CONDITION_LABELS[condition] ?? condition
}

/** The page of an armurerie category, or the whole catalogue for "" (story 9.6). */
export function categoryPath(slug: string): string {
  return slug ? `/boutique/categorie/${encodeURIComponent(slug)}` : "/boutique"
}

/** The page of an armurerie tag: every published product carrying it. */
export function tagPath(slug: string): string {
  return `/boutique/tag/${encodeURIComponent(slug)}`
}

const WHOLE_CATALOGUE_PATH = "/boutique"

/**
 * The page a catalogue view canonicalises to. A filtered view is not a page of
 * its own, except one: the whole catalogue filtered on a single tag and nothing
 * else is exactly that tag's page, which gets the credit.
 */
export function catalogueCanonicalPath(basePath: string, tags: string[], hasOtherFilters: boolean): string {
  const [onlyTag] = tags
  if (basePath === WHOLE_CATALOGUE_PATH && tags.length === 1 && onlyTag && !hasOtherFilters) return tagPath(onlyTag)
  return basePath
}

/**
 * Canonical URL of a catalogue view. Filters never make a distinct page — a
 * filtered view canonicalises to the page it filters — but a later page of
 * results is one, so it keeps its `?page=`.
 */
export function catalogueCanonical(siteUrl: string, basePath: string, page: number): string {
  return page > 1 ? `${siteUrl}${basePath}?page=${page}` : `${siteUrl}${basePath}`
}

/**
 * Meta description of a category page: the category's own words when the
 * catalogue has some, framed so every category page reads distinctly.
 */
export function categoryMetaDescription(name: string, description: string | null | undefined): string {
  return listingMetaDescription(name, description)
}

/** Meta description of a tag page, on the same pattern as a category page. */
export function tagMetaDescription(name: string, description: string | null | undefined): string {
  return listingMetaDescription(name, description)
}

function listingMetaDescription(name: string, description: string | null | undefined): string {
  const own = description?.trim().replace(/\.$/, "")
  return `${name}${own ? ` : ${own}` : ""}. Catégorie légale, prix TTC et stock en temps réel — boutique armurerie SCS Firearms.`
}
