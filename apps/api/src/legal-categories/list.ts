import { asc } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { legalCategories } from "../db/schema.js"

export const listLegalCategoriesRoute: FastifyPluginAsync = async (fastify) => {
  // Public read-only reference data: the French prefectural legal categories.
  fastify.get("/", async (_request, reply) => {
    const rows = await db
      .select({
        category: legalCategories.category,
        name: legalCategories.name,
        description: legalCategories.description,
        requiresVerification: legalCategories.requiresVerification,
        minAge: legalCategories.minAge,
        requiredDocTypes: legalCategories.requiredDocTypes,
      })
      .from(legalCategories)
      // Enum column orders by declaration order: A, B, C, D, none
      .orderBy(asc(legalCategories.category))

    return reply.code(200).send({ data: rows })
  })
}
