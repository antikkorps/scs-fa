import type { FastifyPluginAsync } from "fastify"
import { registerRoute } from "./register.js"

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(registerRoute)
}
