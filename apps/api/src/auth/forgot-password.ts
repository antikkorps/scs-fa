import { forgotPasswordSchema } from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { FastifyPluginAsync, FastifyRequest } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { passwordResetTokens, users } from "../db/schema.js"
import { sendPasswordResetEmail } from "../email.js"
import { generateRefreshToken, hashRefreshToken } from "./tokens.js"

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

interface ResetAccount {
  id: string
  role: typeof users.$inferSelect.role
}

/** Stores a single-use reset token, mails its link and journals the request. */
async function issueResetLink(user: ResetAccount, email: string, request: FastifyRequest): Promise<void> {
  const token = generateRefreshToken()
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  })

  await sendPasswordResetEmail(email, token, { userId: user.id }).catch((err) => {
    request.log.error({ err }, "forgot-password: failed to send email")
  })

  await recordAuditEvent({
    userId: user.id,
    userRole: user.role,
    entityType: "user",
    entityId: user.id,
    action: "user.password_reset_requested",
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  })
}

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

      // Issued after the answer, never awaited: an answer that waited for the
      // e-mail would tell by its delay which addresses have an account (before
      // the opening, which addresses are administrators).
      if (user) {
        issueResetLink(user, normalizedEmail, request).catch((err) => {
          request.log.error({ err }, "forgot-password: failed to issue the reset link")
        })
      }

      // Always return 200 to prevent user enumeration
      return reply.code(200).send({
        message: "If that email is registered, a reset link has been sent.",
      })
    },
  )
}
