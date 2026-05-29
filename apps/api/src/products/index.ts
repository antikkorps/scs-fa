import type { FastifyPluginAsync } from "fastify"
import { listProductsRoute } from "./list.js"

export const productRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(listProductsRoute)
}
