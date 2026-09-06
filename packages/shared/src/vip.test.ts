import { describe, expect, it } from "vitest"
import { calculateVipDiscount, isNewFirearmQualifying } from "./vip.js"

describe("isNewFirearmQualifying", () => {
  it("qualifies a new firearm in legal category B/C/D", () => {
    expect(isNewFirearmQualifying("B", "arme-longue")).toBe(true)
    expect(isNewFirearmQualifying("C", "arme-longue")).toBe(true)
    expect(isNewFirearmQualifying("D", "arme-defense")).toBe(true)
  })

  it("does not qualify a firearm tagged second-hand or historical", () => {
    expect(isNewFirearmQualifying("C", "arme-poing", ["occasion"])).toBe(false)
    expect(isNewFirearmQualifying("B", "arme-longue", ["arme-ancienne"])).toBe(false)
    expect(isNewFirearmQualifying("B", "arme-longue", ["arme-historique"])).toBe(false)
  })

  it("still qualifies when the tags carry nothing about state", () => {
    expect(isNewFirearmQualifying("B", "arme-longue", ["calibre-12"])).toBe(true)
    expect(isNewFirearmQualifying("B", "arme-longue", [])).toBe(true)
  })

  it("disqualifies as soon as one tag marks the piece as not new", () => {
    expect(isNewFirearmQualifying("B", "arme-longue", ["calibre-12", "occasion"])).toBe(false)
  })

  it("still reads the legacy category on orders placed before story 11.1", () => {
    // Those snapshots carry no tags at all: without the category fallback an old
    // second-hand purchase would retroactively become VIP-qualifying.
    expect(isNewFirearmQualifying("C", "occasion")).toBe(false)
    expect(isNewFirearmQualifying("B", "arme-ancienne")).toBe(false)
  })

  it("does not qualify non-regulated items or missing legal category", () => {
    expect(isNewFirearmQualifying("none", "munition")).toBe(false)
    expect(isNewFirearmQualifying(null, "arme-longue")).toBe(false)
    expect(isNewFirearmQualifying("A", "arme-longue")).toBe(false)
  })
})

describe("calculateVipDiscount", () => {
  it("gives 50% of the product margin", () => {
    expect(calculateVipDiscount(1000, 30, "arme-longue")).toEqual({
      discountPct: 15,
      discountAmount: 150,
    })
  })

  it("excludes ammunition", () => {
    expect(calculateVipDiscount(100, 30, "munition")).toEqual({ discountPct: 0, discountAmount: 0 })
  })

  it("gives no discount when there is no margin", () => {
    expect(calculateVipDiscount(100, 0, "arme-longue")).toEqual({ discountPct: 0, discountAmount: 0 })
  })
})
