// Catalogue export (story 12.4) — the other half of the round trip: the
// products the import manages, written in the import's own columns, to edit
// in Excel and bring back through preview → import.
//
// Only products with a supplier AND a supplier reference are exported: that
// pair is the key the import matches on. Archived products, Gun Art and
// collection pieces stay out — they have their own screens.

import { slugify } from "@armurier/shared"
import {
  type CatalogSheetLists,
  type CatalogSheetRow,
  catalogSheetCsv,
  writeCatalogWorkbook,
} from "@armurier/shared/spreadsheet"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { db } from "../db/client.js"
import {
  ancientWeapons,
  artworks,
  legalCategories,
  productCategories,
  productSubcategories,
  products,
  suppliers,
} from "../db/schema.js"
import { productTagsJson } from "../products/tag-filter.js"

const EXCLUDED_CATEGORY_SLUG = "gun-art"

interface ExportedProduct {
  id: string
  supplier: string
  supplierSku: string
  ean: string | null
  name: string
  brand: string | null
  sku: string
  published: boolean
}

/**
 * The same product sold by two suppliers rarely shares a reference: it is
 * spotted by EAN, or by the same set of words in brand + name. Flagged for a
 * human, never resolved.
 */
export function findPossibleDuplicates(rows: ExportedProduct[]): Map<string, string> {
  const groups = new Map<string, ExportedProduct[]>()
  const add = (key: string, row: ExportedProduct) => groups.set(key, [...(groups.get(key) ?? []), row])
  for (const row of rows) {
    if (row.ean) add(`ean:${row.ean}`, row)
    const words = [
      ...new Set(
        slugify(`${row.brand ?? ""} ${row.name}`)
          .split("-")
          .filter(Boolean),
      ),
    ].sort()
    if (words.length >= 2) add(`words:${words.join("-")}`, row)
  }
  const others = new Map<string, Map<string, ExportedProduct>>()
  for (const group of groups.values()) {
    for (const row of group) {
      for (const other of group) {
        if (other.supplier === row.supplier) continue
        const mine = others.get(row.id) ?? new Map<string, ExportedProduct>()
        mine.set(other.id, other)
        others.set(row.id, mine)
      }
    }
  }
  const labels = new Map<string, string>()
  for (const [id, mine] of others) {
    labels.set(
      id,
      [...mine.values()]
        .map((o) => `${o.supplier} ${o.supplierSku} (${o.published ? "actif" : "inactif"})`)
        .join(" ; "),
    )
  }
  return labels
}

const legalLabel = (category: string | null) => (category === null ? null : category === "none" ? "Aucune" : category)

const README = [
  "Catalogue — export pour modification dans Excel",
  "",
  "Une ligne par produit. Modifiez les cellules, ajoutez des lignes pour de nouveaux produits, puis déposez le fichier dans",
  "l'administration : Import catalogues → Prévisualiser → Importer. Rien n'est écrit avant que vous ayez validé l'aperçu.",
  "",
  "• Actif : « oui » met le produit en ligne, « non » le retire de la vente, vide ne change rien.",
  "• Même produit chez deux fournisseurs : gardez les deux lignes, une « oui », l'autre « non ».",
  "  La colonne « Doublon possible » signale les fiches qui se ressemblent (même EAN, ou mêmes mots) : à vérifier, rien n'est décidé pour vous.",
  "• Supprimer une ligne : le produit est ARCHIVÉ (jamais effacé) seulement si vous cochez « Archiver les produits absents du",
  "  fichier » à l'import, et seulement pour les fournisseurs présents dans le fichier. Il se réactive depuis l'écran Produits.",
  "• Pour que vos prix et textes remplacent ceux du site, cochez « Écraser » à l'import ; sinon seuls les champs vides sont remplis.",
  "• Sous-catégorie : choisissez-en une de la catégorie de la ligne (Carabines pour une arme longue…). Vide ne change rien,",
  "  « Aucune » la retire. L'import refuse une sous-catégorie qui n'appartient pas à la catégorie.",
  "• Le stock n'est pas dans ce fichier : il bouge avec les ventes, un fichier ne le modifie jamais.",
  "• Fournisseur : choisissez-le dans la liste. Un nouveau fournisseur se crée d'abord dans l'administration",
  "  (Catalogue → Fournisseurs) : l'import refuse une ligne d'un fournisseur inconnu.",
  "• Ne modifiez pas les colonnes Fournisseur, Réf. fournisseur et Version des lignes existantes : elles relient chaque ligne à son produit.",
  "  Si une fiche a été modifiée sur le site après cet export, l'import le signale au lieu d'écraser la correction.",
]

