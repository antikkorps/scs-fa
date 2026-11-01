// Story 12.11 — the data-rights routes of "Mon compte", under /api/auth/me.
import { accountExportFilename, accountReauthSchema } from "@armurier/shared"
import type { FastifyPluginAsync } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { authenticate } from "../auth/authenticate.js"
import { reauthenticate, sendReauthRefusal } from "../auth/reauth.js"
import { validationError } from "../http.js"
import { buildAccountExport } from "./export.js"

export const accountDataRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/me/export",
    { preHandler: [authenticate], config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const parsed = accountReauthSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

      const now = new Date()
      const reauth = await reauthenticate(request.user.sub, parsed.data, now)
      if ("refusal" in reauth) return sendReauthRefusal(reply, reauth.refusal)

      const data = await buildAccountExport(reauth.user.id, now)
      if (!data) return sendReauthRefusal(reply, "NotFound")

      await recordAuditEvent({
        userId: reauth.user.id,
        userRole: reauth.user.role,
        entityType: "user",
        entityId: reauth.user.id,
        action: "user.data_exported",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      })

      return reply
        .header("content-disposition", `attachment; filename="${accountExportFilename(now)}"`)
        .header("cache-control", "no-store")
        .type("application/json; charset=utf-8")
        .send(JSON.stringify(data, null, 2))
    },
  )
}
