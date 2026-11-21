import { and, eq } from "drizzle-orm"
import { type DbExecutor, db } from "../db/client.js"
import { productSubcategories } from "../db/schema.js"

/**
 * Story 12.15a — the id of a subcategory, only if it belongs to the category:
 * null otherwise, for the caller to refuse rather than let the database's
 * (subcategory, category) key answer with a 500.
 */
export async function subcategoryIdIn(categoryId: string, slug: string, tx: DbExecutor = db): Promise<string | null> {
  const [row] = await tx
    .select({ id: productSubcategories.id })
    .from(productSubcategories)
    .where(and(eq(productSubcategories.slug, slug), eq(productSubcategories.categoryId, categoryId)))
    .limit(1)
  return row?.id ?? null
}

export const unknownSubcategoryMessage = (slug: string) => `Unknown subcategory for this category: ${slug}`
