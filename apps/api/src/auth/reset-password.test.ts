import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, passwordResetTokens, refreshTokens, users } from "../db/schema.js"
import { generateRefreshToken, hashRefreshToken } from "./tokens.js"

vi.mock("../email.js", () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}))

const TEST_EMAIL_SUFFIX = "@reset-test.local"
const PLAINTEXT_PASSWORD = "MotDePasseTresLong123!"

async function seedUser(email: string) {
  const passwordHash = await hash(PLAINTEXT_PASSWORD, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  })
  const [row] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      firstname: "Jean",
      lastname: "Dupont",
      role: "customer",
      rgpdConsentAt: new Date(),
      rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
    })
    .returning({ id: users.id })
  return row.id
}

async function seedResetToken(userId: string, opts?: { expired?: boolean; used?: boolean }) {
  const token = generateRefreshToken()
  const tokenHash = hashRefreshToken(token)
  const expiresAt = opts?.expired ? new Date(Date.now() - 60_000) : new Date(Date.now() + 60 * 60 * 1000)

  await db.insert(passwordResetTokens).values({
    userId,
    tokenHash,
    expiresAt,
    usedAt: opts?.used ? new Date() : null,
  })

  return token
}

describe("forgot-password + reset-password", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(async () => {
    const stale = await db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `%${TEST_EMAIL_SUFFIX}`))
    if (stale.length > 0) {
      const ids = stale.map((u) => u.id)
      await db.delete(passwordResetTokens).where(inArray(passwordResetTokens.userId, ids))
      await db.delete(refreshTokens).where(inArray(refreshTokens.userId, ids))
      await db.delete(auditLogs).where(inArray(auditLogs.userId, ids))
      await db.delete(users).where(inArray(users.id, ids))
    }
  })

  // ---------- POST /api/auth/forgot-password ----------

  describe("POST /api/auth/forgot-password", () => {
    it("returns 200 for an existing email and creates a reset token", async () => {
      const email = `exists-${Date.now()}${TEST_EMAIL_SUFFIX}`
      const userId = await seedUser(email)

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/forgot-password",
        payload: { email },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().message).toMatch(/reset link/i)

      const tokens = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, userId))
      expect(tokens).toHaveLength(1)
      expect(tokens[0].expiresAt.getTime()).toBeGreaterThan(Date.now())
      expect(tokens[0].usedAt).toBeNull()

      const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "user.password_reset_requested"))
      expect(audit).toBeDefined()
      expect(audit.userId).toBe(userId)
    })

    it("returns 200 for a non-existent email (no enumeration leak)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/forgot-password",
        payload: { email: `nobody-${Date.now()}${TEST_EMAIL_SUFFIX}` },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().message).toMatch(/reset link/i)
    })

    it("returns 400 for invalid email", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/forgot-password",
        payload: { email: "not-an-email" },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe("ValidationError")
    })
  })

  // ---------- POST /api/auth/reset-password ----------

  describe("POST /api/auth/reset-password", () => {
    it("resets the password with a valid token", async () => {
      const email = `reset-ok-${Date.now()}${TEST_EMAIL_SUFFIX}`
      const userId = await seedUser(email)
      const token = await seedResetToken(userId)

      const newPassword = "NewSecurePassword456!"
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/reset-password",
        payload: { token, password: newPassword },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().message).toMatch(/reset/i)

      // Token is now marked as used
      const [usedToken] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, userId))
      expect(usedToken.usedAt).toBeInstanceOf(Date)

      // Old password no longer works, new one does
      const loginOld = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: PLAINTEXT_PASSWORD },
      })
      expect(loginOld.statusCode).toBe(401)

      const loginNew = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: newPassword },
      })
      expect(loginNew.statusCode).toBe(200)

      // Audit log exists
      const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "user.password_reset"))
      expect(audits.some((a) => a.userId === userId)).toBe(true)
    })

    it("revokes all refresh tokens on password reset", async () => {
      const email = `revoke-${Date.now()}${TEST_EMAIL_SUFFIX}`
      const userId = await seedUser(email)

      // Login to create a refresh token
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: PLAINTEXT_PASSWORD },
      })

      const tokensBefore = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId))
      expect(tokensBefore.length).toBeGreaterThan(0)

      const resetToken = await seedResetToken(userId)
      await app.inject({
        method: "POST",
        url: "/api/auth/reset-password",
        payload: { token: resetToken, password: "AnotherGoodPassword789!" },
      })

      const tokensAfter = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId))
      expect(tokensAfter).toHaveLength(0)
    })

    it("rejects an expired token", async () => {
      const email = `expired-${Date.now()}${TEST_EMAIL_SUFFIX}`
      const userId = await seedUser(email)
      const token = await seedResetToken(userId, { expired: true })

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/reset-password",
        payload: { token, password: "ValidPassword123!" },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe("InvalidOrExpiredToken")
    })

    it("rejects an already-used token", async () => {
      const email = `used-${Date.now()}${TEST_EMAIL_SUFFIX}`
      const userId = await seedUser(email)
      const token = await seedResetToken(userId, { used: true })

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/reset-password",
        payload: { token, password: "ValidPassword123!" },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe("InvalidOrExpiredToken")
    })

    it("rejects a bogus token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/reset-password",
        payload: { token: "this-is-a-totally-bogus-token-value", password: "ValidPassword123!" },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe("InvalidOrExpiredToken")
    })

    it("returns 400 for a weak password", async () => {
      const email = `weak-${Date.now()}${TEST_EMAIL_SUFFIX}`
      const userId = await seedUser(email)
      const token = await seedResetToken(userId)

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/reset-password",
        payload: { token, password: "short" },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe("ValidationError")
    })

    it("rejects reusing the current password and keeps the token usable", async () => {
      const email = `same-${Date.now()}${TEST_EMAIL_SUFFIX}`
      const userId = await seedUser(email)
      const token = await seedResetToken(userId)

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/reset-password",
        payload: { token, password: PLAINTEXT_PASSWORD },
      })

      expect(res.statusCode).toBe(422)
      expect(res.json().error).toBe("SamePassword")

      // The token must NOT be consumed, so the user can retry with a new password.
      const [tok] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, userId))
      expect(tok.usedAt).toBeNull()

      // The original password still works (nothing changed).
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: PLAINTEXT_PASSWORD },
      })
      expect(login.statusCode).toBe(200)
    })
  })
})
