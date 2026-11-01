import { describe, expect, it } from "vitest"
import { ACCOUNT_DELETION_BLOCKERS, accountExportFilename, accountReauthSchema } from "./account-data.js"

describe("account data rights (story 12.11)", () => {
  describe("re-authentication before an export or a deletion", () => {
    it("asks for the password alone when the account has no authenticator app", () => {
      expect(accountReauthSchema.safeParse({ password: "secret" }).success).toBe(true)
    })

    it("takes the app's code, or a recovery code, alongside the password", () => {
      expect(accountReauthSchema.safeParse({ password: "secret", code: "123 456" }).success).toBe(true)
      expect(accountReauthSchema.safeParse({ password: "secret", code: "ABCDE-12345" }).success).toBe(true)
    })

    it("refuses an empty password, a malformed code and any extra field", () => {
      expect(accountReauthSchema.safeParse({ password: "" }).success).toBe(false)
      expect(accountReauthSchema.safeParse({ password: "secret", code: "12" }).success).toBe(false)
      expect(accountReauthSchema.safeParse({ password: "secret", userId: "someone-else" }).success).toBe(false)
    })
  })

  it("names every reason a deletion can be refused", () => {
    expect(ACCOUNT_DELETION_BLOCKERS).toEqual([
      "AdminAccount",
      "OrganisationAccount",
      "OrderInProgress",
      "QuoteInProgress",
    ])
  })

  it("dates the export file, so two exports never overwrite each other unnoticed", () => {
    expect(accountExportFilename(new Date("2026-11-01T22:30:00Z"))).toBe("scs-firearms-mes-donnees-2026-11-01.json")
  })
})
