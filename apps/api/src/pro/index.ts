import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireApprovedPro } from "./access.js"
import { proCatalogueRoutes } from "./catalogue.js"

/** Everything under /api/pro: members of an approved organisation only (story 12.8c). */
export const proRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireApprovedPro)
  await fastify.register(proCatalogueRoutes)
}
