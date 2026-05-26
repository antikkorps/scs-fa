import { forgotPasswordSchema } from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { auditLogs, passwordResetTokens, users } from "../db/schema.js"
import { sendPasswordResetEmail } from "../email.js"
import { generateRefreshToken, hashRefreshToken } from "./tokens.js"

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

export const forgotPasswordRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/forgot-password",
    {
      config: {
        rateLimit: { max: 3, timeWindow: "15 minutes" },
      },
    },
    async (request, reply) => {
      const parsed = forgotPasswordSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({
          error: "ValidationError",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        })
      }

      const normalizedEmail = parsed.data.email.trim().toLowerCase()

      const [user] = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1)

      if (user) {
        const token = generateRefreshToken()
        const tokenHash = hashRefreshToken(token)

        await db.insert(passwordResetTokens).values({
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        })

        await sendPasswordResetEmail(normalizedEmail, token).catch((err) => {
          request.log.error({ err }, "forgot-password: failed to send email")
        })

        await db.insert(auditLogs).values({
          userId: user.id,
          userRole: user.role,
          entityType: "user",
          entityId: user.id,
          action: "user.password_reset_requested",
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        })
      }

      // Always return 200 to prevent user enumeration
      return reply.code(200).send({
        message: "If that email is registered, a reset link has been sent.",
      })
    },
  )
}
