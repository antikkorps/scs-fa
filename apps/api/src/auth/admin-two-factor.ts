// Story 12.8e — a lost phone without its recovery codes: an admin clears the
// account's authenticator app (journaled). An admin's own goes through another
// admin, or the command-line reset (auth/totp-reset-cli.ts).

import { uuidParamSchema } from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"
import { validationError } from "../http.js"
import { authenticate } from "./authenticate.js"
import { requireRole } from "./require-role.js"
import { resetSecondFactor } from "./two-factor.js"

export const adminTwoFactorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  /** POST /:id/totp/reset — the account's app, secret and recovery codes gone; it enrols again. */
  fastify.post("/:id/totp/reset", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    if (params.data.id === request.user.sub) {
      return reply.code(409).send({ error: "OwnAccount", message: "Another admin resets your own app" })
    }
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, params.data.id)).limit(1)
    if (!user) return reply.code(404).send({ error: "NotFound", message: "Account not found" })

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
  })
}
