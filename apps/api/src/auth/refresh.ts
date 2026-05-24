import { refreshSchema } from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { auditLogs, refreshTokens, users } from "../db/schema.js"
import { findValidRefreshToken, issueTokens } from "./tokens.js"

export const refreshRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post("/refresh", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: "ValidationError",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      })
    }

    const stored = await findValidRefreshToken(parsed.data.refreshToken)
    if (!stored) {
      return reply.code(401).send({
        error: "InvalidRefreshToken",
        message: "Refresh token is invalid or expired",
      })
    }

    // Rotate: delete the used token, issue a new pair.
    await db.delete(refreshTokens).where(eq(refreshTokens.id, stored.id))

    const [user] = await db.select().from(users).where(eq(users.id, stored.userId)).limit(1)
    if (!user) {
      return reply.code(401).send({ error: "InvalidRefreshToken" })
    }

    const tokens = await issueTokens(fastify, { id: user.id, role: user.role }, stored.deviceLabel)

    await db.insert(auditLogs).values({
      userId: user.id,
      userRole: user.role,
      entityType: "user",
      entityId: user.id,
      action: "user.token_refreshed",
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    })

    return reply.code(200).send(tokens)
  })
}
