import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, refreshTokens, users } from "../db/schema.js"

const TEST_EMAIL_SUFFIX = "@profile-test.local"
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
      phone: "+33612345678",
      role: "customer",
      rgpdConsentAt: new Date(),
      rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
    })
    .returning({ id: users.id })
  return row.id
}

async function loginAndGetToken(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password: PLAINTEXT_PASSWORD },
  })
  return res.json().accessToken
}

describe("auth/profile (GET & PATCH /api/auth/me)", () => {
  let app: FastifyInstance
  let email: string
  let accessToken: string

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    email = `profile-${Date.now()}-${Math.random()}${TEST_EMAIL_SUFFIX}`
    await seedUser(email)
    accessToken = await loginAndGetToken(app, email)
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

  describe("GET /api/auth/me", () => {
    it("returns 200 with user profile", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${accessToken}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.email).toBe(email)
      expect(body.firstName).toBe("Jean")
      expect(body.lastName).toBe("Dupont")
      expect(body.role).toBe("customer")
      expect(body).not.toHaveProperty("passwordHash")
      expect(body).not.toHaveProperty("failedLoginAttempts")
      expect(body).not.toHaveProperty("lockedUntil")
    })

    it("returns 401 without token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/me",
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().error).toBe("Unauthorized")
    })

    it("returns 401 with invalid token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: "Bearer invalid.token.here" },
      })
      expect(res.statusCode).toBe(401)
    })
  })

  describe("PATCH /api/auth/me", () => {
    it("updates firstName and lastName", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { firstName: "Pierre", lastName: "Martin" },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.firstName).toBe("Pierre")
      expect(body.lastName).toBe("Martin")
    })

    it("updates address fields", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          addressStreet: "12 rue de la Paix",
          addressPostal: "75002",
          addressCity: "Paris",
          addressCountry: "FR",
        },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.addressStreet).toBe("12 rue de la Paix")
      expect(body.addressPostal).toBe("75002")
      expect(body.addressCity).toBe("Paris")
    })

    it("allows setting phone to null", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { phone: null },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().phone).toBeNull()
    })

    it("creates an audit log entry", async () => {
      await app.inject({
        method: "PATCH",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { firstName: "Audit" },
      })

      const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
      const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, row.id))
      const profileLog = logs.find((l) => l.action === "user.profile_updated")
      expect(profileLog).toBeDefined()
      expect((profileLog?.newValue as Record<string, unknown>).firstName).toBe("Audit")
    })

    it("returns 400 on empty body", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      })
      expect(res.statusCode).toBe(400)
    })

    it("returns 400 when trying to change email (strict schema)", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { email: "hacker@evil.com" },
      })
      expect(res.statusCode).toBe(400)
    })

    it("returns 400 when trying to change role (strict schema)", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { role: "admin" },
      })
      expect(res.statusCode).toBe(400)
    })

    it("returns 401 without token", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/auth/me",
        payload: { firstName: "Nope" },
      })
      expect(res.statusCode).toBe(401)
    })

    it("returns 400 on invalid phone format", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { phone: "not-a-phone!" },
      })
      expect(res.statusCode).toBe(400)
    })
  })
})
