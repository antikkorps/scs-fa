import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, users } from "../db/schema.js"

const TEST_EMAIL_SUFFIX = "@register-test.local"

const validPayload = (email: string) => ({
  email,
  password: "MotDePasseTresLong123!",
  firstName: "Jean",
  lastName: "Dupont",
  rgpdConsent: true,
})

describe("POST /api/auth/register", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterEach(async () => {
    const stale = await db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `%${TEST_EMAIL_SUFFIX}`))
    if (stale.length > 0) {
      const ids = stale.map((u) => u.id)
      await db.delete(auditLogs).where(inArray(auditLogs.userId, ids))
      await db.delete(users).where(inArray(users.id, ids))
    }
  })

  afterAll(async () => {
    await app.close()
  })

  it("creates a user and returns 201 with the public profile", async () => {
    const email = `success-${Date.now()}${TEST_EMAIL_SUFFIX}`
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: validPayload(email),
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body).toMatchObject({
      email,
      firstName: "Jean",
      lastName: "Dupont",
      role: "customer",
    })
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.passwordHash).toBeUndefined()

    const [row] = await db.select().from(users).where(eq(users.email, email))
    expect(row.passwordHash).not.toBe("MotDePasseTresLong123!")
    expect(row.passwordHash.startsWith("$argon2id$")).toBe(true)
    expect(row.rgpdConsentAt).toBeInstanceOf(Date)
    expect(row.rgpdConsentVersion).toBe("1.0")
  })

  it("normalizes email to lowercase", async () => {
    const email = `MixedCase-${Date.now()}${TEST_EMAIL_SUFFIX}`
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: validPayload(email),
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().email).toBe(email.toLowerCase())
  })

  it("returns 409 on duplicate email", async () => {
    const email = `dup-${Date.now()}${TEST_EMAIL_SUFFIX}`
    const first = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: validPayload(email),
    })
    expect(first.statusCode).toBe(201)

    const second = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: validPayload(email),
    })
    expect(second.statusCode).toBe(409)
    expect(second.json().error).toBe("EmailAlreadyRegistered")
  })

  it("returns 400 on weak password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        ...validPayload(`weak-${Date.now()}${TEST_EMAIL_SUFFIX}`),
        password: "short",
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("ValidationError")
  })

  it("returns 400 on invalid payload (missing fields)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "incomplete@x.fr" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("ValidationError")
  })

  it("returns 400 when RGPD consent is missing", async () => {
    const { rgpdConsent: _omit, ...withoutConsent } = validPayload(`noconsent-${Date.now()}${TEST_EMAIL_SUFFIX}`)
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: withoutConsent,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().issues.some((i: { path: string }) => i.path === "rgpdConsent")).toBe(true)
  })
})
