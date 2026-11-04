import { describe, expect, it } from "vitest"
import { adminInvitationRequestSchema } from "./admin-team.js"

describe("adminInvitationRequestSchema (request Franck 2026-11-04)", () => {
  const who = { email: "Lea@Example.fr", firstname: "Léa", lastname: "Bernard" }

  it("takes who to invite with the inviting admin's password and code", () => {
    expect(adminInvitationRequestSchema.parse({ ...who, password: "secret", code: "123 456" })).toEqual({
      email: "lea@example.fr",
      firstname: "Léa",
      lastname: "Bernard",
      password: "secret",
      code: "123 456",
    })
  })

  it("refuses an invitation without the password", () => {
    expect(adminInvitationRequestSchema.safeParse(who).success).toBe(false)
  })

  it("refuses anything else, such as a role", () => {
    expect(adminInvitationRequestSchema.safeParse({ ...who, password: "secret", role: "customer" }).success).toBe(false)
  })
})
