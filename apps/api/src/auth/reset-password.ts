import { resetPasswordSchema } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { and, eq, gt, isNull } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { auditLogs, passwordResetTokens, refreshTokens, users } from "../db/schema.js"
import { hashRefreshToken } from "./tokens.js"

const ARGON2ID_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
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
        return reply.code(400).send({
          error: "InvalidOrExpiredToken",
          message: "This reset link is invalid or has expired.",
        })
      }

      const passwordHash = await hash(password, ARGON2ID_OPTIONS)

      await db.update(users).set({ passwordHash }).where(eq(users.id, resetToken.userId))

      await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, resetToken.id))

      // Revoke all refresh tokens to force re-login on all devices
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, resetToken.userId))

      const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, resetToken.userId)).limit(1)

      await db.insert(auditLogs).values({
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
