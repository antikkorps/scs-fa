// Presentation helpers of the catalogue import screen (story 12.2): labels and
// the filters of the preview table, kept out of the page so they can be tested.

import type { CatalogImportAction, CatalogImportPreviewRow } from "~/types/admin"
import type { Severity } from "~/utils/status"

export const IMPORT_ACTION_META: Record<CatalogImportAction, { label: string; severity: Severity }> = {
  create: { label: "Création", severity: "ok" },
  update: { label: "Mise à jour", severity: "warn" },
  invalid: { label: "Erreur", severity: "bad" },
  skipped: { label: "Ignorée", severity: "muted" },
}

export const PREVIEW_FILTERS = [
  { key: "all", label: "Toutes" },
  { key: "invalid", label: "Erreurs" },
  { key: "warnings", label: "Avertissements" },
  { key: "create", label: "Créations" },
  { key: "update", label: "Mises à jour" },
] as const

export type PreviewFilter = (typeof PREVIEW_FILTERS)[number]["key"]

export function filterPreviewRows(rows: CatalogImportPreviewRow[], filter: PreviewFilter): CatalogImportPreviewRow[] {
  switch (filter) {
    case "all":
      return rows
    case "warnings":
      return rows.filter((r) => r.warnings.length > 0)
    default:
      return rows.filter((r) => r.action === filter)
  }
}

/** How many rows each filter would show — the counters on the filter chips. */
export function previewFilterCounts(rows: CatalogImportPreviewRow[]): Record<PreviewFilter, number> {
  return Object.fromEntries(PREVIEW_FILTERS.map((f) => [f.key, filterPreviewRows(rows, f.key).length])) as Record<
    PreviewFilter,
    number
  >
}

/** "12 produits" / "1 produit" — the commit button states exactly what it will do. */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n.toLocaleString("fr-FR")} ${n > 1 ? pluralForm : singular}`
}
