import { loginSchema } from "@armurier/shared"
import { hash, verify } from "@node-rs/argon2"
import { eq, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { auditLogs, users } from "../db/schema.js"
import { issueTokens } from "./tokens.js"

export const MAX_FAILED_ATTEMPTS = 5
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000
/**
 * Only failures this recent count towards the lockout. Without a window the
 * counter never decayed: typos from weeks ago plus two today locked the
 * account (seen on the dev admin, 2026-10-03).
 */
export const FAILED_ATTEMPTS_WINDOW_MS = 15 * 60 * 1000

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

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      return reply.code(423).send({
        error: "AccountLocked",
        message: "Too many failed attempts. Try again later.",
        retryAfter: Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000),
      })
    }

    const passwordOk = await verify(user?.passwordHash ?? DUMMY_HASH, password)

    if (!user || !passwordOk) {
      if (user) {
        // Counted in SQL, in one statement: a failure outside the window starts
        // a new count, and concurrent attempts cannot overwrite each other.
        const windowStart = new Date(Date.now() - FAILED_ATTEMPTS_WINDOW_MS)
        const [counted] = await db
          .update(users)
          .set({
            // The bound is encoded like the column itself (UTC, no zone): a raw
            // Date would carry the session's offset and skew the comparison.
            failedLoginAttempts: sql`case when ${users.lastFailedLoginAt} > ${sql.param(windowStart, users.lastFailedLoginAt)} then ${users.failedLoginAttempts} + 1 else 1 end`,
            lastFailedLoginAt: new Date(),
          })
          .where(eq(users.id, user.id))
          .returning({ attempts: users.failedLoginAttempts })
        const attempts = counted?.attempts ?? 1
        const locked = attempts >= MAX_FAILED_ATTEMPTS
        if (locked) {
          await db
            .update(users)
            .set({ failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) })
            .where(eq(users.id, user.id))
        }
        // Journaled so a lockout can be explained afterwards. Never the
        // password tried; an unknown e-mail is not journaled at all (it would
        // store whatever an attacker typed, against no account).
        await db.insert(auditLogs).values({
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

    await db
      .update(users)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastFailedLoginAt: null,
        lastLoginAt: new Date(),
      })
      .where(eq(users.id, user.id))

    const tokens = await issueTokens(fastify, { id: user.id, role: user.role }, deviceLabel ?? null)

    await db.insert(auditLogs).values({
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
