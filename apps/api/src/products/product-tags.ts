// The one way a product's tags are written: the product form, the collection
// weapon form and the catalogue import all set the whole list at once.

import { eq, inArray } from "drizzle-orm"
import type { DbExecutor } from "../artworks/reservation.js"
import { db } from "../db/client.js"
import { productTags, tags } from "../db/schema.js"

/** The product's tags become exactly `tagIds`. */
export async function replaceProductTags(productId: string, tagIds: string[], tx: DbExecutor = db): Promise<void> {
  await tx.delete(productTags).where(eq(productTags.productId, productId))
  if (tagIds.length === 0) return
  await tx
    .insert(productTags)
    .values(tagIds.map((tagId) => ({ productId, tagId })))
    .onConflictDoNothing()
}

/** Same, from slugs; a slug that matches no tag is ignored. */
export async function replaceProductTagsBySlug(productId: string, slugs: string[], tx: DbExecutor = db): Promise<void> {
  const rows = slugs.length > 0 ? await tx.select({ id: tags.id }).from(tags).where(inArray(tags.slug, slugs)) : []
  await replaceProductTags(
    productId,
    rows.map((row) => row.id),
    tx,
  )
}
