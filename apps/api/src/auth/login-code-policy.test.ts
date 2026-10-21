import { describe, expect, it } from "vitest"
import { requiresLoginCode } from "./login-code-policy.js"
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

describe("whose session is capped 7 days after the login", () => {
  it("caps admins and members of an organisation", () => {
    expect(sessionExpiryFor(admin, NOW)).toEqual(CAP)
    expect(sessionExpiryFor(pro, NOW)).toEqual(CAP)
  })

  it("leaves a private customer on the sliding expiry alone", () => {
    expect(sessionExpiryFor(customer, NOW)).toBeNull()
  })
})