/** What the export covers: products with a supplier key, not archived, not managed elsewhere. */
const exportable = () =>
  and(
    sql`${products.supplierSku} is not null`,
    isNull(products.archivedAt),
    sql`${productCategories.slug} <> ${EXCLUDED_CATEGORY_SLUG}`,
    sql`not exists (select 1 from ${artworks} where ${artworks.productId} = ${products.id})`,
    sql`not exists (select 1 from ${ancientWeapons} where ${ancientWeapons.productId} = ${products.id})`,
  )

/** Every declared supplier, alphabetically — the Fournisseur drop-down of the export. */
const declaredSuppliers = () =>
  db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .orderBy(asc(sql`lower(${suppliers.name})`))

/**
 * Every supplier, for the per-supplier choice, with how many products its file
 * would hold. One without any still gets a file: a blank one to fill in, which
 * is how a new supplier's catalogue starts (story 12.5).
 */
export async function exportableSuppliers(): Promise<{ id: string; name: string; products: number }[]> {
  const counts = await db
    .select({ supplierId: products.supplierId, products: sql<number>`count(*)::int` })
    .from(products)
    .innerJoin(productCategories, eq(productCategories.id, products.categoryId))
    .where(exportable())
    .groupBy(products.supplierId)
  const countBySupplier = new Map(counts.map((count) => [count.supplierId, count.products]))
  const all = await declaredSuppliers()
  return all.map((supplier) => ({ ...supplier, products: countBySupplier.get(supplier.id) ?? 0 }))
}

type ExportRow = Awaited<ReturnType<typeof loadExportRows>>[number]

/** Every exportable product: duplicates are looked for across all suppliers. */
async function loadExportRows() {
  return db
    .select({
      id: products.id,
      supplierId: suppliers.id,
      supplier: suppliers.name,
      supplierSku: sql<string>`${products.supplierSku}`,
      ean: products.ean,
      name: products.name,
      brand: products.brand,
      category: productCategories.name,
      subcategory: productSubcategories.name,
      legalCategory: legalCategories.category,
      costPrice: products.costPrice,
      priceHt: products.priceHt,
      vatPct: products.vatPct,
      description: products.description,
      longDescription: products.longDescription,
      sourceUrl: products.sourceUrl,
      sku: products.sku,
      published: sql<boolean>`coalesce(${products.published}, false)`,
      audience: products.audience,
      updatedAt: products.updatedAt,
      // Story 12.13: written back so the round trip keeps them.
      tags: productTagsJson,
    })
    .from(products)
    .innerJoin(suppliers, eq(suppliers.id, products.supplierId))
    .innerJoin(productCategories, eq(productCategories.id, products.categoryId))
    .leftJoin(productSubcategories, eq(productSubcategories.id, products.subcategoryId))
    .leftJoin(legalCategories, eq(legalCategories.id, products.legalCategoryId))
    .where(exportable())
    .orderBy(asc(suppliers.name), asc(products.name))
}

/** Products entered by hand: no key for the round trip, so the export says they are missing. */
async function countManualProducts(): Promise<number> {
  const [{ manual } = { manual: 0 }] = await db
    .select({ manual: sql<number>`count(*)::int` })
    .from(products)
    .where(
      and(
        isNull(products.archivedAt),
        sql`(${products.supplierId} is null or ${products.supplierSku} is null)`,
        sql`not exists (select 1 from ${artworks} where ${artworks.productId} = ${products.id})`,
        sql`not exists (select 1 from ${ancientWeapons} where ${ancientWeapons.productId} = ${products.id})`,
      ),
    )
  return manual
}

const money = (value: string | null) => (value === null ? null : Number(value))

