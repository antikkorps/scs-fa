import { computePriceTtc, searchQuerySchema } from "@armurier/shared"
import { and, desc, eq, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { artworkPrints, artworks, legalCategories, productCategories, products } from "../db/schema.js"

// Aggregated availability/price-from for artwork cards (mirrors artworks/public.ts).
const AVAILABLE_COUNT = sql<number>`count(${artworkPrints.id}) filter (where ${artworkPrints.status} = 'available')::int`
const SOLD_COUNT = sql<number>`count(${artworkPrints.id}) filter (where ${artworkPrints.status} = 'sold')::int`
const PRICE_FROM = sql<
  string | null
>`min(${artworkPrints.priceHtUnit}) filter (where ${artworkPrints.status} = 'available')`

/**
 * GET /api/search?q=… — global full-text search across the firearms catalogue
 * (products) and the Gun Art collection (artworks). Both sources are matched on
 * their generated `search_vector` and ranked by relevance; `limit` caps each
 * source independently. Only published items are returned.
 */
export const globalSearchRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error: "ValidationError",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      })
    }

    const { q, limit } = parsed.data
    const tsquery = sql`websearch_to_tsquery('french', ${q})`

    const productRows = await db
      .select({
        id: products.id,
        sku: products.sku,
        slug: products.slug,
        name: products.name,
        description: products.description,
        priceHt: products.priceHt,
        vatPct: products.vatPct,
        stockQty: products.stockQty,
        requiresLegalVerification: products.requiresLegalVerification,
        featuredImageUrl: products.featuredImageUrl,
        categorySlug: productCategories.slug,
        categoryName: productCategories.name,
        legalCategory: legalCategories.category,
      })
      .from(products)
      .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
      .leftJoin(legalCategories, eq(products.legalCategoryId, legalCategories.id))
      .where(
        and(
          eq(products.published, true),
          // Products that back a Gun Art piece surface as artworks, not as
          // standalone catalogue results — avoid showing the same item twice.
          sql`not exists (select 1 from ${artworks} where ${artworks.productId} = ${products.id})`,
          sql`${products.searchVector} @@ ${tsquery}`,
        ),
      )
      .orderBy(desc(sql`ts_rank(${products.searchVector}, ${tsquery})`), desc(products.createdAt))
      .limit(limit)

    const artworkRows = await db
      .select({
        id: artworks.id,
        slug: artworks.slug,
        title: artworks.title,
        artistName: artworks.artistName,
        description: artworks.description,
        featuredImageUrl: artworks.featuredImageUrl,
        editionLimit: artworks.editionLimit,
        editionYear: artworks.editionYear,
        vatPct: artworks.vatPct,
        availableCount: AVAILABLE_COUNT,
        soldCount: SOLD_COUNT,
        priceFromHt: PRICE_FROM,
      })
      .from(artworks)
      .leftJoin(artworkPrints, eq(artworkPrints.artworkId, artworks.id))
      .where(and(eq(artworks.published, true), sql`${artworks.searchVector} @@ ${tsquery}`))
      .groupBy(artworks.id)
      .orderBy(desc(sql`ts_rank(${artworks.searchVector}, ${tsquery})`), desc(artworks.createdAt))
      .limit(limit)

    const productData = productRows.map((r) => {
      const priceHt = Number(r.priceHt)
      const vatPct = Number(r.vatPct ?? 0)
      return {
        id: r.id,
        sku: r.sku,
        slug: r.slug,
        name: r.name,
        description: r.description,
        priceHt,
        vatPct,
        priceTtc: computePriceTtc(priceHt, vatPct),
        stockQty: r.stockQty,
        requiresLegalVerification: r.requiresLegalVerification,
        featuredImageUrl: r.featuredImageUrl,
        category: { slug: r.categorySlug, name: r.categoryName },
        legalCategory: r.legalCategory,
      }
    })

    const artworkData = artworkRows.map((r) => {
      const vatPct = Number(r.vatPct ?? 20)
      const priceFromHt = r.priceFromHt === null ? null : Number(r.priceFromHt)
      return {
        id: r.id,
        slug: r.slug,
        title: r.title,
        artistName: r.artistName,
        description: r.description,
        featuredImageUrl: r.featuredImageUrl,
        editionLimit: r.editionLimit,
        editionYear: r.editionYear,
        availableCount: r.availableCount,
        soldCount: r.soldCount,
        priceFromHt,
        priceFromTtc: priceFromHt === null ? null : computePriceTtc(priceFromHt, vatPct),
      }
    })

    return reply.code(200).send({
      query: q,
      products: productData,
      artworks: artworkData,
    })
  })
}
