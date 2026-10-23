import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { and, eq, inArray, isNull, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, refreshTokens, users } from "../db/schema.js"
import { hashRefreshToken, ROTATION_GRACE_MS } from "./tokens.js"

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

  /** Move a rotation back in time, past the grace given to parallel refreshes. */
  async function pastGrace(token: string) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date(Date.now() - ROTATION_GRACE_MS - 1000) })
      .where(eq(refreshTokens.tokenHash, hashRefreshToken(token)))
  }

  it("revokes the whole family when a rotated token is replayed past the grace", async () => {
    const email = `rtr-${Date.now()}${SUFFIX}`
    const userId = await seedUser(email)

    const r1 = await login(email)
    const rotated = await refresh(r1)
    expect(rotated.statusCode).toBe(200)
    const r2 = (rotated.json() as { refreshToken: string }).refreshToken
    await pastGrace(r1)

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

  it("gives parallel refreshes of one token the same successor: the session does not fork (story 12.9f)", async () => {
    const email = `rtr3-${Date.now()}${SUFFIX}`
    const userId = await seedUser(email)
    const r1 = await login(email)

    const answers = await Promise.all(Array.from({ length: 5 }, () => refresh(r1)))

    expect(answers.map((res) => res.statusCode)).toEqual([200, 200, 200, 200, 200])
    const successors = new Set(answers.map((res) => (res.json() as { refreshToken: string }).refreshToken))
    expect(successors.size).toBe(1)
    const live = await db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
    expect(live).toHaveLength(1)
    const [r2] = successors
    expect((await refresh(r2)).statusCode).toBe(200)
  })

  it("never stores the successor in clear (story 12.9f)", async () => {
    const email = `rtr4-${Date.now()}${SUFFIX}`
    await seedUser(email)
    const r1 = await login(email)
    const r2 = ((await refresh(r1)).json() as { refreshToken: string }).refreshToken

    const [rotated] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashRefreshToken(r1)))
    expect(rotated.successorSealed).toBeTruthy()
    expect(JSON.stringify(rotated)).not.toContain(r2)
  })

  it("does not bring back a successor that has since been logged out (story 12.9f)", async () => {
    const email = `rtr5-${Date.now()}${SUFFIX}`
    await seedUser(email)
    const r1 = await login(email)
    const r2 = ((await refresh(r1)).json() as { refreshToken: string }).refreshToken
    await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, hashRefreshToken(r2)))

    expect((await refresh(r1)).statusCode).toBe(401)
  })
})
