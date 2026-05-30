import { computePriceTtc, productFiltersSchema } from "@armurier/shared"
import { and, asc, desc, eq, gte, lte, type SQL, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { legalCategories, productCategories, products } from "../db/schema.js"

export const listProductsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (request, reply) => {
    const parsed = productFiltersSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error: "ValidationError",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      })
    }

    const { category, legalCategory, search, minPrice, maxPrice, page, limit } = parsed.data

    // Only published products are publicly listable
    const conditions: SQL[] = [eq(products.published, true)]
    if (category) conditions.push(eq(productCategories.slug, category))
    if (legalCategory) conditions.push(eq(legalCategories.category, legalCategory))
    if (minPrice !== undefined) conditions.push(gte(products.priceHt, minPrice.toString()))
    if (maxPrice !== undefined) conditions.push(lte(products.priceHt, maxPrice.toString()))
    if (search) {
      conditions.push(sql`${products.searchVector} @@ websearch_to_tsquery('french', ${search})`)
    }

    const where = and(...conditions)

    // Search results are ranked by relevance; otherwise featured first, then newest
    const orderBy = search
      ? [
          desc(sql`ts_rank(${products.searchVector}, websearch_to_tsquery('french', ${search}))`),
          desc(products.createdAt),
        ]
      : [desc(products.featured), desc(products.createdAt)]

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(products)
      .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
      .leftJoin(legalCategories, eq(products.legalCategoryId, legalCategories.id))
      .where(where)

    const rows = await db
      .select({
        id: products.id,
        sku: products.sku,
        slug: products.slug,
        name: products.name,
        description: products.description,
        priceHt: products.priceHt,
        vatPct: products.vatPct,
        stockQty: products.stockQty,
        featured: products.featured,
        requiresLegalVerification: products.requiresLegalVerification,
        featuredImageUrl: products.featuredImageUrl,
        categorySlug: productCategories.slug,
        categoryName: productCategories.name,
        legalCategory: legalCategories.category,
        createdAt: products.createdAt,
      })
      .from(products)
      .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
      .leftJoin(legalCategories, eq(products.legalCategoryId, legalCategories.id))
      .where(where)
      .orderBy(...orderBy, asc(products.id))
      .limit(limit)
      .offset((page - 1) * limit)

    const data = rows.map((r) => {
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
        featured: r.featured,
        requiresLegalVerification: r.requiresLegalVerification,
        featuredImageUrl: r.featuredImageUrl,
        category: { slug: r.categorySlug, name: r.categoryName },
        legalCategory: r.legalCategory,
        createdAt: r.createdAt,
      }
    })

    return reply.code(200).send({
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    })
  })
}
