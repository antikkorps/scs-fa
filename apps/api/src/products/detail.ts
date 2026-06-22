import { computePriceTtc, productIdParamSchema } from "@armurier/shared"
import { and, eq, type SQL } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { legalCategories, productCategories, products } from "../db/schema.js"

// Shared lookup for a single published product (by id or by slug). Returns the
// public detail shape, or null when not found / unpublished.
async function fetchPublishedProduct(match: SQL) {
  const [row] = await db
    .select({
      id: products.id,
      sku: products.sku,
      slug: products.slug,
      name: products.name,
      description: products.description,
      longDescription: products.longDescription,
      priceHt: products.priceHt,
      vatPct: products.vatPct,
      stockQty: products.stockQty,
      featured: products.featured,
      requiresLegalVerification: products.requiresLegalVerification,
      ageMinRequired: products.ageMinRequired,
      hasAccessoryRestrictions: products.hasAccessoryRestrictions,
      accessoryRestrictionNotes: products.accessoryRestrictionNotes,
      featuredImageUrl: products.featuredImageUrl,
      imagesCount: products.imagesCount,
      metaTitle: products.metaTitle,
      metaDescription: products.metaDescription,
      keywords: products.keywords,
      categorySlug: productCategories.slug,
      categoryName: productCategories.name,
      legalCategoryCode: legalCategories.category,
      legalCategoryName: legalCategories.name,
      legalCategoryDescription: legalCategories.description,
      legalCategoryRequiresVerification: legalCategories.requiresVerification,
      legalCategoryMinAge: legalCategories.minAge,
      legalCategoryRequiredDocTypes: legalCategories.requiredDocTypes,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
    .leftJoin(legalCategories, eq(products.legalCategoryId, legalCategories.id))
    // Only published products are publicly accessible
    .where(and(match, eq(products.published, true)))
    .limit(1)

  if (!row) return null

  const priceHt = Number(row.priceHt)
  const vatPct = Number(row.vatPct ?? 0)

  return {
    id: row.id,
    sku: row.sku,
    slug: row.slug,
    name: row.name,
    description: row.description,
    longDescription: row.longDescription,
    priceHt,
    vatPct,
    priceTtc: computePriceTtc(priceHt, vatPct),
    stockQty: row.stockQty,
    featured: row.featured,
    requiresLegalVerification: row.requiresLegalVerification,
    ageMinRequired: row.ageMinRequired,
    hasAccessoryRestrictions: row.hasAccessoryRestrictions,
    accessoryRestrictionNotes: row.accessoryRestrictionNotes,
    featuredImageUrl: row.featuredImageUrl,
    imagesCount: row.imagesCount,
    seo: {
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
      keywords: row.keywords,
    },
    category: { slug: row.categorySlug, name: row.categoryName },
    legalCategory: row.legalCategoryCode
      ? {
          category: row.legalCategoryCode,
          name: row.legalCategoryName,
          description: row.legalCategoryDescription,
          requiresVerification: row.legalCategoryRequiresVerification,
          minAge: row.legalCategoryMinAge,
          requiredDocTypes: row.legalCategoryRequiredDocTypes,
        }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export const getProductRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/:id", async (request, reply) => {
    const parsed = productIdParamSchema.safeParse(request.params)
    if (!parsed.success) {
      return reply.code(400).send({
        error: "ValidationError",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      })
    }

    const product = await fetchPublishedProduct(eq(products.id, parsed.data.id))
    if (!product) {
      return reply.code(404).send({ error: "NotFound", message: "Product not found" })
    }
    return reply.code(200).send(product)
  })
}

// Public, SEO-friendly lookup by slug (mirrors GET /api/artworks/:slug). The
// storefront catalogue links to /boutique/:slug, so the detail page resolves by
// slug. Registered before the `/:id` route so the static `/slug/` prefix wins.
export const getProductBySlugRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/slug/:slug", async (request, reply) => {
    const slug = (request.params as { slug: string }).slug
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 255) {
      return reply.code(400).send({ error: "ValidationError", message: "Invalid slug" })
    }

    const product = await fetchPublishedProduct(eq(products.slug, slug))
    if (!product) {
      return reply.code(404).send({ error: "NotFound", message: "Product not found" })
    }
    return reply.code(200).send(product)
  })
}
