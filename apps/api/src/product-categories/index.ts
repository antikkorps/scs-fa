import type { FastifyPluginAsync } from "fastify"
import { listProductCategoriesRoute } from "./list.js"

export const productCategoryRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(listProductCategoriesRoute)
}
