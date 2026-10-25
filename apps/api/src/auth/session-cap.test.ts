import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, refreshTokens, users } from "../db/schema.js"
import { signIn } from "../test/sign-in.js"
import { hashRefreshToken } from "./tokens.js"

const EMAIL_SUFFIX = "@session-cap.local"
const PASSWORD = "MotDePasseTresLong123!"
const DAY_MS = 24 * 60 * 60 * 1000

describe("session cap — 7 days from login for admin accounts (story 12.8a)", () => {
  let app: FastifyInstance

  async function account(role: "admin" | "customer") {
    const email = `${role}-${Date.now()}-${Math.random()}${EMAIL_SUFFIX}`
    await db.insert(users).values({
      email,
      passwordHash: await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
      role,
      rgpdConsentAt: new Date(),
      rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
    })
    return email
  }

  async function login(email: string): Promise<string> {
    const res = await signIn(app, { email, password: PASSWORD })
    expect(res.statusCode).toBe(200)
    return res.json().refreshToken
  }

  const refresh = (refreshToken: string) =>
    app.inject({ method: "POST", url: "/api/auth/refresh", payload: { refreshToken } })

  async function stored(refreshToken: string) {
    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashRefreshToken(refreshToken)))
    return row
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(() => app.close())

  afterEach(async () => {
    const ids = db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `%${EMAIL_SUFFIX}`))
    await db.delete(refreshTokens).where(inArray(refreshTokens.userId, ids))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, ids))
    await db.delete(users).where(like(users.email, `%${EMAIL_SUFFIX}`))
  })

  it("caps an admin session 7 days after the login", async () => {
    const before = Date.now()
    const row = await stored(await login(await account("admin")))

    const cap = row?.sessionExpiresAt?.getTime() ?? 0
    expect(cap).toBeGreaterThanOrEqual(before + 7 * DAY_MS - 1000)
    expect(cap).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS)
    expect(row?.expiresAt.getTime()).toBeLessThanOrEqual(cap)
  })

  it("carries the cap over every rotation instead of restarting it", async () => {
    const first = await login(await account("admin"))
    const cap = (await stored(first))?.sessionExpiresAt

    const res = await refresh(first)
    expect(res.statusCode).toBe(200)

    expect((await stored(res.json().refreshToken))?.sessionExpiresAt).toEqual(cap)
  })

  it("never lets a rotation outlive the cap", async () => {
    const token = await login(await account("admin"))
    const soon = new Date(Date.now() + 60 * 60 * 1000)
    await db
      .update(refreshTokens)
      .set({ sessionExpiresAt: soon })
      .where(eq(refreshTokens.tokenHash, hashRefreshToken(token)))

    const res = await refresh(token)

    expect((await stored(res.json().refreshToken))?.expiresAt).toEqual(soon)
  })

  it("refuses to refresh a session past its cap, even with a live token", async () => {
    const token = await login(await account("admin"))
    await db
      .update(refreshTokens)
      .set({ sessionExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(refreshTokens.tokenHash, hashRefreshToken(token)))

    expect((await refresh(token)).statusCode).toBe(401)
  })

  it("leaves a customer's sliding session uncapped", async () => {
    const row = await stored(await login(await account("customer")))
    expect(row?.sessionExpiresAt).toBeNull()
  })
})
