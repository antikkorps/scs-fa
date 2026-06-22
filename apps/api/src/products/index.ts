import type { FastifyPluginAsync } from "fastify"
import { getProductBySlugRoute, getProductRoute } from "./detail.js"
import { listProductsRoute } from "./list.js"

export const productRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(listProductsRoute)
  // Slug route first: its static `/slug/` prefix must win over the `/:id` param.
  await fastify.register(getProductBySlugRoute)
  await fastify.register(getProductRoute)
}
