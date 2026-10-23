import { loginSchema } from "@armurier/shared"
import { hash, verify } from "@node-rs/argon2"
import { eq } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"
import { clearFailedLogins, countFailedLogin, lockoutRemainingSeconds } from "./lockout.js"
import { startLoginChallenge } from "./login-code.js"
import { requiresLoginCode } from "./login-code-policy.js"
import { issueTokens } from "./tokens.js"

// Pre-computed argon2id hash of a random string. Used to keep response time
// roughly constant when the email does not exist, mitigating user enumeration.
const DUMMY_HASH = await hash("dummy-password-for-timing-safety-only", {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
})

export const loginRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post("/login", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: "ValidationError",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      })
    }

    const { email, password, deviceLabel } = parsed.data
    const normalizedEmail = email.trim().toLowerCase()

    const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1)

    const lockedFor = user ? lockoutRemainingSeconds(user) : null
    if (lockedFor !== null) {
      return reply.code(423).send({
        error: "AccountLocked",
        message: "Too many failed attempts. Try again later.",
        retryAfter: lockedFor,
      })
    }

    const passwordOk = await verify(user?.passwordHash ?? DUMMY_HASH, password)

    if (!user || !passwordOk) {
      if (user) {
        const { attempts, locked } = await countFailedLogin(user.id)
        // Journaled so a lockout can be explained afterwards. Never the
        // password tried; an unknown e-mail is not journaled at all (it would
        // store whatever an attacker typed, against no account).
        await recordAuditEvent({
          userId: user.id,
          userRole: user.role,
          entityType: "user",
          entityId: user.id,
          action: locked ? "user.login_locked" : "user.login_failed",
          newValue: { attempts },
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        })
      }
      return reply.code(401).send({
        error: "InvalidCredentials",
        message: "Invalid email or password",
      })
    }

    // Story 12.8a: no session yet for these accounts — the mailed code opens it.
    // The failure trail stays until then: wrong codes add to it (story 12.9f).
    if (await requiresLoginCode(user)) {
      return reply.code(200).send(await startLoginChallenge(user, deviceLabel ?? null))
    }
    await clearFailedLogins(user.id)

    const tokens = await issueTokens(fastify, user, deviceLabel ?? null)

    await recordAuditEvent({
      userId: user.id,
      userRole: user.role,
      entityType: "user",
      entityId: user.id,
      action: "user.login",
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    })

    return reply.code(200).send({
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstname,
        lastName: user.lastname,
        role: user.role,
      },
    })
  })
}
