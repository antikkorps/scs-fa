import { and, eq, exists, inArray, type SQL, sql } from "drizzle-orm"
import { db } from "../db/client.js"
import { products, productTags, tags } from "../db/schema.js"

/**
 * Translate a tag selection into WHERE conditions, with faceted semantics:
 * **OR within a facet, AND across facets**.
 *
 * Ticking a second tag in the same facet therefore widens the result ("occasion
 * or historique"), while adding a tag from another facet narrows it ("…and made
 * before 1900"). That is what shoppers expect from a facet panel, and it is why
 * the facet has to be read from the database rather than inferred from the URL.
 *
 * Each facet contributes one EXISTS sub-query against the pivot, which the
 * composite primary key and `idx_product_tags_tag` both serve.
 *
 * Unknown slugs are **ignored, not rejected**: tags can be renamed or deleted
 * from the backoffice, and an indexed URL carrying a stale slug should keep
 * returning the catalogue rather than a 400. A selection that resolves to
 * nothing therefore behaves like no tag filter at all.
 */
export async function buildTagFilterConditions(slugs: string[]): Promise<SQL[]> {
  if (slugs.length === 0) return []

  const rows = await db.select({ id: tags.id, facet: tags.facet }).from(tags).where(inArray(tags.slug, slugs))
  if (rows.length === 0) return []

  const idsByFacet = new Map<string, string[]>()
  for (const row of rows) {
    const ids = idsByFacet.get(row.facet)
    if (ids) ids.push(row.id)
    else idsByFacet.set(row.facet, [row.id])
  }

  return [...idsByFacet.values()].map((ids) =>
    exists(
      db
        .select({ one: sql`1` })
        .from(productTags)
        .where(and(eq(productTags.productId, products.id), inArray(productTags.tagId, ids))),
    ),
  )
}

/**
 * Correlated aggregate returning a product's tags as JSON, so a listing or a
 * detail page can render its badges without a second round trip or an N+1.
 * Ordered by `display_order` then name, so the backoffice controls the order.
 */
export const productTagsJson = sql<Array<{ slug: string; name: string; facet: string }>>`
  coalesce(
    (
      select json_agg(json_build_object('slug', t.slug, 'name', t.name, 'facet', t.facet)
             order by t.display_order, t.name)
      from product_tags pt
      join tags t on t.id = pt.tag_id
      where pt.product_id = ${products.id}
    ),
    '[]'::json
  )
`