function toSheetRow(row: ExportRow, duplicates: Map<string, string>): CatalogSheetRow {
  return {
    import: "oui",
    active: row.published ? "oui" : "non",
    proOnly: row.audience === "pro" ? "oui" : "non",
    supplier: row.supplier,
    supplierSku: row.supplierSku,
    ean: row.ean,
    name: row.name,
    brand: row.brand,
    category: row.category,
    subcategory: row.subcategory,
    legalCategory: legalLabel(row.legalCategory),
    costPriceHt: money(row.costPrice),
    priceHt: money(row.priceHt),
    vatPct: money(row.vatPct),
    description: row.description,
    longDescription: row.longDescription,
    sourceUrl: row.sourceUrl,
    sku: row.sku,
    // Slugs, not names: a name may hold a separator and split on re-import.
    tags: row.tags.map((tag) => tag.slug).join(", ") || null,
    duplicates: duplicates.get(row.id) ?? null,
    version: row.updatedAt?.toISOString() ?? null,
  }
}

/** The drop-down lists of the workbook: categories, suppliers, subcategories. */
async function sheetLists(supplierList: { name: string }[]): Promise<CatalogSheetLists> {
  const categories = await db
    .select({ name: productCategories.name, slug: productCategories.slug })
    .from(productCategories)
    .orderBy(asc(productCategories.name))
  const subcategories = await db
    .select({ name: productSubcategories.name })
    .from(productSubcategories)
    .innerJoin(productCategories, eq(productCategories.id, productSubcategories.categoryId))
    .orderBy(asc(productCategories.displayOrder), asc(productSubcategories.displayOrder))
  return {
    categoryNames: categories
      .filter((category) => category.slug !== EXCLUDED_CATEGORY_SLUG)
      .map((category) => category.name),
    supplierNames: supplierList.map((supplier) => supplier.name),
    subcategoryNames: subcategories.map((subcategory) => subcategory.name),
  }
}

function exportSummary(count: number, flagged: number, manual: number, supplierName?: string): string[] {
  const scope = supplierName ? ` (${supplierName})` : ""
  const summary = [`${count} produits exportés${scope}, ${flagged} avec un doublon possible.`]
  // A supplier's file is not about hand-made products: only the full export mentions them.
  if (manual > 0 && !supplierName) {
    summary.push(
      `${manual} produits saisis à la main (sans fournisseur ou sans référence fournisseur) ne figurent pas ici : ils se modifient depuis l'écran Produits.`,
    )
  }
  return summary
}

interface ExportOptions {
  supplierId?: string
}

/**
 * The whole catalogue, or one supplier's part of it. Duplicates are always
 * looked for across EVERY supplier: the point is to see, in a BGM file, that
 * Cor Caroli sells the same thing.
 */
async function catalogExportRows(options: ExportOptions) {
  const all = await loadExportRows()
  const rows = options.supplierId ? all.filter((row) => row.supplierId === options.supplierId) : all
  const duplicates = findPossibleDuplicates(all)
  return { rows, duplicates, sheetRows: rows.map((row) => toSheetRow(row, duplicates)) }
}

export async function exportCatalogWorkbook(options: ExportOptions = {}): Promise<{ workbook: Buffer; rows: number }> {
  const { rows, duplicates, sheetRows } = await catalogExportRows(options)
  const supplierList = await declaredSuppliers()
  const chosen = supplierList.find((supplier) => supplier.id === options.supplierId)
  const flagged = rows.filter((row) => duplicates.has(row.id)).length
  const manual = options.supplierId ? 0 : await countManualProducts()
  const workbook = await writeCatalogWorkbook({
    creator: "SCS Firearms — export du catalogue",
    sheetName: "Catalogue",
    rows: sheetRows,
    lists: await sheetLists(supplierList),
    readme: [...README, "", ...exportSummary(rows.length, flagged, manual, chosen?.name)],
  })
  return { workbook, rows: rows.length }
}

/** Story 12.16d — the same rows as CSV: no drop-downs and no read-me, which a CSV cannot hold. */
export async function exportCatalogCsv(options: ExportOptions = {}): Promise<{ csv: Buffer; rows: number }> {
  const { rows, sheetRows } = await catalogExportRows(options)
  return { csv: Buffer.from(catalogSheetCsv(sheetRows), "utf8"), rows: rows.length }
}
