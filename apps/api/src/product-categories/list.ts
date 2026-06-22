import { asc, ne } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { productCategories } from "../db/schema.js"

export const listProductCategoriesRoute: FastifyPluginAsync = async (fastify) => {
  // Public read-only reference data for the armurerie catalogue filters. Gun Art
  // is excluded — it's a separate universe surfaced via /api/artworks, not the
  // armurerie category dropdown.
  fastify.get("/", async (_request, reply) => {
    const rows = await db
      .select({
        slug: productCategories.slug,
        name: productCategories.name,
        category: productCategories.category,
        displayOrder: productCategories.displayOrder,
      })
      .from(productCategories)
      .where(ne(productCategories.category, "gun_art"))
      .orderBy(asc(productCategories.displayOrder), asc(productCategories.name))

    return reply.code(200).send({ data: rows })
  })
}
