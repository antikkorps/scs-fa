import { describe, expect, it } from "vitest"
import { ageOn, isPlausibleBirthDate, requiredAge } from "./age.js"

describe("requiredAge (story 12.13c)", () => {
  it("takes the product's own age, else its legal category's", () => {
    expect(requiredAge({ ageMinRequired: 16, legalMinAge: 18, categorySlug: "accessoire-autre" })).toBe(16)
    expect(requiredAge({ ageMinRequired: null, legalMinAge: 18, categorySlug: "arme-longue" })).toBe(18)
    expect(requiredAge({ ageMinRequired: null, legalMinAge: 0, categorySlug: "accessoire-autre" })).toBe(0)
    expect(requiredAge({ ageMinRequired: null, legalMinAge: null, categorySlug: "accessoire-autre" })).toBe(0)
  })

  it("reserves every knife to adults, whatever its legal category (Franck 2026-11-15)", () => {
    expect(requiredAge({ ageMinRequired: null, legalMinAge: 0, categorySlug: "coutellerie" })).toBe(18)
    expect(requiredAge({ ageMinRequired: 16, legalMinAge: 0, categorySlug: "coutellerie" })).toBe(18)
  })
})

describe("ageOn", () => {
  it("counts whole years, the birthday itself included", () => {
    expect(ageOn("2008-11-15", "2026-11-15")).toBe(18)
    expect(ageOn("2008-11-16", "2026-11-15")).toBe(17)
    expect(ageOn("2008-12-01", "2026-11-15")).toBe(17)
  })

  it("turns someone born on 29 February a year older on 1 March", () => {
    expect(ageOn("2008-02-29", "2026-02-28")).toBe(17)
    expect(ageOn("2008-02-29", "2026-03-01")).toBe(18)
  })
})

describe("isPlausibleBirthDate", () => {
  const today = "2026-11-15"

  it("accepts a real past date", () => {
    expect(isPlausibleBirthDate("1980-05-17", today)).toBe(true)
  })

  it("refuses a malformed, impossible, future or implausibly old date", () => {
    expect(isPlausibleBirthDate("17/05/1980", today)).toBe(false)
    expect(isPlausibleBirthDate("1980-02-30", today)).toBe(false)
    expect(isPlausibleBirthDate("2027-01-01", today)).toBe(false)
    expect(isPlausibleBirthDate("1899-12-31", today)).toBe(false)
  })
})
