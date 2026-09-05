import { refreshSchema } from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { auditLogs, users } from "../db/schema.js"
import { findRefreshTokenByHash, issueTokens, markRefreshTokenRevoked, revokeRefreshFamily } from "./tokens.js"

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

    const stored = await findRefreshTokenByHash(parsed.data.refreshToken)
    if (!stored || stored.expiresAt <= new Date()) {
      return reply.code(401).send({
        error: "InvalidRefreshToken",
        message: "Refresh token is invalid or expired",
      })
    }

    const [user] = await db.select().from(users).where(eq(users.id, stored.userId)).limit(1)
    if (!user) {
      return reply.code(401).send({ error: "InvalidRefreshToken" })
    }

    // Reuse detection (RTR): the token was already rotated out (revoked) and is
    // being replayed → treat it as theft and revoke the whole session family, so
    // the attacker AND the legitimate holder are logged out everywhere.
    if (stored.revokedAt) {
      const revoked = await revokeRefreshFamily(stored.familyId)
      await db.insert(auditLogs).values({
        userId: user.id,
        userRole: user.role,
        entityType: "user",
        entityId: user.id,
        action: "user.token_reuse_detected",
        newValue: { familyId: stored.familyId, revokedCount: revoked },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      })
      return reply.code(401).send({
        error: "InvalidRefreshToken",
        message: "Refresh token is invalid or expired",
      })
    }

    // Rotate: mark the used token revoked (kept, not deleted, so a later replay
    // is detectable) and issue a new pair within the same family.
    await markRefreshTokenRevoked(stored.id)

    const tokens = await issueTokens(fastify, { id: user.id, role: user.role }, stored.deviceLabel, stored.familyId)

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
