import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, refreshTokens, users } from "../db/schema.js"
import { LOCKOUT_DURATION_MS, MAX_FAILED_ATTEMPTS } from "./login.js"
import { hashRefreshToken } from "./tokens.js"

const TEST_EMAIL_SUFFIX = "@login-test.local"
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

describe("auth/login + refresh + logout", () => {
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
      await db.delete(refreshTokens).where(inArray(refreshTokens.userId, ids))
      await db.delete(auditLogs).where(inArray(auditLogs.userId, ids))
      await db.delete(users).where(inArray(users.id, ids))
    }
  })

  describe("POST /api/auth/login", () => {
    let email: string

    beforeEach(async () => {
      email = `login-${Date.now()}-${Math.random()}${TEST_EMAIL_SUFFIX}`
      await seedUser(email)
    })

    it("returns 200 with tokens on success", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: PLAINTEXT_PASSWORD, deviceLabel: "vitest" },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.accessToken).toMatch(/^eyJ/)
      expect(body.refreshToken.length).toBeGreaterThanOrEqual(40)
      expect(body.expiresIn).toBe(3600)
      expect(body.user.email).toBe(email)

      const [stored] = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashRefreshToken(body.refreshToken)))
      expect(stored).toBeDefined()
      expect(stored.deviceLabel).toBe("vitest")
    })

    it("returns 401 on wrong password and increments counter", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: "WrongPasswordButLong" },
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().error).toBe("InvalidCredentials")

      const [row] = await db.select().from(users).where(eq(users.email, email))
      expect(row.failedLoginAttempts).toBe(1)
      expect(row.lockedUntil).toBeNull()
    })

    it("returns 401 with same error shape on unknown email (no enumeration)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: `ghost-${Date.now()}${TEST_EMAIL_SUFFIX}`, password: "doesnt-matter-long" },
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().error).toBe("InvalidCredentials")
    })

    it(`locks account after ${MAX_FAILED_ATTEMPTS} failed attempts`, async () => {
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
        const r = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { email, password: "WrongPasswordButLong" },
        })
        expect(r.statusCode).toBe(401)
      }
      const [row] = await db.select().from(users).where(eq(users.email, email))
      expect(row.lockedUntil).toBeInstanceOf(Date)
      expect((row.lockedUntil as Date).getTime()).toBeGreaterThan(Date.now())
      expect(row.failedLoginAttempts).toBe(0)

      const blocked = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: PLAINTEXT_PASSWORD },
      })
      expect(blocked.statusCode).toBe(423)
      expect(blocked.json().error).toBe("AccountLocked")
    })

    it("auto-unlocks after lock expiry and resets counter on success", async () => {
      await db
        .update(users)
        .set({
          failedLoginAttempts: 0,
          lockedUntil: new Date(Date.now() - 1000),
        })
        .where(eq(users.email, email))

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: PLAINTEXT_PASSWORD },
      })
      expect(res.statusCode).toBe(200)

      const [row] = await db.select().from(users).where(eq(users.email, email))
      expect(row.lockedUntil).toBeNull()
      expect(row.failedLoginAttempts).toBe(0)
      expect(row.lastLoginAt).toBeInstanceOf(Date)
    })

    it("returns 400 on missing fields", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email },
      })
      expect(res.statusCode).toBe(400)
    })

    it("computes lockout duration around 15 minutes", () => {
      expect(LOCKOUT_DURATION_MS).toBe(15 * 60 * 1000)
    })
  })

  describe("POST /api/auth/refresh", () => {
    it("rotates the refresh token and invalidates the old one", async () => {
      const email = `refresh-${Date.now()}${TEST_EMAIL_SUFFIX}`
      await seedUser(email)

      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: PLAINTEXT_PASSWORD },
      })
      const oldRefresh = login.json().refreshToken

      const rotated = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        payload: { refreshToken: oldRefresh },
      })
      expect(rotated.statusCode).toBe(200)
      const newRefresh = rotated.json().refreshToken
      expect(newRefresh).not.toBe(oldRefresh)

      const replay = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        payload: { refreshToken: oldRefresh },
      })
      expect(replay.statusCode).toBe(401)
    })

    it("returns 401 for an unknown refresh token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        payload: { refreshToken: "x".repeat(43) },
      })
      expect(res.statusCode).toBe(401)
    })

    it("returns 401 for an expired refresh token", async () => {
      const email = `expired-${Date.now()}${TEST_EMAIL_SUFFIX}`
      const userId = await seedUser(email)
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: PLAINTEXT_PASSWORD },
      })
      const token = login.json().refreshToken

      await db
        .update(refreshTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(refreshTokens.userId, userId))

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        payload: { refreshToken: token },
      })
      expect(res.statusCode).toBe(401)
    })
  })

  describe("POST /api/auth/logout", () => {
    it("revokes the refresh token", async () => {
      const email = `logout-${Date.now()}${TEST_EMAIL_SUFFIX}`
      await seedUser(email)
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: PLAINTEXT_PASSWORD },
      })
      const token = login.json().refreshToken

      const out = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        payload: { refreshToken: token },
      })
      expect(out.statusCode).toBe(204)

      const replay = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        payload: { refreshToken: token },
      })
      expect(replay.statusCode).toBe(401)
    })

    it("returns 204 even for unknown token (no enumeration)", async () => {
      const out = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        payload: { refreshToken: "y".repeat(43) },
      })
      expect(out.statusCode).toBe(204)
    })
  })
})
