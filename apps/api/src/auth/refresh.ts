import { refreshSchema } from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"
import {
  findRefreshTokenByHash,
  revokeRefreshFamily,
  rotateRefreshToken,
  successorWithinGrace,
  tokensFor,
} from "./tokens.js"

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

    const presented = parsed.data.refreshToken
    let stored = await findRefreshTokenByHash(presented)
    const now = new Date()
    if (!stored || stored.expiresAt <= now || (stored.sessionExpiresAt && stored.sessionExpiresAt <= now)) {
      return reply.code(401).send({
        error: "InvalidRefreshToken",
        message: "Refresh token is invalid or expired",
      })
    }

    const [user] = await db.select().from(users).where(eq(users.id, stored.userId)).limit(1)
    if (!user) {
      return reply.code(401).send({ error: "InvalidRefreshToken" })
    }

    const journal = (action: string, newValue?: unknown) =>
      recordAuditEvent({
        userId: user.id,
        userRole: user.role,
        entityType: "user",
        entityId: user.id,
        action,
        newValue,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      })

    // Rotate: the used token is kept, revoked, so a later replay is detectable,
    // and a new one is issued within the same family.
    if (!stored.revokedAt) {
      const successor = await rotateRefreshToken(stored, presented, user)
      if (successor) {
        await journal("user.token_refreshed")
        return reply.code(200).send(await tokensFor(fastify, user, successor))
      }
      // A concurrent refresh rotated it first: read what it left.
      stored = (await findRefreshTokenByHash(presented)) ?? stored
    }

    // Story 12.9f — a refresh racing the rotation gets the same successor.
    const successor = await successorWithinGrace(stored, presented)
    if (successor) {
      await journal("user.token_refreshed", { withinGrace: true })
      return reply.code(200).send(await tokensFor(fastify, user, successor))
    }

    // Reuse detection (RTR): the token was already rotated out (revoked) and is
    // being replayed → treat it as theft and revoke the whole session family, so
    // the attacker AND the legitimate holder are logged out everywhere.
    const revoked = await revokeRefreshFamily(stored.familyId)
    await journal("user.token_reuse_detected", { familyId: stored.familyId, revokedCount: revoked })
    return reply.code(401).send({
      error: "InvalidRefreshToken",
      message: "Refresh token is invalid or expired",
    })
  })
}
