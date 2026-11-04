import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, passwordResetTokens, users } from "../db/schema.js"
import { sendAdminInvitationEmail } from "../email.js"
import { ADMIN_INVITATION_TTL_HOURS, inviteAdmin } from "./admin-invite.js"

vi.mock("../email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email.js")>()),
  sendAdminInvitationEmail: vi.fn().mockResolvedValue(undefined),
}))

// Decision Franck 2026-11-04: admins are invited, never given a password. The
// invited person chooses theirs through a single-use link, then enrols their
// authenticator app at the first login (already mandatory for admins).

const EMAIL_SUFFIX = "@admin-invite-test.local"
const CHOSEN_PASSWORD = "UnMotDePasseChoisiTresLong-2026"
const HOUR_MS = 60 * 60 * 1000

const tokenOf = (link: string) => new URL(link).hash.replace("#token=", "")

describe("inviting an admin", () => {
  let app: FastifyInstance

  const resetPassword = (token: string, password = CHOSEN_PASSWORD) =>
    app.inject({ method: "POST", url: "/api/auth/reset-password", payload: { token, password } })
  const login = (email: string, password = CHOSEN_PASSWORD) =>
    app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } })

  async function cleanup() {
    const ids = db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `%${EMAIL_SUFFIX}`))
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, ids))
    await db.delete(passwordResetTokens).where(inArray(passwordResetTokens.userId, ids))
    await db.delete(users).where(like(users.email, `%${EMAIL_SUFFIX}`))
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
  })

  beforeEach(() => {
    vi.mocked(sendAdminInvitationEmail).mockClear()
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("creates the admin without a usable password, and mails a single-use link", async () => {
    const email = `fred${EMAIL_SUFFIX}`
    const now = new Date()

    const invitation = await inviteAdmin({ email: ` Fred${EMAIL_SUFFIX} `, firstname: "Fred", lastname: "Martin" }, now)

    expect(invitation).toMatchObject({ created: true, email })
    expect(invitation.link).toMatch(/\/reset-password#token=[A-Za-z0-9_-]+$/)
    const [admin] = await db.select().from(users).where(eq(users.email, email))
    expect(admin).toMatchObject({ role: "admin", firstname: "Fred", lastname: "Martin", totpEnabledAt: null })
    expect(vi.mocked(sendAdminInvitationEmail)).toHaveBeenCalledWith(
      email,
      invitation.link,
      ADMIN_INVITATION_TTL_HOURS,
      { userId: admin?.id },
    )
    const [token] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, admin?.id ?? ""))
    expect(token?.expiresAt.getTime()).toBe(now.getTime() + ADMIN_INVITATION_TTL_HOURS * HOUR_MS)
    const audit = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, admin?.id ?? ""))
    expect(audit.map((event) => event.action)).toContain("user.admin_invited")

    // No password opens the account before the invitation is used.
    expect((await login(email, "AdminSCS-ChangeMe-2026!")).statusCode).toBe(401)
  })

  it("lets the invited admin choose a password, then asks them to enrol their app", async () => {
    const email = `steph${EMAIL_SUFFIX}`
    const invitation = await inviteAdmin({ email, firstname: "Steph", lastname: "Durand" })

    expect((await resetPassword(tokenOf(invitation.link))).statusCode).toBe(200)
    expect((await resetPassword(tokenOf(invitation.link), `${CHOSEN_PASSWORD}-bis`)).statusCode).toBe(400)

    const res = await login(email)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ codeRequired: true, method: "totp_enrollment" })
  })

  it("invites an existing admin again: a new link, and the previous one stops working", async () => {
    const email = `again${EMAIL_SUFFIX}`
    const first = await inviteAdmin({ email, firstname: "Anne", lastname: "Petit" })

    const second = await inviteAdmin({ email, firstname: "Anne", lastname: "Petit" })

    expect(second.created).toBe(false)
    expect(second.link).not.toBe(first.link)
    expect((await resetPassword(tokenOf(first.link))).statusCode).toBe(400)
    expect((await resetPassword(tokenOf(second.link))).statusCode).toBe(200)
  })

  it("never turns an existing customer into an admin", async () => {
    const email = `client${EMAIL_SUFFIX}`
    await db.insert(users).values({
      email,
      passwordHash: "not-used",
      role: "customer",
      rgpdConsentAt: new Date(),
      rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
    })

    await expect(inviteAdmin({ email, firstname: "Jean", lastname: "Client" })).rejects.toThrow(/not an admin/)

    const [account] = await db.select().from(users).where(eq(users.email, email))
    expect(account?.role).toBe("customer")
    expect(vi.mocked(sendAdminInvitationEmail)).not.toHaveBeenCalled()
  })

  it("still hands the link back when the e-mail cannot be sent", async () => {
    vi.mocked(sendAdminInvitationEmail).mockRejectedValueOnce(new Error("SMTP down"))

    const invitation = await inviteAdmin({ email: `nomail${EMAIL_SUFFIX}`, firstname: "Paul", lastname: "Roux" })

    expect(invitation.emailSent).toBe(false)
    expect((await resetPassword(tokenOf(invitation.link))).statusCode).toBe(200)
  })
})
