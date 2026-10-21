import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { and, eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, loginChallenges, refreshTokens, users } from "../db/schema.js"
import { LOGIN_CODE_MAX_ATTEMPTS, LOGIN_CODE_MAX_SENDS, purgeLoginChallenges } from "./login-code.js"

// The policy (members of an organisation, story 12.8b) is tested on its own;
// this suite picks its own accounts through it, and reads the codes off the mailer.
const { codeAccounts, sentCodes } = vi.hoisted(() => ({
  codeAccounts: new Set<string>(),
  sentCodes: [] as { to: string; code: string }[],
}))
vi.mock("./login-code-policy.js", () => ({
  requiresLoginCode: async (user: { id: string }) => codeAccounts.has(user.id),
}))
vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendLoginCodeEmail: vi.fn(async (to: string, code: string) => {
    sentCodes.push({ to, code })
  }),
}))

const EMAIL_SUFFIX = "@login-code.local"
const PASSWORD = "MotDePasseTresLong123!"

describe("login by password + e-mailed code (story 12.8a)", () => {
  let app: FastifyInstance
  let email: string
  let userId: string

  const login = (password = PASSWORD) =>
    app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } })
  const verify = (challengeToken: string, code: string) =>
    app.inject({ method: "POST", url: "/api/auth/login/verify", payload: { challengeToken, code } })
  const resend = (challengeToken: string) =>
    app.inject({ method: "POST", url: "/api/auth/login/resend", payload: { challengeToken } })

  /** Log in with the password and hand back the challenge and the code mailed for it. */
  async function challenge() {
    const res = await login()
    expect(res.statusCode).toBe(200)
    const code = sentCodes.at(-1)?.code
    if (!code) throw new Error("No code was mailed")
    return { challengeToken: res.json().challengeToken as string, code }
  }

  const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0")

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(() => app.close())

  beforeEach(async () => {
    sentCodes.length = 0
    email = `pro-${Date.now()}-${Math.random()}${EMAIL_SUFFIX}`
    const [row] = await db
      .insert(users)
      .values({
        email,
        passwordHash: await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
        role: "customer",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    userId = row.id
    codeAccounts.add(userId)
  })

  afterEach(async () => {
    const ids = db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `%${EMAIL_SUFFIX}`))
    await db.delete(refreshTokens).where(inArray(refreshTokens.userId, ids))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, ids))
    await db.delete(users).where(like(users.email, `%${EMAIL_SUFFIX}`))
  })

  it("answers the right password with a challenge and a mailed code, not a session", async () => {
    const res = await login()

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ codeRequired: true, expiresIn: 600 })
    expect(res.json()).not.toHaveProperty("accessToken")
    expect(sentCodes).toEqual([{ to: email, code: expect.stringMatching(/^\d{6}$/) }])
    expect(await db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId))).toEqual([])
  })

  it("mails nothing on a wrong password", async () => {
    expect((await login("pas-le-bon-mot-de-passe")).statusCode).toBe(401)
    expect(sentCodes).toEqual([])
  })

  it("opens the session on the right code, and journals the login", async () => {
    const { challengeToken, code } = await challenge()

    const res = await verify(challengeToken, code)

    expect(res.statusCode).toBe(200)
    expect(res.json().accessToken).toMatch(/^eyJ/)
    expect(res.json().user.email).toBe(email)
    const logins = await db
      .select({ newValue: auditLogs.newValue })
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, userId), eq(auditLogs.action, "user.login")))
    expect(logins).toEqual([{ newValue: { method: "password+email_code" } }])
  })

  it("takes a code once only", async () => {
    const { challengeToken, code } = await challenge()
    expect((await verify(challengeToken, code)).statusCode).toBe(200)
    expect((await verify(challengeToken, code)).statusCode).toBe(401)
  })

  it(`kills the challenge after ${LOGIN_CODE_MAX_ATTEMPTS} wrong codes, the right one included afterwards`, async () => {
    const { challengeToken, code } = await challenge()
    for (let attempt = 1; attempt < LOGIN_CODE_MAX_ATTEMPTS; attempt++) {
      const res = await verify(challengeToken, wrong(code))
      expect(res.statusCode).toBe(401)
      expect(res.json().remainingAttempts).toBe(LOGIN_CODE_MAX_ATTEMPTS - attempt)
    }
    expect((await verify(challengeToken, wrong(code))).json().remainingAttempts).toBe(0)

    expect((await verify(challengeToken, code)).statusCode).toBe(401)
  })

  it("refuses a code past its 10 minutes", async () => {
    const { challengeToken, code } = await challenge()
    await db
      .update(loginChallenges)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(loginChallenges.userId, userId))

    expect((await verify(challengeToken, code)).statusCode).toBe(401)
  })

  it("keeps only a keyed digest of the code, never the code", async () => {
    const { code } = await challenge()
    const [row] = await db.select().from(loginChallenges).where(eq(loginChallenges.userId, userId))

    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(row?.codeHash).not.toContain(code)
  })

  it("replaces the code on a resend: the old one stops working", async () => {
    const first = await challenge()
    await db
      .update(loginChallenges)
      .set({ lastSentAt: new Date(Date.now() - 61_000) })
      .where(eq(loginChallenges.userId, userId))

    expect((await resend(first.challengeToken)).statusCode).toBe(202)
    const second = sentCodes.at(-1)?.code ?? ""

    expect((await verify(first.challengeToken, first.code)).statusCode).toBe(first.code === second ? 200 : 401)
    expect((await verify(first.challengeToken, second)).statusCode).toBe(first.code === second ? 401 : 200)
  })

  it("refuses a resend within a minute of the last code", async () => {
    const { challengeToken } = await challenge()
    const res = await resend(challengeToken)
    expect(res.statusCode).toBe(429)
    expect(sentCodes).toHaveLength(1)
  })

  it(`sends ${LOGIN_CODE_MAX_SENDS} codes per challenge at most`, async () => {
    const { challengeToken } = await challenge()
    for (let send = 2; send <= LOGIN_CODE_MAX_SENDS + 1; send++) {
      await db
        .update(loginChallenges)
        .set({ lastSentAt: new Date(Date.now() - 61_000) })
        .where(eq(loginChallenges.userId, userId))
      expect((await resend(challengeToken)).statusCode).toBe(send <= LOGIN_CODE_MAX_SENDS ? 202 : 429)
    }
    expect(sentCodes).toHaveLength(LOGIN_CODE_MAX_SENDS)
  })

  it("logs an account without a code policy straight in, as before", async () => {
    codeAccounts.delete(userId)
    const res = await login()
    expect(res.json().accessToken).toMatch(/^eyJ/)
    expect(sentCodes).toEqual([])
  })

  it("purges challenges a day past their expiry", async () => {
    await challenge()
    await db
      .update(loginChallenges)
      .set({ expiresAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(loginChallenges.userId, userId))

    const purged = await purgeLoginChallenges()

    expect(purged.challenges).toBeGreaterThanOrEqual(1)
    expect(await db.select().from(loginChallenges).where(eq(loginChallenges.userId, userId))).toEqual([])
  })
})
