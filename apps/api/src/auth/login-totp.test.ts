import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, organisations, refreshTokens, users } from "../db/schema.js"
import { sendLoginCodeEmail } from "../email.js"
import { base32Decode, totpCode } from "./totp.js"
import { beginEnrollment, confirmEnrollment } from "./two-factor.js"

vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendLoginCodeEmail: vi.fn().mockResolvedValue(undefined),
}))

const PASSWORD = "MotDePasseTresLong123!"
const EMAIL_SUFFIX = "@logintotp.local"
const STEP_MS = 30_000
const codeAt = (secret: string, offsetSteps = 0) =>
  totpCode(base32Decode(secret), Math.floor(Date.now() / STEP_MS) + offsetSteps)

describe("login with the authenticator app (story 12.8e)", () => {
  let app: FastifyInstance
  let passwordHash: string

  const login = (email: string) =>
    app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })
  const verify = (challengeToken: string, code: string) =>
    app.inject({ method: "POST", url: "/api/auth/login/verify", payload: { challengeToken, code } })

  async function account(options: { role?: "customer" | "admin"; pro?: boolean } = {}) {
    let organisationId: string | null = null
    if (options.pro) {
      const [organisation] = await db
        .insert(organisations)
        .values({
          legalName: "Armurerie TOTP",
          siret: `7${String(Date.now()).slice(-9)}${String(Math.floor(Math.random() * 1e4)).padStart(4, "0")}`,
          type: "armurier",
          status: "approved",
          registryCheck: "verified",
        })
        .returning({ id: organisations.id })
      organisationId = organisation?.id ?? null
    }
    const [row] = await db
      .insert(users)
      .values({
        email: `${options.role ?? "customer"}-${Date.now()}-${Math.random()}${EMAIL_SUFFIX}`,
        passwordHash,
        role: options.role ?? "customer",
        firstname: "Jeanne",
        lastname: "Armand",
        organisationId,
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning()
    return row
  }

  /** An account whose app is enabled; returns its secret. */
  async function withApp(user: { id: string; email: string }) {
    const enrolment = await beginEnrollment(user)
    const codes = await confirmEnrollment(user.id, codeAt(enrolment.secret, -1), new Date())
    return { secret: enrolment.secret, codes: codes ?? [] }
  }

  const actions = async (userId: string) =>
    (await db.select().from(auditLogs).where(eq(auditLogs.entityId, userId))).map((event) => event.action)

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
  })

  beforeEach(() => {
    vi.mocked(sendLoginCodeEmail).mockClear()
  })

  afterAll(async () => {
    const tagged = await db
      .select({ id: users.id, organisationId: users.organisationId })
      .from(users)
      .where(like(users.email, `%${EMAIL_SUFFIX}`))
    const ids = tagged.map((row) => row.id)
    if (ids.length > 0) {
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, ids))
      await db.delete(refreshTokens).where(inArray(refreshTokens.userId, ids))
      await db.delete(users).where(inArray(users.id, ids))
    }
    const organisationIds = tagged.flatMap((row) => (row.organisationId ? [row.organisationId] : []))
    if (organisationIds.length > 0) await db.delete(organisations).where(inArray(organisations.id, organisationIds))
    await app.close()
  })

  describe("an admin without the app", () => {
    it("must enrol it before any session: the QR code at login, then the first code opens the session", async () => {
      const admin = await account({ role: "admin" })

      const first = await login(admin.email)

      expect(first.statusCode).toBe(200)
      const body = first.json()
      expect(body).toMatchObject({ codeRequired: true, method: "totp_enrollment" })
      expect(body.accessToken).toBeUndefined()
      expect(body.enrollment.qrSvg).toMatch(/^<svg/)
      expect(body.enrollment.secret).toMatch(/^[A-Z2-7]{32}$/)

      const opened = await verify(body.challengeToken, codeAt(body.enrollment.secret))

      expect(opened.statusCode).toBe(200)
      expect(opened.json().accessToken).toEqual(expect.any(String))
      expect(opened.json().recoveryCodes).toHaveLength(10)
      const [stored] = await db.select().from(users).where(eq(users.id, admin.id))
      expect(stored?.totpEnabledAt).toBeInstanceOf(Date)
      expect(await actions(admin.id)).toEqual(expect.arrayContaining(["user.totp_enabled", "user.login"]))
    })

    it("cannot open a session with a wrong first code", async () => {
      const admin = await account({ role: "admin" })
      const { challengeToken } = (await login(admin.email)).json()

      const refused = await verify(challengeToken, "000000")

      expect(refused.statusCode).toBe(401)
      expect(refused.json().accessToken).toBeUndefined()
    })
  })

  describe("an account with the app", () => {
    it("asks for the app's code after the password, and opens the session with it — once", async () => {
      const user = await account()
      const { secret } = await withApp(user)

      const first = (await login(user.email)).json()
      expect(first).toMatchObject({ codeRequired: true, method: "totp" })
      expect(first.enrollment).toBeUndefined()

      const code = codeAt(secret, 1)
      const opened = await verify(first.challengeToken, code)
      expect(opened.statusCode).toBe(200)
      expect(opened.json().accessToken).toEqual(expect.any(String))
      const events = await db.select().from(auditLogs).where(eq(auditLogs.entityId, user.id))
      expect(events.find((event) => event.action === "user.login")?.newValue).toEqual({ method: "password+totp" })

      // The same code cannot open a second session.
      const again = (await login(user.email)).json()
      expect((await verify(again.challengeToken, code)).statusCode).toBe(401)
    })

    it("takes a recovery code instead of the app", async () => {
      const user = await account()
      const { codes } = await withApp(user)
      const { challengeToken } = (await login(user.email)).json()

      const opened = await verify(challengeToken, codes[0] ?? "")

      expect(opened.statusCode).toBe(200)
      const events = await db.select().from(auditLogs).where(eq(auditLogs.entityId, user.id))
      expect(events.find((event) => event.action === "user.login")?.newValue).toEqual({
        method: "password+recovery_code",
      })
    })

    it("replaces the mailed code for a pro (decision 2026-10-25)", async () => {
      const pro = await account({ pro: true })
      await withApp(pro)

      const first = (await login(pro.email)).json()

      expect(first.method).toBe("totp")
      expect(sendLoginCodeEmail).not.toHaveBeenCalled()
    })

    it("sends nothing to resend: the app makes its own codes", async () => {
      const user = await account()
      await withApp(user)
      const { challengeToken } = (await login(user.email)).json()

      const res = await app.inject({ method: "POST", url: "/api/auth/login/resend", payload: { challengeToken } })

      expect(res.statusCode).toBe(409)
      expect(res.json().error).toBe("NothingToResend")
    })

    it("closes the challenge after five wrong codes", async () => {
      const user = await account()
      const { secret } = await withApp(user)
      const { challengeToken } = (await login(user.email)).json()

      for (let attempt = 0; attempt < 5; attempt++) await verify(challengeToken, "000000")

      expect((await verify(challengeToken, codeAt(secret, 1))).statusCode).toBe(401)
    })
  })

  it("leaves a customer without the app and outside any organisation with the password alone", async () => {
    const user = await account()
    const res = await login(user.email)
    expect(res.json().accessToken).toEqual(expect.any(String))
  })

  it("still mails the code to a pro without the app", async () => {
    const pro = await account({ pro: true })
    const first = (await login(pro.email)).json()
    expect(first.method).toBe("email_code")
    expect(sendLoginCodeEmail).toHaveBeenCalledOnce()
  })
})
