import type { FastifyPluginAsync } from "fastify"
import { globalSearchRoute } from "./global.js"

export const searchRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(globalSearchRoute)
}
