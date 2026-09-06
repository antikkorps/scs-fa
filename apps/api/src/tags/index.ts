import { TAG_FACETS, type TagFacet } from "@armurier/shared"
import { and, asc, eq, ne, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { productCategories, products, productTags, tags } from "../db/schema.js"

type TagRow = {
  slug: string
  name: string
  facet: TagFacet
  description: string | null
  productCount: number
}

/**
 * GET /api/tags — the facet panel for the global catalogue.
 *
 * Returns every tag grouped by facet, each with the number of products it would
 * match. The count is scoped exactly like the catalogue listing (published, Gun
 * Art excluded), so a facet never advertises a result the listing won't show.
 *
 * Facets come back in the declared `TAG_FACETS` order, including the empty ones,
 * so the filter panel keeps a stable layout as the backoffice adds tags.
 */
export const tagRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (_request, reply) => {
    const rows = await db
      .select({
        slug: tags.slug,
        name: tags.name,
        facet: tags.facet,
        description: tags.description,
        // Counted through the same published/non-Gun-Art lens as the listing, so
        // a facet never advertises more results than the catalogue will show.
        // Built with the query builder rather than a raw string: it qualifies
        // the correlated `tags.id` reference, which a hand-written subquery
        // leaves ambiguous against the joined tables' own `id` columns.
        productCount: sql<number>`(${db
          .select({ count: sql`count(*)::int` })
          .from(productTags)
          .innerJoin(products, eq(products.id, productTags.productId))
          .innerJoin(productCategories, eq(productCategories.id, products.categoryId))
          .where(
            and(
              eq(productTags.tagId, tags.id),
              eq(products.published, true),
              ne(productCategories.category, "gun_art"),
            ),
          )})`,
      })
      .from(tags)
      .orderBy(asc(tags.displayOrder), asc(tags.name))

    const byFacet = new Map<TagFacet, TagRow[]>(TAG_FACETS.map((facet) => [facet, []]))
    for (const row of rows) {
      byFacet.get(row.facet)?.push(row)
    }

    return reply.code(200).send({
      data: TAG_FACETS.map((facet) => ({ facet, tags: byFacet.get(facet) ?? [] })),
    })
  })
}
