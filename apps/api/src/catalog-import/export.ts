// Catalogue export (story 12.4) — the other half of the round trip: the
// products the import manages, written in the import's own columns, to edit
// in Excel and bring back through preview → import.
//
// Only products with a supplier AND a supplier reference are exported: that
// pair is the key the import matches on. Archived products, Gun Art and
// collection pieces stay out — they have their own screens.

import { slugify } from "@armurier/shared"
import { type CatalogSheetRow, writeCatalogWorkbook } from "@armurier/shared/spreadsheet"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { db } from "../db/client.js"
import { ancientWeapons, artworks, legalCategories, productCategories, products, suppliers } from "../db/schema.js"

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

/**
 * Build the export workbook — the whole catalogue, or one supplier's part of
 * it. Duplicates are always looked for across EVERY supplier: the point is to
 * see, in a BGM file, that Cor Caroli sells the same thing.
 */
export async function exportCatalogWorkbook(
  options: { supplierId?: string } = {},
): Promise<{ workbook: Buffer; rows: number }> {
  const all = await db
    .select({
      id: products.id,
      supplierId: suppliers.id,
      supplier: suppliers.name,
      supplierSku: sql<string>`${products.supplierSku}`,
      ean: products.ean,
      name: products.name,
      brand: products.brand,
      category: productCategories.name,
      legalCategory: legalCategories.category,
      costPrice: products.costPrice,
      priceHt: products.priceHt,
      vatPct: products.vatPct,
      description: products.description,
      longDescription: products.longDescription,
      sourceUrl: products.sourceUrl,
      sku: products.sku,
      published: sql<boolean>`coalesce(${products.published}, false)`,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .innerJoin(suppliers, eq(suppliers.id, products.supplierId))
    .innerJoin(productCategories, eq(productCategories.id, products.categoryId))
    .leftJoin(legalCategories, eq(legalCategories.id, products.legalCategoryId))
    .where(exportable())
    .orderBy(asc(suppliers.name), asc(products.name))
  const rows = options.supplierId ? all.filter((r) => r.supplierId === options.supplierId) : all

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

  const duplicates = findPossibleDuplicates(all)
  const money = (v: string | null) => (v === null ? null : Number(v))
  const sheetRows: CatalogSheetRow[] = rows.map((r) => ({
    import: "oui",
    active: r.published ? "oui" : "non",
    supplier: r.supplier,
    supplierSku: r.supplierSku,
    ean: r.ean,
    name: r.name,
    brand: r.brand,
    category: r.category,
    legalCategory: legalLabel(r.legalCategory),
    costPriceHt: money(r.costPrice),
    priceHt: money(r.priceHt),
    vatPct: money(r.vatPct),
    description: r.description,
    longDescription: r.longDescription,
    sourceUrl: r.sourceUrl,
    sku: r.sku,
    duplicates: duplicates.get(r.id) ?? null,
    version: r.updatedAt?.toISOString() ?? null,
  }))

  const categories = await db
    .select({ name: productCategories.name, slug: productCategories.slug })
    .from(productCategories)
    .orderBy(asc(productCategories.name))

  const supplierList = await declaredSuppliers()
  const chosenSupplier = supplierList.find((supplier) => supplier.id === options.supplierId)
  const flagged = rows.filter((r) => duplicates.has(r.id)).length
  const scope = chosenSupplier ? ` (${chosenSupplier.name})` : ""
  const summary = [`${rows.length} produits exportés${scope}, ${flagged} avec un doublon possible.`]
  // A supplier's file is not about hand-made products: only the full export mentions them.
  if (manual > 0 && !options.supplierId) {
    summary.push(
      `${manual} produits saisis à la main (sans fournisseur ou sans référence fournisseur) ne figurent pas ici : ils se modifient depuis l'écran Produits.`,
    )
  }
  const workbook = await writeCatalogWorkbook({
    creator: "SCS Firearm — export du catalogue",
    sheetName: "Catalogue",
    rows: sheetRows,
    lists: {
      categoryNames: categories
        .filter((category) => category.slug !== EXCLUDED_CATEGORY_SLUG)
        .map((category) => category.name),
      supplierNames: supplierList.map((supplier) => supplier.name),
    },
    readme: [...README, "", ...summary],
  })
  return { workbook, rows: rows.length }
}
