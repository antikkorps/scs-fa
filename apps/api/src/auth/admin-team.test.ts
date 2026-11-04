import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, passwordResetTokens, refreshTokens, users } from "../db/schema.js"
import { sendAdminInvitationEmail } from "../email.js"
import { base32Decode, totpCode } from "./totp.js"

vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendAdminInvitationEmail: vi.fn().mockResolvedValue(undefined),
}))

// Request Franck 2026-11-04: Fred and Steph invite the people who help them,
// as full admins, from the back-office — and take the access back.

const PASSWORD = "MotDePasseTresLong123!"
const EMAIL_SUFFIX = "@admin-team-test.local"
const STEP_MS = 30_000
const codeAt = (secret: string, offsetSteps = 0) =>
  totpCode(base32Decode(secret), Math.floor(Date.now() / STEP_MS) + offsetSteps)

describe("the back-office's admin team (/api/admin/admins)", () => {
  let app: FastifyInstance
  let passwordHash: string
  let fred: { id: string; email: string; token: string; secret: string }

  async function account(local: string, role: "customer" | "admin") {
    const email = `${local}-${Date.now()}-${Math.random()}${EMAIL_SUFFIX}`
    const [row] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        role,
        firstname: local,
        lastname: "Test",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    return { id: row.id, email, token: app.jwt.sign({ sub: row.id, role }) }
  }

  const call = (method: "GET" | "POST", url: string, token: string, payload?: object) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload && { payload }) })

  /**
   * Fred's password and app code: every change to the team asks for both. A
   * code is accepted once (replay guard), so each call starts as if from a
   * fresh code, with the refusals of the previous checks forgotten.
   */
  async function confirmed() {
    await db
      .update(users)
      .set({ totpLastStep: null, failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(users.id, fred.id))
    return { password: PASSWORD, code: codeAt(fred.secret, 1) }
  }

  async function cleanup() {
    const ids = db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `%${EMAIL_SUFFIX}`))
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, ids))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, ids))
    await db.delete(passwordResetTokens).where(inArray(passwordResetTokens.userId, ids))
    await db.delete(refreshTokens).where(inArray(refreshTokens.userId, ids))
    await db.delete(users).where(like(users.email, `%${EMAIL_SUFFIX}`))
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    await cleanup()
    const admin = await account("fred", "admin")
    const setup = (await call("POST", "/api/auth/totp/setup", admin.token, { password: PASSWORD })).json().data
    await call("POST", "/api/auth/totp/enable", admin.token, { code: codeAt(setup.secret, -1) })
    fred = { ...admin, secret: setup.secret }
  })

  beforeEach(() => {
    vi.mocked(sendAdminInvitationEmail).mockClear()
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("lists the admins: who has set up their app, whose invitation is waiting", async () => {
    const invite = await call("POST", "/api/admin/admins/invitations", fred.token, {
      email: `lea${EMAIL_SUFFIX}`,
      firstname: "Léa",
      lastname: "Bernard",
      ...(await confirmed()),
    })
    expect(invite.statusCode).toBe(201)

    const res = await call("GET", "/api/admin/admins", fred.token)

    expect(res.statusCode).toBe(200)
    const team = res.json().data as Array<Record<string, unknown>>
    expect(team.find((admin) => admin.id === fred.id)).toMatchObject({
      email: fred.email,
      totpEnabled: true,
      invitationExpiresAt: null,
      isMe: true,
    })
    expect(team.find((admin) => admin.email === `lea${EMAIL_SUFFIX}`)).toMatchObject({
      firstname: "Léa",
      lastname: "Bernard",
      totpEnabled: false,
      invitationExpiresAt: expect.any(String),
      isMe: false,
    })
    expect(team.every((admin) => !("passwordHash" in admin) && !("totpSecretEncrypted" in admin))).toBe(true)
  })

  it("invites with the admin's password and code, journaled under their name", async () => {
    const email = `paul${EMAIL_SUFFIX}`
    const invite = (payload: object) => call("POST", "/api/admin/admins/invitations", fred.token, payload)
    const who = { email, firstname: "Paul", lastname: "Roux" }

    expect((await invite(who)).statusCode).toBe(400)
    const wrongPassword = { ...(await confirmed()), password: "wrong-password-entirely" }
    expect((await invite({ ...who, ...wrongPassword })).statusCode).toBe(403)
    expect(vi.mocked(sendAdminInvitationEmail)).not.toHaveBeenCalled()

    const res = await invite({ ...who, ...(await confirmed()) })

    expect(res.statusCode).toBe(201)
    expect(res.json().data).toEqual({ email, created: true, emailSent: true })
    const [paul] = await db.select().from(users).where(eq(users.email, email))
    expect(paul?.role).toBe("admin")
    const [event] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, paul?.id ?? ""))
    expect(event).toMatchObject({ action: "user.admin_invited", userId: fred.id })
  })

  it("hands the link to the inviting admin only when the e-mail could not be sent", async () => {
    vi.mocked(sendAdminInvitationEmail).mockRejectedValueOnce(new Error("SMTP down"))

    const res = await call("POST", "/api/admin/admins/invitations", fred.token, {
      email: `nomail${EMAIL_SUFFIX}`,
      firstname: "Nora",
      lastname: "Blanc",
      ...(await confirmed()),
    })

    expect(res.json().data).toMatchObject({ emailSent: false, link: expect.stringContaining("#token=") })
  })

  it("refuses to make an existing customer an admin", async () => {
    const customer = await account("client", "customer")

    const res = await call("POST", "/api/admin/admins/invitations", fred.token, {
      email: customer.email,
      firstname: "Jean",
      lastname: "Client",
      ...(await confirmed()),
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe("NotAnAdmin")
  })

  it("takes an admin's access back at once: role, sessions and links gone, journaled", async () => {
    const helper = await account("aide", "admin")
    await db.insert(refreshTokens).values({
      userId: helper.id,
      tokenHash: `aide-${helper.id}`.padEnd(64, "0").slice(0, 64),
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    const revoke = (payload?: object) => call("POST", `/api/admin/admins/${helper.id}/revoke`, fred.token, payload)

    expect((await revoke()).statusCode).toBe(400)
    expect((await call("GET", "/api/admin/orders", helper.token)).statusCode).toBe(200)

    const res = await revoke(await confirmed())

    expect(res.statusCode).toBe(200)
    const [after] = await db.select().from(users).where(eq(users.id, helper.id))
    expect(after?.role).toBe("customer")
    expect(await db.select().from(refreshTokens).where(eq(refreshTokens.userId, helper.id))).toEqual([])
    expect((await call("GET", "/api/admin/orders", helper.token)).statusCode).toBe(403)
    const events = await db.select().from(auditLogs).where(eq(auditLogs.entityId, helper.id))
    expect(events.map((event) => event.action)).toContain("user.admin_revoked")
  })

  it("never lets an admin take their own access back, nor touch a non-admin", async () => {
    const own = await call("POST", `/api/admin/admins/${fred.id}/revoke`, fred.token, await confirmed())
    expect(own.statusCode).toBe(409)
    expect(own.json().error).toBe("OwnAccount")

    const customer = await account("autre", "customer")
    expect(
      (await call("POST", `/api/admin/admins/${customer.id}/revoke`, fred.token, await confirmed())).statusCode,
    ).toBe(404)
  })

  it("is for admins only", async () => {
    const customer = await account("curieux", "customer")
    expect((await call("GET", "/api/admin/admins", customer.token)).statusCode).toBe(403)
  })
})
