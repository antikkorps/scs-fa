import { shopIdentitySchema } from "@armurier/shared"
import type { FastifyPluginAsync } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { validationError } from "../http.js"
import { loadShopIdentity, saveShopIdentity } from "./service.js"

/** GET /api/shop-identity — public: the legal pages and /contact render it. */
export const shopIdentityRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (_request, reply) =>
    reply.header("cache-control", "public, max-age=60").send({ data: await loadShopIdentity() }),
  )
}

/** /api/admin/shop-identity — read and replaced whole by an admin, journaled. */
export const adminShopIdentityRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  fastify.get("/", async (_request, reply) => reply.send({ data: await loadShopIdentity() }))

  fastify.put("/", async (request, reply) => {
    const parsed = shopIdentitySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    await db.transaction(async (tx) => {
      const before = await loadShopIdentity(tx)
      await saveShopIdentity(parsed.data, tx)
      // What the legal pages state about the seller: who changed it, from what.
      await recordAuditEvent(
        {
          userId: request.user.sub,
          userRole: "admin",
          entityType: "shop_identity",
          action: "shop_identity.updated",
          oldValue: before,
          newValue: parsed.data,
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        },
        tx,
      )
    })

    return reply.send({ data: await loadShopIdentity() })
  })
}
