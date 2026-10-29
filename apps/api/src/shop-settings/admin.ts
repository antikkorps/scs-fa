import { shopSettingsSchema } from "@armurier/shared"
import type { FastifyPluginAsync } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { shopSettings } from "../db/schema.js"
import { validationError } from "../http.js"
import { loadShopSettings } from "./service.js"

/** The shop settings (stories 12.9e, 12.10): read and replaced whole by an admin. */
export const adminShopSettingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  fastify.get("/", async (_request, reply) => reply.send({ data: await loadShopSettings() }))

  fastify.put("/", async (request, reply) => {
    const parsed = shopSettingsSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const settings = parsed.data

    await db.transaction(async (tx) => {
      const before = await loadShopSettings(tx)
      const values = {
        vipMarginSharePct: settings.vipMarginSharePct.toFixed(2),
        launchStage: settings.launchStage,
        indexingEnabled: settings.indexingEnabled,
        updatedAt: new Date(),
      }
      await tx
        .insert(shopSettings)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({ target: shopSettings.id, set: values })
      // The VIP share moves every future VIP cart and the stage opens or closes the
      // shop: who changed them, and from what, must be traceable.
      await recordAuditEvent(
        {
          userId: request.user.sub,
          userRole: "admin",
          entityType: "shop_settings",
          action: "shop_settings.updated",
          oldValue: before,
          newValue: settings,
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        },
        tx,
      )
    })

    return reply.send({ data: await loadShopSettings() })
  })
}
