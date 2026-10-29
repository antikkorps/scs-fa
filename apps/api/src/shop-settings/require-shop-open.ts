import { salesAreOpen } from "@armurier/shared"
import type { FastifyReply, FastifyRequest } from "fastify"
import { loadShopSettings } from "./service.js"

/**
 * preHandler closing every way in to a sale — accounts, cart, order, payment,
 * quotes — until the shop opens (story 12.10). Placed after authentication, so
 * an anonymous caller of a signed-in route still gets its 401.
 */
export async function requireShopOpen(_request: FastifyRequest, reply: FastifyReply) {
  const { launchStage } = await loadShopSettings()
  if (!salesAreOpen(launchStage)) {
    return reply.code(403).send({ error: "ShopNotOpen", message: "Sales are not open yet" })
  }
}
