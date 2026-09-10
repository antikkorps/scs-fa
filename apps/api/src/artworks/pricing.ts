import { artworkPriceGridSchema, buildArtworkPriceGrid } from "@armurier/shared"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { validationError } from "../http.js"

/**
 * Gun Art price simulator (story 11.7).
 *
 * Answers one question the client asked directly: *given my base price, my
 * rarity increment and my format factors, does a small print ever cost more
 * than a big one?* The rule and the arithmetic live in `@armurier/shared` so the
 * artwork form of story 7.5 can reuse the very same guard rail at save time.
 *
 * Stateless on purpose — it simulates a grid, it does not read or write any
 * artwork. Admin-only all the same: base price and increment are commercial
 * settings, not public data.
 */
export const adminArtworkPricingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  fastify.post("/price-grid", async (request, reply) => {
    const parsed = artworkPriceGridSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const { basePriceHt, priceIncrementHt, editionLimit, formats, vatPct } = parsed.data
    const grid = buildArtworkPriceGrid(basePriceHt, priceIncrementHt, editionLimit, formats, vatPct)

    return reply.send({ data: grid })
  })
}
