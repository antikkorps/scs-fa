import { describe, expect, it } from "vitest"
import { requiredAge } from "./age.js"

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
