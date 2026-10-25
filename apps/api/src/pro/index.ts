import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireApprovedPro } from "./access.js"
import { proCatalogueRoutes } from "./catalogue.js"
import { organisationDocumentRoutes } from "./documents.js"
import { quoteBasketRoutes } from "./quote-basket.js"
import { quoteRequestRoutes } from "./quote-requests.js"

/** Everything under /api/pro: members of an approved organisation only (story 12.8c). */
export const proRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireApprovedPro)
  // Personal answers, net prices included: never kept by a cache.
  fastify.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "private, no-store")
  })
  await fastify.register(proCatalogueRoutes)
  await fastify.register(quoteBasketRoutes, { prefix: "/quote-basket" })
  await fastify.register(quoteRequestRoutes, { prefix: "/quote-requests" })
  await fastify.register(organisationDocumentRoutes, { prefix: "/documents" })
}
