// Builds the triage workbook (story 12.2): every collected product, reconciled
// with its supplier's price list, one row per reference, in the exact columns
// the admin import reads back (`CATALOG_IMPORT_COLUMNS`).
//
// The builder PROPOSES — a selling price from the supplier's margin, a category
// and, only where a human wrote a rule for it, a legal category. It never
// fills "Importer": choosing what to sell is the client's call.

import {
  type CollectedProduct,
  type LegalCategory,
  type PriceListRow,
  proposeSalePriceHt,
  type ReconcileStatus,
  reconcileCatalog,
} from "@armurier/shared"
import { addCatalogSheet, type CatalogSheetRow } from "@armurier/shared/spreadsheet"
import ExcelJS from "exceljs"
import { z } from "zod"
import { cleanText, htmlToText, truncate } from "./extract.js"

// --- Configuration (work/config.json) --------------------------------------

const ruleSchema = z.object({
  /** Case-insensitive regular expression. */
  match: z.string().min(1),
  /**
   * Where to look: the supplier's own category path (default), the product name,
   * or the supplier's legal classification (e.g. Humbert's "C1a", "B2e", "NR").
   * A rule on that classification is how a human maps it to a legal category
   * once for the whole catalogue — the tool itself never derives one.
   */
  field: z.enum(["sourceCategory", "name", "supplierLegalClass"]).default("sourceCategory"),
  category: z.string().min(1).optional(),
  legalCategory: z.enum(["A", "B", "C", "D", "none"]).optional(),
})

export const supplierConfigSchema = z.object({
  marginPct: z.number().min(0).max(99).default(30),
  priceList: z
    .object({
      file: z.string().min(1),
      sheet: z.string().optional(),
      mapping: z.object({ ref: z.string().min(1), price: z.string().min(1), ean: z.string().optional() }),
    })
    .optional(),
  /**
   * For each proposed field (category, legal category), the first matching rule
   * that sets it wins — so a rule on the supplier's category path and a rule on
   * its legal classification can both apply to the same article.
   */
  rules: z.array(ruleSchema).default([]),
})

export const triageConfigSchema = z.object({
  /** Base URL of the API, to read the product categories offered in the drop-down. */
  apiBaseUrl: z.string().url().optional(),
  /** Or the categories themselves, when working offline. */
  categories: z.array(z.object({ slug: z.string(), name: z.string() })).optional(),
  suppliers: z.record(z.string(), supplierConfigSchema).default({}),
})

export type SupplierConfig = z.infer<typeof supplierConfigSchema>
export type TriageConfig = z.infer<typeof triageConfigSchema>

export interface Category {
  slug: string
  name: string
}

// --- Model -----------------------------------------------------------------

export type TriageRow = CatalogSheetRow

export interface OrphanPrice {
  supplier: string
  ref: string
  ean: string | null
  price: number
  line: number
}

export interface TriageModel {
  rows: TriageRow[]
  orphans: OrphanPrice[]
  stats: Record<ReconcileStatus, number>
}

export interface SupplierBatch {
  supplier: string
  products: CollectedProduct[]
  /** Null when no price list was provided: every product is then "no price". */
  prices: PriceListRow[] | null
  config: SupplierConfig
}

/**
 * The purchase prices a pro-area collection read, as if they came from a price
 * list — so they go through the same reconciliation. `line` is the product's
 * position in the collected file.
 */
export function pricesFromCollection(products: CollectedProduct[]): PriceListRow[] {
  return products.flatMap((p, i) =>
    p.purchasePrice === undefined ? [] : [{ line: i + 1, ref: p.supplierSku, price: p.purchasePrice, ean: null }],
  )
}

const STATUS_LABELS: Record<ReconcileStatus, string> = {
  matched: "Rapproché",
  no_price: "Sans prix",
  ambiguous: "Prix ambigu (référence en double dans le tarif)",
}

const MAX_SHORT = 1000
const MAX_LONG = 20000

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** Supplier description + a specifications list, within the import's limit. */
function longDescription(product: CollectedProduct): string | null {
  const specs = Object.entries(product.specs)
  const specsHtml =
    specs.length > 0
      ? `<h3>Caractéristiques</h3><ul>${specs.map(([k, v]) => `<li><strong>${escapeHtml(k)}</strong> : ${escapeHtml(v)}</li>`).join("")}</ul>`
      : ""
  const full = `${product.longDescription ?? ""}${specsHtml}`.trim()
  if (!full) return null
  if (full.length <= MAX_LONG) return full
  // Too long as HTML: fall back to plain text rather than cutting a tag in half.
  // Escaping and paragraph tags lengthen the text, so shrink until it fits.
  const plain = htmlToText(full) ?? ""
  for (let budget = MAX_LONG; budget > 0; ) {
    const text = truncate(plain, budget)
    if (!text) return null
    const html = `<p>${escapeHtml(text).replace(/\n/g, "</p><p>")}</p>`
    if (html.length <= MAX_LONG) return html
    budget -= html.length - MAX_LONG + 1
  }
  return null
}

function ruleHaystack(product: CollectedProduct, field: SupplierConfig["rules"][number]["field"]): string {
  if (field === "name") return product.name
  if (field === "supplierLegalClass") return product.supplierLegalClass ?? ""
  return product.sourceCategory ?? ""
}

function applyRules(product: CollectedProduct, rules: SupplierConfig["rules"], categories: Category[]) {
  let category: string | null = null
  let legalCategory: LegalCategory | null = null
  for (const rule of rules) {
    if (category !== null && legalCategory !== null) break
    if (!new RegExp(rule.match, "i").test(ruleHaystack(product, rule.field))) continue
    if (category === null && rule.category) {
      category = categories.find((c) => c.slug === rule.category || c.name === rule.category)?.name ?? rule.category
    }
    if (legalCategory === null && rule.legalCategory) legalCategory = rule.legalCategory
  }
  return { category, legalCategory }
}

