// Story 12.15a — the « Sous-catégorie » column of the triage workbook: a whole
// supplier catalogue lands in the menu's subcategories without filing each
// product by hand. Subcategories are reference data, never created by an import.

import { normaliseHeader } from "@armurier/shared"
import { db } from "../db/client.js"
import { productCategories, productSubcategories } from "../db/schema.js"

interface SubcategorisableRow {
  action: string
  data: { subcategory: string | false | null } | null
  categoryId: string | null
  existing: { categoryId: string } | null
  /** Undefined: left as it is. Null: taken off. */
  subcategoryId?: string | null
}

/**
 * The category the subcategory is read in: the sheet's, unless an update
 * without overwrite keeps the product's own (the import then leaves it).
 */
function targetCategoryId(row: SubcategorisableRow, overwrite: boolean): string | null {
  return row.action === "update" && !overwrite && row.existing ? row.existing.categoryId : row.categoryId
}

/**
 * Resolve each row's subcategory (by slug, or by name whatever the case and
 * accents) within its category. A blank cell leaves an existing product's
 * subcategory, except when an overwrite moves it to another category, which
 * the old one does not belong to.
 */
export async function resolveImportSubcategories<Row extends SubcategorisableRow>(
  rows: Row[],
  overwrite: boolean,
  invalidate: (row: Row, message: string) => void,
): Promise<void> {
  const [subcategories, categories] = await Promise.all([
    db
      .select({
        id: productSubcategories.id,
        categoryId: productSubcategories.categoryId,
        slug: productSubcategories.slug,
        name: productSubcategories.name,
      })
      .from(productSubcategories),
    db.select({ id: productCategories.id, name: productCategories.name }).from(productCategories),
  ])
  const idByKey = new Map<string, string>()
  for (const sub of subcategories) {
    idByKey.set(`${sub.categoryId}|${sub.slug}`, sub.id)
    idByKey.set(`${sub.categoryId}|${normaliseHeader(sub.name)}`, sub.id)
  }
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))

  for (const row of rows) {
    const cell = row.data?.subcategory ?? null
    const categoryId = targetCategoryId(row, overwrite)
    if (cell === false) row.subcategoryId = null
    else if (cell !== null && categoryId) {
      const id =
        idByKey.get(`${categoryId}|${cell.toLowerCase()}`) ?? idByKey.get(`${categoryId}|${normaliseHeader(cell)}`)
      if (id) row.subcategoryId = id
      else invalidate(row, `Sous-catégorie inconnue pour « ${categoryName.get(categoryId)} » : « ${cell} »`)
    } else if (row.existing && categoryId !== row.existing.categoryId) row.subcategoryId = null
  }
}
