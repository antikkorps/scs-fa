import { describe, expect, it } from "vitest"
import { requiresLoginCode, secondFactorFor } from "./login-code-policy.js"
import { CAPPED_SESSION_DAYS, sessionExpiryFor } from "./tokens.js"

const NOW = new Date("2026-10-21T10:00:00Z")
const CAP = new Date(NOW.getTime() + CAPPED_SESSION_DAYS * 24 * 60 * 60 * 1000)
const ORGANISATION_ID = "5d0c2f2e-7a0e-4a52-9c39-0f8f0b0b7c11"

const customer = { id: "u1", role: "customer", organisationId: null }
const pro = { id: "u2", role: "customer", organisationId: ORGANISATION_ID }
const admin = { id: "u3", role: "admin", organisationId: null }

describe("who confirms a login with an e-mailed code (story 12.8b)", () => {
  it("asks it of every member of an organisation, whatever its status", async () => {
    expect(await requiresLoginCode(pro)).toBe(true)
  })

  it("does not ask it of a private customer nor of an admin", async () => {
    expect(await requiresLoginCode(customer)).toBe(false)
    expect(await requiresLoginCode(admin)).toBe(false)
  })
})

describe("an address never confirmed (audit 2026-11-15, M1)", () => {
  const VERIFIED = new Date("2026-11-01T10:00:00Z")
  const account = (
    overrides: Partial<{ role: string; organisationId: string | null; totpEnabledAt: Date | null }>,
  ) => ({
    role: "customer",
    organisationId: null,
    totpEnabledAt: null,
    emailVerifiedAt: null,
    ...overrides,
  })

  it("asks a private customer for the mailed code until the address is confirmed, then never again", async () => {
    expect(await secondFactorFor(account({}))).toBe("email_code")
    expect(await secondFactorFor({ ...account({}), emailVerifiedAt: VERIFIED })).toBeNull()
  })

  it("leaves the app first, and the admins' mandatory enrolment, unchanged", async () => {
    expect(await secondFactorFor(account({ totpEnabledAt: VERIFIED }))).toBe("totp")
    expect(await secondFactorFor(account({ role: "admin" }))).toBe("totp_enrollment")
  })

  it("keeps the code at every login for an organisation's member", async () => {
    expect(await secondFactorFor({ ...account({ organisationId: ORGANISATION_ID }), emailVerifiedAt: VERIFIED })).toBe(
      "email_code",
    )
  })
})

describe("whose session is capped 7 days after the login", () => {
  it("caps admins and members of an organisation", () => {
    expect(sessionExpiryFor(admin, NOW)).toEqual(CAP)
    expect(sessionExpiryFor(pro, NOW)).toEqual(CAP)
  })

  it("leaves a private customer on the sliding expiry alone", () => {
    expect(sessionExpiryFor(customer, NOW)).toBeNull()
  })
})
