import { ancientWeaponFiltersSchema, computePriceTtc } from "@armurier/shared"
import { and, asc, desc, eq, gt, type SQL, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { ancientWeapons, legalCategories, productCategories, products } from "../db/schema.js"
import { buildTagFilterConditions, productTagsJson } from "../products/tag-filter.js"

/**
 * GET /api/ancient-weapons — the collection universe listing.
 *
 * These weapons also appear in the main catalogue (`/api/products`): the tags
 * added in story 11.1 are what let a piece be both a catalogue item and part of
 * this universe. This endpoint exists because the listing needs the historical
 * fields — period, maker, provenance, condition — which the generic catalogue
 * has no business carrying.
 *
 * Sold pieces are deliberately still returned (story 11.3 will mark them):
 * a sold historical weapon keeps its editorial and SEO value, and shows the
 * house is active. `available` says whether it can still be bought.
 */
export const ancientWeaponRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (request, reply) => {
    const parsed = ancientWeaponFiltersSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error: "ValidationError",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      })
    }

    const { tags: tagSlugs, legalCategory, available, page, limit } = parsed.data

    // The inner join on ancient_weapons is what restricts this to collection pieces.
    const conditions: SQL[] = [eq(products.published, true)]
    if (legalCategory) conditions.push(eq(legalCategories.category, legalCategory))
    if (tagSlugs) conditions.push(...(await buildTagFilterConditions(tagSlugs)))
    if (available === true) conditions.push(gt(products.stockQty, 0))
    if (available === false) conditions.push(sql`coalesce(${products.stockQty}, 0) = 0`)

    const where = and(...conditions)

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(products)
      .innerJoin(ancientWeapons, eq(ancientWeapons.productId, products.id))
      .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
      .leftJoin(legalCategories, eq(products.legalCategoryId, legalCategories.id))
      .where(where)

    const rows = await db
      .select({
        id: products.id,
        slug: products.slug,
        name: products.name,
        description: products.description,
        priceHt: products.priceHt,
        vatPct: products.vatPct,
        stockQty: products.stockQty,
        featured: products.featured,
        featuredImageUrl: products.featuredImageUrl,
        categorySlug: productCategories.slug,
        categoryName: productCategories.name,
        legalCategory: legalCategories.category,
        tags: productTagsJson,
        period: ancientWeapons.period,
        periodStartYear: ancientWeapons.periodStartYear,
        makerName: ancientWeapons.makerName,
        condition: ancientWeapons.condition,
        isAuthentic: ancientWeapons.isAuthentic,
        createdAt: products.createdAt,
      })
      .from(products)
      .innerJoin(ancientWeapons, eq(ancientWeapons.productId, products.id))
      .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
      .leftJoin(legalCategories, eq(products.legalCategoryId, legalCategories.id))
      .where(where)
      // Available first — a visitor should meet what they can still buy before
      // what is already gone — then featured, then oldest pieces first.
      .orderBy(
        desc(sql`coalesce(${products.stockQty}, 0) > 0`),
        desc(products.featured),
        asc(sql`coalesce(${ancientWeapons.periodStartYear}, 9999)`),
        asc(products.id),
      )
      .limit(limit)
      .offset((page - 1) * limit)

    const data = rows.map((r) => {
      const priceHt = Number(r.priceHt)
      const vatPct = Number(r.vatPct ?? 0)
      return {
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        priceHt,
        vatPct,
        priceTtc: computePriceTtc(priceHt, vatPct),
        available: (r.stockQty ?? 0) > 0,
        featured: r.featured,
        featuredImageUrl: r.featuredImageUrl,
        category: { slug: r.categorySlug, name: r.categoryName },
        legalCategory: r.legalCategory,
        tags: r.tags,
        period: r.period,
        periodStartYear: r.periodStartYear,
        makerName: r.makerName,
        condition: r.condition,
        isAuthentic: r.isAuthentic,
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
