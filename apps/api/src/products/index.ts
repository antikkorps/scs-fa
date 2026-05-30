import type { FastifyPluginAsync } from "fastify"
import { getProductRoute } from "./detail.js"
import { listProductsRoute } from "./list.js"

export const productRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(listProductsRoute)
  await fastify.register(getProductRoute)
}
