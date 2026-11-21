import { asc, ne } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { productCategories, productSubcategories } from "../db/schema.js"

/** Each category's subcategories (story 12.15a), in display order. */
async function subcategoriesByCategory() {
  const rows = await db
    .select({
      categoryId: productSubcategories.categoryId,
      slug: productSubcategories.slug,
      name: productSubcategories.name,
    })
    .from(productSubcategories)
    .orderBy(asc(productSubcategories.displayOrder), asc(productSubcategories.name))
  const byCategory = new Map<string, { slug: string; name: string }[]>()
  for (const { categoryId, ...sub } of rows) {
    byCategory.set(categoryId, [...(byCategory.get(categoryId) ?? []), sub])
  }
  return byCategory
}

export const listProductCategoriesRoute: FastifyPluginAsync = async (fastify) => {
  // Public read-only reference data for the armurerie catalogue filters. Gun Art
  // is excluded — it's a separate universe surfaced via /api/artworks, not the
  // armurerie category dropdown.
  fastify.get("/", async (_request, reply) => {
    const [rows, subcategories] = await Promise.all([
      db
        .select({
          id: productCategories.id,
          slug: productCategories.slug,
          name: productCategories.name,
          category: productCategories.category,
          displayOrder: productCategories.displayOrder,
          description: productCategories.description,
        })
        .from(productCategories)
        .where(ne(productCategories.category, "gun_art"))
        .orderBy(asc(productCategories.displayOrder), asc(productCategories.name)),
      subcategoriesByCategory(),
    ])

    const data = rows.map(({ id, ...category }) => ({ ...category, subcategories: subcategories.get(id) ?? [] }))
    return reply.code(200).send({ data })
  })
}