const legalLabel = (l: LegalCategory | null) => (l === null ? null : l === "none" ? "Aucune" : l)

export function buildTriageModel(batches: SupplierBatch[], categories: Category[]): TriageModel {
  const rows: TriageRow[] = []
  const orphans: OrphanPrice[] = []
  const stats: Record<ReconcileStatus, number> = { matched: 0, no_price: 0, ambiguous: 0 }

  for (const batch of batches) {
    const { rows: reconciled, orphanPrices } = reconcileCatalog(batch.products, batch.prices ?? [])
    // Priced articles first: they are the ones the client can import right away.
    const ordered = [...reconciled].sort((a, b) => Number(b.status === "matched") - Number(a.status === "matched"))
    for (const { product, price, status } of ordered) {
      stats[status]++
      const proposal = applyRules(product, batch.config.rules, categories)
      const cost = price?.price ?? null
      rows.push({
        import: null,
        supplier: batch.supplier,
        supplierSku: product.supplierSku,
        ean: product.ean ?? price?.ean ?? null,
        name: product.name,
        brand: product.brand ?? null,
        category: proposal.category,
        legalCategory: legalLabel(proposal.legalCategory),
        supplierLegalClass: product.supplierLegalClass ?? null,
        costPriceHt: cost,
        priceHt: cost === null ? null : proposeSalePriceHt(cost, batch.config.marginPct),
        vatPct: 20,
        stockQty: null,
        description: truncate(cleanText(product.description) ?? htmlToText(product.longDescription), MAX_SHORT) ?? null,
        longDescription: longDescription(product),
        imageUrls: product.imageUrls.join("\n") || null,
        sourceCategory: product.sourceCategory ?? null,
        sourceUrl: product.sourceUrl,
        matchStatus: STATUS_LABELS[status],
        sku: null,
      })
    }
    for (const p of orphanPrices)
      orphans.push({ supplier: batch.supplier, ref: p.ref, ean: p.ean, price: p.price, line: p.line })
  }
  return { rows, orphans, stats }
}

// --- Workbook --------------------------------------------------------------

const README = [
  "Fichier de tri — import des catalogues fournisseurs",
  "",
  "1. Onglet « À trier » : une ligne par article. Mettez « oui » dans la colonne Importer pour chaque article à reprendre.",
  "2. Pour chaque ligne retenue, vérifiez la Catégorie et renseignez la Catégorie légale (A, B, C, D ou Aucune).",
  "   La colonne « Classement fournisseur » rappelle le classement annoncé par le fournisseur, quand il en donne un.",
  "   ⚠️ La catégorie légale n'est JAMAIS déduite par l'outil : elle n'est pré-remplie que par une règle écrite à la main",
  "   (par exemple « classement fournisseur commençant par B → B »). Vérifiez-la ; une ligne retenue sans elle sera refusée à l'import.",
  "3. Le prix de vente HT est proposé à partir du prix d'achat et de la marge du fournisseur : ajustez-le librement.",
  "4. Les lignes « Sans prix » n'ont pas été trouvées dans le tarif : saisissez un prix de vente pour les importer.",
  "5. L'onglet « Prix sans fiche » liste les références du tarif dont aucune fiche n'a été récupérée.",
  "6. Colonne Actif : « oui » met le produit en ligne dès l'import ; laissée vide, il arrive hors ligne, à publier après relecture.",
  "",
  "7. Le fournisseur doit exister dans l'administration (Catalogue → Fournisseurs), sous le nom de la colonne Fournisseur,",
  "   avant l'import : une ligne d'un fournisseur inconnu est refusée.",
  "",
  "Ne renommez pas les colonnes. Enregistrez au format .xlsx, puis déposez le fichier dans l'administration :",
  "Import catalogues → Prévisualiser → Importer. Rien n'est écrit avant que vous ayez validé l'aperçu.",
]

/** The triage workbook, ready to be written to disk. */
export async function writeTriageWorkbook(model: TriageModel, categories: Category[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = "SCS Firearm — collecte catalogues"
  wb.created = new Date()

  // No supplier drop-down: this tool never sees the site's database. The import
  // checks the name against the declared suppliers instead.
  addCatalogSheet(wb, "À trier", model.rows, { categoryNames: categories.map((category) => category.name) })

  const orphans = wb.addWorksheet("Prix sans fiche", { views: [{ state: "frozen", ySplit: 1 }] })
  orphans.columns = [
    { header: "Fournisseur", key: "supplier", width: 18 },
    { header: "Réf. fournisseur", key: "ref", width: 18 },
    { header: "EAN", key: "ean", width: 15 },
    { header: "Prix d'achat HT", key: "price", width: 14, style: { numFmt: "#,##0.00 €" } },
    { header: "Ligne du tarif", key: "line", width: 12 },
  ]
  orphans.getRow(1).font = { bold: true }
  for (const o of model.orphans) orphans.addRow(o)

  const readme = wb.addWorksheet("Lisez-moi")
  readme.getColumn(1).width = 120
  README.forEach((line, i) => {
    readme.getCell(i + 1, 1).value = line
  })
  readme.getCell(1, 1).font = { bold: true, size: 14 }
  readme.addRow([])
  readme.addRow([
    `${model.rows.length} articles : ${model.stats.matched} rapprochés, ${model.stats.no_price} sans prix, ${model.stats.ambiguous} ambigus ; ${model.orphans.length} prix sans fiche.`,
  ])

  return Buffer.from(await wb.xlsx.writeBuffer())
}
