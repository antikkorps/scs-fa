// Story 12.8e — a lost phone without its recovery codes: an admin clears the
// account's authenticator app (journaled). An admin's own goes through another
// admin, or the command-line reset (auth/totp-reset-cli.ts). The admin confirms
// with password and code first: a stolen session alone must not strip an
// account of its second factor (review 2026-11-04).

import { accountReauthSchema, uuidParamSchema } from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"
import { validationError } from "../http.js"
import { authenticate } from "./authenticate.js"
import { reauthenticate, sendReauthRefusal } from "./reauth.js"
import { requireRole } from "./require-role.js"
import { resetSecondFactor } from "./two-factor.js"

export const adminTwoFactorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  /** POST /:id/totp/reset — the account's app, secret and recovery codes gone; it enrols again. */
  fastify.post(
    "/:id/totp/reset",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const params = uuidParamSchema.safeParse(request.params)
      if (!params.success) return reply.code(400).send(validationError(params.error.issues))
      const confirmation = accountReauthSchema.safeParse(request.body ?? {})
      if (!confirmation.success) return reply.code(400).send(validationError(confirmation.error.issues))
      if (params.data.id === request.user.sub) {
        return reply.code(409).send({ error: "OwnAccount", message: "Another admin resets your own app" })
      }
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, params.data.id)).limit(1)
      if (!user) return reply.code(404).send({ error: "NotFound", message: "Account not found" })
      const reauth = await reauthenticate(request.user.sub, confirmation.data, new Date())
      if ("refusal" in reauth) return sendReauthRefusal(reply, reauth.refusal)

      await resetSecondFactor(user.id)
      await recordAuditEvent({
        userId: request.user.sub,
        userRole: "admin",
        entityType: "user",
        entityId: user.id,
        action: "user.totp_reset",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      })
      return reply.send({ data: { enabled: false } })
    },
  )
}
