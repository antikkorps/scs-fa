import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { and, eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, refreshTokens, users } from "../db/schema.js"

const SUFFIX = "@rtr-test.local"
const PASSWORD = "MotDePasseTresLong123!"

async function seedUser(email: string): Promise<string> {
  const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
  const [row] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      firstname: "Rtr",
      lastname: "Test",
      role: "customer",
      rgpdConsentAt: new Date(),
      rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
    })
    .returning({ id: users.id })
  return row.id
}

describe("auth/refresh — reuse detection (RTR)", () => {
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
      .where(like(users.email, `%${SUFFIX}`))
    if (stale.length > 0) {
      const ids = stale.map((u) => u.id)
      await db.delete(auditLogs).where(inArray(auditLogs.userId, ids))
      await db.delete(refreshTokens).where(inArray(refreshTokens.userId, ids))
      await db.delete(users).where(inArray(users.id, ids))
    }
  })

  async function login(email: string): Promise<string> {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })
    return (res.json() as { refreshToken: string }).refreshToken
  }
  const refresh = (refreshToken: string) =>
    app.inject({ method: "POST", url: "/api/auth/refresh", payload: { refreshToken } })

  it("revokes the whole family when a rotated token is replayed", async () => {
    const email = `rtr-${Date.now()}${SUFFIX}`
    const userId = await seedUser(email)

    const r1 = await login(email)
    const rotated = await refresh(r1)
    expect(rotated.statusCode).toBe(200)
    const r2 = (rotated.json() as { refreshToken: string }).refreshToken

    // Replay the already-rotated r1 → rejected, and the family is revoked.
    expect((await refresh(r1)).statusCode).toBe(401)

    // The breach revoked the whole family: the current token r2 is dead too.
    expect((await refresh(r2)).statusCode).toBe(401)

    // Reuse was audited (both the replay and the now-dead r2 present a revoked
    // token, so at least one detection is logged).
    const audits = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, userId), eq(auditLogs.action, "user.token_reuse_detected")))
    expect(audits.length).toBeGreaterThanOrEqual(1)
  })

  it("rotates normally across distinct tokens without a false positive", async () => {
    const email = `rtr2-${Date.now()}${SUFFIX}`
    await seedUser(email)

    const r1 = await login(email)
    const rot1 = await refresh(r1)
    expect(rot1.statusCode).toBe(200)
    const r2 = (rot1.json() as { refreshToken: string }).refreshToken
    expect((await refresh(r2)).statusCode).toBe(200)
  })
})
