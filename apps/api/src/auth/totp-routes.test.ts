import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, users } from "../db/schema.js"
import { base32Decode, totpCode } from "./totp.js"

const PASSWORD = "MotDePasseTresLong123!"
const EMAIL_SUFFIX = "@totproutes.local"
const STEP_MS = 30_000
const codeAt = (secret: string, offsetSteps = 0) =>
  totpCode(base32Decode(secret), Math.floor(Date.now() / STEP_MS) + offsetSteps)

describe("the authenticator app from the account (story 12.8e)", () => {
  let app: FastifyInstance
  let passwordHash: string

  async function account(role: "customer" | "admin" = "customer") {
    const [row] = await db
      .insert(users)
      .values({
        email: `${role}-${Date.now()}-${Math.random()}${EMAIL_SUFFIX}`,
        passwordHash,
        role,
        firstname: "Jeanne",
        lastname: "Armand",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning()
    return { ...row, token: app.jwt.sign({ sub: row.id, role }) }
  }

  const call = (method: "GET" | "POST", url: string, token: string, payload?: object) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload && { payload }) })

  /** Sets the app up through the routes; returns its secret and recovery codes. */
  async function enable(user: { token: string }) {
    const setup = (await call("POST", "/api/auth/totp/setup", user.token)).json().data
    const enabled = await call("POST", "/api/auth/totp/enable", user.token, { code: codeAt(setup.secret, -1) })
    return { secret: setup.secret as string, recoveryCodes: enabled.json().data.recoveryCodes as string[] }
  }

  const actions = async (userId: string) =>
    (await db.select().from(auditLogs).where(eq(auditLogs.entityId, userId))).map((event) => event.action)

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
  })

  afterAll(async () => {
    const ids = (
      await db
        .select({ id: users.id })
        .from(users)
        .where(like(users.email, `%${EMAIL_SUFFIX}`))
    ).map((row) => row.id)
    if (ids.length > 0) {
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, ids))
      await db.delete(auditLogs).where(inArray(auditLogs.userId, ids))
      await db.delete(users).where(inArray(users.id, ids))
    }
    await app.close()
  })

  it("tells where the account stands", async () => {
    const user = await account()
    expect((await call("GET", "/api/auth/totp", user.token)).json().data).toEqual({
      enabled: false,
      enabledAt: null,
      required: false,
      recoveryCodesLeft: 0,
    })
    const admin = await account("admin")
    expect((await call("GET", "/api/auth/totp", admin.token)).json().data.required).toBe(true)
  })

  it("sets the app up: QR code, then a first code enables it and hands out the recovery codes", async () => {
    const user = await account()

    const setup = await call("POST", "/api/auth/totp/setup", user.token)
    expect(setup.statusCode).toBe(200)
    expect(setup.json().data.qrSvg).toMatch(/^<svg/)

    const wrong = await call("POST", "/api/auth/totp/enable", user.token, { code: "000000" })
    expect(wrong.statusCode).toBe(400)
    expect(wrong.json().error).toBe("InvalidTotpCode")

    const enabled = await call("POST", "/api/auth/totp/enable", user.token, {
      code: codeAt(setup.json().data.secret, -1),
    })
    expect(enabled.statusCode).toBe(200)
    expect(enabled.json().data.recoveryCodes).toHaveLength(10)
    expect((await call("GET", "/api/auth/totp", user.token)).json().data).toMatchObject({
      enabled: true,
      recoveryCodesLeft: 10,
    })
    expect(await actions(user.id)).toContain("user.totp_enabled")

    // Already on: no second setup over it.
    expect((await call("POST", "/api/auth/totp/setup", user.token)).statusCode).toBe(409)
  })

  it("regenerates the recovery codes against the app's code", async () => {
    const user = await account()
    const { secret, recoveryCodes } = await enable(user)

    const res = await call("POST", "/api/auth/totp/recovery-codes", user.token, { code: codeAt(secret, 1) })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.recoveryCodes).toHaveLength(10)
    expect(res.json().data.recoveryCodes).not.toContain(recoveryCodes[0])
    expect(await actions(user.id)).toContain("user.recovery_codes_regenerated")
  })

  it("turns the app off with the password and a code", async () => {
    const user = await account()
    const { secret } = await enable(user)

    const badPassword = await call("POST", "/api/auth/totp/disable", user.token, {
      password: "wrong-password-entirely",
      code: codeAt(secret, 1),
    })
    expect(badPassword.statusCode).toBe(401)

    const off = await call("POST", "/api/auth/totp/disable", user.token, {
      password: PASSWORD,
      code: codeAt(secret, 1),
    })
    expect(off.statusCode).toBe(200)
    expect((await call("GET", "/api/auth/totp", user.token)).json().data.enabled).toBe(false)
    expect(await actions(user.id)).toContain("user.totp_disabled")
  })

  it("never lets an admin turn it off: it is mandatory for them", async () => {
    const admin = await account("admin")
    const { secret } = await enable(admin)

    const res = await call("POST", "/api/auth/totp/disable", admin.token, {
      password: PASSWORD,
      code: codeAt(secret, 1),
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe("TotpRequired")
  })

  describe("reset by an admin (lost phone)", () => {
    it("clears another account's app, journaled, and refuses to reset one's own", async () => {
      const admin = await account("admin")
      const user = await account()
      await enable(user)

      const res = await call("POST", `/api/admin/users/${user.id}/totp/reset`, admin.token)

      expect(res.statusCode).toBe(200)
      expect((await call("GET", "/api/auth/totp", user.token)).json().data.enabled).toBe(false)
      expect(await actions(user.id)).toContain("user.totp_reset")
      expect((await call("POST", `/api/admin/users/${admin.id}/totp/reset`, admin.token)).statusCode).toBe(409)
      expect((await call("POST", `/api/admin/users/${user.id}/totp/reset`, user.token)).statusCode).toBe(403)
    })
  })
})
