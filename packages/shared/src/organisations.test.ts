import { describe, expect, it } from "vitest"
import {
  isValidSiret,
  normaliseSiret,
  PUBLIC_LAW_NATURE_PREFIX,
  proSignupSchema,
  suggestedOrganisationType,
} from "./organisations.js"

describe("normaliseSiret", () => {
  it("drops the spaces, dots and dashes people type between groups", () => {
    expect(normaliseSiret("732 829 320 00074")).toBe("73282932000074")
    expect(normaliseSiret("732.829.320-00074")).toBe("73282932000074")
  })
})

describe("isValidSiret", () => {
  it("accepts a 14-digit number whose Luhn key is right", () => {
    expect(isValidSiret("73282932000074")).toBe(true)
  })

  it("refuses a wrong key, a wrong length or letters", () => {
    expect(isValidSiret("73282932000075")).toBe(false)
    expect(isValidSiret("7328293200007")).toBe(false)
    expect(isValidSiret("7328293200007A")).toBe(false)
    expect(isValidSiret("")).toBe(false)
  })

  it("accepts La Poste establishments, keyed on a digit sum divisible by 5", () => {
    // INSEE exception: La Poste (SIREN 356 000 000) has more establishments
    // than the Luhn key leaves room for.
    expect(isValidSiret("35600000049837")).toBe(true)
    expect(isValidSiret("35600000049838")).toBe(false)
  })
})

describe("suggestedOrganisationType", () => {
  it("proposes an administration for a public-law legal nature (7xxx)", () => {
    expect(PUBLIC_LAW_NATURE_PREFIX).toBe("7")
    expect(suggestedOrganisationType("7210")).toBe("administration")
  })

  it("proposes nothing for a company or an association", () => {
    expect(suggestedOrganisationType("5710")).toBeNull()
    expect(suggestedOrganisationType("9220")).toBeNull()
    expect(suggestedOrganisationType(null)).toBeNull()
  })
})

describe("proSignupSchema", () => {
  const valid = {
    email: "armurier@example.fr",
    password: "MotDePasseTresLong123!",
    firstName: "Jean",
    lastName: "Dupont",
    rgpdConsent: true,
    siret: "732 829 320 00074",
    legalName: "Armurerie Dupont",
    organisationType: "armurier",
  }

  it("accepts a valid request and hands back the SIRET without separators", () => {
    const parsed = proSignupSchema.parse(valid)
    expect(parsed.siret).toBe("73282932000074")
  })

  it("refuses a SIRET whose key is wrong, on the siret field", () => {
    const result = proSignupSchema.safeParse({ ...valid, siret: "73282932000075" })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(["siret"])
  })

  it("refuses an unknown organisation type", () => {
    expect(proSignupSchema.safeParse({ ...valid, organisationType: "particulier" }).success).toBe(false)
  })
})
