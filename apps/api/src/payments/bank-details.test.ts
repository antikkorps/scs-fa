import { describe, expect, it } from "vitest"
import { bankDetailsFrom, missingBankDetails } from "./bank-details.js"

const COMPLETE = {
  VIREMENT_IBAN: "FR7612345678901234567890123",
  VIREMENT_BIC: "AGRIFRPP",
  VIREMENT_BANK_NAME: "Banque",
  VIREMENT_ACCOUNT_HOLDER: "SCS Firearms SAS",
}

describe("bankDetailsFrom", () => {
  it("returns the receiving account when all four values are set", () => {
    expect(bankDetailsFrom(COMPLETE)).toEqual({
      iban: "FR7612345678901234567890123",
      bic: "AGRIFRPP",
      bankName: "Banque",
      accountHolder: "SCS Firearms SAS",
    })
  })

  it("returns null when no bank details are configured yet", () => {
    expect(bankDetailsFrom({})).toBeNull()
  })

  it("trims the values and treats blank ones as missing", () => {
    expect(bankDetailsFrom({ ...COMPLETE, VIREMENT_IBAN: " FR7612345678901234567890123 " })?.iban).toBe(
      "FR7612345678901234567890123",
    )
    expect(bankDetailsFrom({ ...COMPLETE, VIREMENT_BIC: "  " })).toBeNull()
  })
})

describe("missingBankDetails", () => {
  it("accepts all four values, or none of them", () => {
    expect(missingBankDetails(COMPLETE)).toEqual([])
    expect(missingBankDetails({})).toEqual([])
  })

  it("counts a blank value as missing", () => {
    expect(missingBankDetails({ ...COMPLETE, VIREMENT_BIC: " " })).toEqual(["VIREMENT_BIC"])
  })

  it("names the values a half-filled configuration lacks", () => {
    expect(missingBankDetails({ VIREMENT_IBAN: COMPLETE.VIREMENT_IBAN, VIREMENT_BIC: "" })).toEqual([
      "VIREMENT_BIC",
      "VIREMENT_BANK_NAME",
      "VIREMENT_ACCOUNT_HOLDER",
    ])
  })
})
