import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, users } from "../db/schema.js"
import { sendSignupAddressTakenEmail, sendSignupWelcomeEmail } from "../email.js"
import { hashPassword } from "./password.js"

vi.mock("./password.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./password.js")>()
  return { ...original, hashPassword: vi.fn(original.hashPassword) }
})
vi.mock("../email.js", () => ({
  sendSignupWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  sendSignupAddressTakenEmail: vi.fn().mockResolvedValue(undefined),
}))

const TEST_EMAIL_SUFFIX = "@register-test.local"

const CHECK_INBOX = { message: "Check your inbox to continue." }
// The e-mails leave after the answer: room for a loaded CI runner.
const WAIT = { timeout: 5_000 }

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
    vi.clearAllMocks()
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

  const register = (email: string) =>
    app.inject({ method: "POST", url: "/api/auth/register", payload: validPayload(email) })

  /** The warning is journalled after the answer: wait for it, or the cleanup races its foreign key. */
  async function takenAddressJournalled(email: string) {
    const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
    await vi.waitFor(async () => {
      const events = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.userId, owner?.id ?? ""))
      expect(events.map((event) => event.action)).toContain("user.signup_on_taken_address")
    }, WAIT)
  }

  // Story "sign-up without enumeration": a free address and a taken one get
  // the same answer; only the mailbox learns which case it was.
  it("creates the account, answers 202 without the profile, and welcomes the address", async () => {
    const email = `success-${Date.now()}${TEST_EMAIL_SUFFIX}`
    const res = await register(email)

    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual(CHECK_INBOX)

    const [row] = await db.select().from(users).where(eq(users.email, email))
    expect(row.passwordHash).not.toBe("MotDePasseTresLong123!")
    expect(row.passwordHash.startsWith("$argon2id$")).toBe(true)
    expect(row.rgpdConsentAt).toBeInstanceOf(Date)
    expect(row.rgpdConsentVersion).toBe("1.0")
    await vi.waitFor(() => expect(sendSignupWelcomeEmail).toHaveBeenCalledWith(email, { userId: row.id }), WAIT)
    expect(sendSignupAddressTakenEmail).not.toHaveBeenCalled()
  })

  it("normalizes email to lowercase", async () => {
    const email = `MixedCase-${Date.now()}${TEST_EMAIL_SUFFIX}`
    expect((await register(email)).statusCode).toBe(202)

    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase()))
    expect(row).toBeDefined()
  })

  it("answers a taken address exactly like a free one, creates nothing and warns its owner", async () => {
    const email = `dup-${Date.now()}${TEST_EMAIL_SUFFIX}`
    await register(email)
    const [owner] = await db.select().from(users).where(eq(users.email, email))
    vi.mocked(sendSignupWelcomeEmail).mockClear()

    const second = await register(email.toUpperCase())

    expect(second.statusCode).toBe(202)
    expect(second.json()).toEqual(CHECK_INBOX)
    const rows = await db.select().from(users).where(eq(users.email, email))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.passwordHash).toBe(owner?.passwordHash)
    await vi.waitFor(
      () => expect(sendSignupAddressTakenEmail).toHaveBeenCalledWith(email, { userId: owner?.id }, {}),
      WAIT,
    )
    expect(sendSignupWelcomeEmail).not.toHaveBeenCalled()
    await takenAddressJournalled(email)
  })

  it("does not wait for the e-mail: a slow relay cannot tell a taken address by the delay", async () => {
    const email = `slow-${Date.now()}${TEST_EMAIL_SUFFIX}`
    await register(email)
    const never = new Promise<void>(() => {})
    vi.mocked(sendSignupAddressTakenEmail).mockImplementationOnce(() => never)

    const res = await register(email)

    expect(res.statusCode).toBe(202)
    await takenAddressJournalled(email)
  })

  it("does not wait for the welcome e-mail either", async () => {
    const never = new Promise<void>(() => {})
    vi.mocked(sendSignupWelcomeEmail).mockImplementationOnce(() => never)

    const res = await register(`slow-welcome-${Date.now()}${TEST_EMAIL_SUFFIX}`)

    expect(res.statusCode).toBe(202)
  })

  it("hashes the password for a taken address too, so both answers cost the same", async () => {
    const email = `cost-${Date.now()}${TEST_EMAIL_SUFFIX}`
    await register(email)
    vi.mocked(hashPassword).mockClear()

    await register(email)

    expect(hashPassword).toHaveBeenCalledOnce()
    await takenAddressJournalled(email)
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
