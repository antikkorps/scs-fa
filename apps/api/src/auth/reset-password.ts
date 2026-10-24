import { resetPasswordSchema } from "@armurier/shared"
import { verify } from "@node-rs/argon2"
import { and, eq, gt, isNull } from "drizzle-orm"
import type { FastifyPluginAsync, FastifyReply } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { loginChallenges, passwordResetTokens, refreshTokens, users } from "../db/schema.js"
import { hashPassword } from "./password.js"
import { hashRefreshToken } from "./tokens.js"

function sendInvalidLink(reply: FastifyReply) {
  return reply.code(400).send({
    error: "InvalidOrExpiredToken",
    message: "This reset link is invalid or has expired.",
  })
}

export const resetPasswordRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/reset-password",
    {
      config: {
        rateLimit: { max: 5, timeWindow: "15 minutes" },
      },
    },
    async (request, reply) => {
      const parsed = resetPasswordSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({
          error: "ValidationError",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        })
      }

      const { token, password } = parsed.data
      const tokenHash = hashRefreshToken(token)

      const [resetToken] = await db
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            gt(passwordResetTokens.expiresAt, new Date()),
            isNull(passwordResetTokens.usedAt),
          ),
        )
        .limit(1)

      if (!resetToken) {
        return sendInvalidLink(reply)
      }

      const [existing] = await db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, resetToken.userId))
        .limit(1)

      // Refuse a no-op reset (new password identical to the current one). The
      // token is intentionally left usable so the user can retry with a new one.
      if (existing && (await verify(existing.passwordHash, password))) {
        return reply.code(422).send({
          error: "SamePassword",
          message: "The new password must be different from the current one.",
        })
      }

      const passwordHash = await hashPassword(password)

      // Story 12.9g — one transaction, and the link is claimed by a conditional
      // update: of concurrent requests with the same link, one resets the
      // password and the others find it spent. The reset then ends everything
      // the old password could still lead to: the account's other reset links,
      // its pending login codes, and every session.
      const claimed = await db.transaction(async (tx) => {
        const [claim] = await tx
          .update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(passwordResetTokens.id, resetToken.id),
              isNull(passwordResetTokens.usedAt),
              gt(passwordResetTokens.expiresAt, new Date()),
            ),
          )
          .returning({ id: passwordResetTokens.id })
        if (!claim) return false

        await tx.update(users).set({ passwordHash }).where(eq(users.id, resetToken.userId))
        await tx
          .update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(and(eq(passwordResetTokens.userId, resetToken.userId), isNull(passwordResetTokens.usedAt)))
        await tx
          .update(loginChallenges)
          .set({ consumedAt: new Date() })
          .where(and(eq(loginChallenges.userId, resetToken.userId), isNull(loginChallenges.consumedAt)))
        await tx.delete(refreshTokens).where(eq(refreshTokens.userId, resetToken.userId))
        return true
      })

      if (!claimed) {
        return sendInvalidLink(reply)
      }

      const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, resetToken.userId)).limit(1)

      await recordAuditEvent({
        userId: resetToken.userId,
        userRole: user?.role ?? null,
        entityType: "user",
        entityId: resetToken.userId,
        action: "user.password_reset",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      })

      return reply.code(200).send({
        message: "Password has been reset. Please log in with your new password.",
      })
    },
  )
}
