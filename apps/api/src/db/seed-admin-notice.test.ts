import { describe, expect, it } from "vitest"
import { productionAdminNotice } from "./seed-admin-notice.js"

// Franck, 2026-11-23: « No admin seeded in production » read as « no admin »
// while Fred and he had accounts. The seed now says what is there.
describe("productionAdminNotice", () => {
  it("counts the admins in place, and says the seed creates none", () => {
    expect(productionAdminNotice(2)).toBe(
      "✅ 2 admins in place; the seed creates none in production (invitations only)",
    )
    expect(productionAdminNotice(1)).toBe("✅ 1 admin in place; the seed creates none in production (invitations only)")
  })

  it("warns when there is none, with the way to invite one", () => {
    expect(productionAdminNotice(0)).toBe("⚠️  No admin yet: invite one with `just admin-invite <email> <prénom> <nom>`")
  })
})
