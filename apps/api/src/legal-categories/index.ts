import type { FastifyPluginAsync } from "fastify"
import { listLegalCategoriesRoute } from "./list.js"

export const legalCategoryRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(listLegalCategoriesRoute)
}
