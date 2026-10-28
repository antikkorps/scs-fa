import type { FastifyPluginAsync } from "fastify"
import { loadShopSettings } from "./service.js"

/**
 * GET /api/shop-status (story 12.10) — what the storefront needs to know before
 * rendering a page: how far the shop is open and whether to let robots index it.
 */
export const shopStatusRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (_request, reply) => {
    const { launchStage, indexingEnabled } = await loadShopSettings()
    return reply.send({ data: { launchStage, indexingEnabled } })
  })
}
