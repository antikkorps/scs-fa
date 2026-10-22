import { describe, expect, it } from "vitest"
import { calculateVipDiscount, isNewFirearmQualifying, keepsQualifyingFirearm } from "./vip.js"

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

  it("takes the share of the margin SCS set (story 12.9e)", () => {
    expect(calculateVipDiscount(1000, 30, "arme-longue", 40)).toEqual({ discountPct: 12, discountAmount: 120 })
    expect(calculateVipDiscount(1000, 30, "arme-longue", 0)).toEqual({ discountPct: 0, discountAmount: 0 })
  })

  it("excludes ammunition", () => {
    expect(calculateVipDiscount(100, 30, "munition")).toEqual({ discountPct: 0, discountAmount: 0 })
  })

  it("gives no discount when there is no margin", () => {
    expect(calculateVipDiscount(100, 0, "arme-longue")).toEqual({ discountPct: 0, discountAmount: 0 })
  })
})

describe("keepsQualifyingFirearm (story 12.9e)", () => {
  const firearm = { qty: 1, category: "arme-longue", legalCategory: "C", tags: [] }
  const accessory = { qty: 3, category: "accessoire-tireur", legalCategory: "none", tags: [] }

  it("qualifies an order holding a new firearm nothing was returned of", () => {
    expect(keepsQualifyingFirearm([accessory, firearm], [])).toBe(true)
  })

  it("stops qualifying once that firearm is returned, even in a partial refund", () => {
    expect(keepsQualifyingFirearm([accessory, firearm], [{ item: 1, qty: 1 }])).toBe(false)
  })

  it("still qualifies when only part of the firearms, or other articles, were returned", () => {
    expect(keepsQualifyingFirearm([accessory, { ...firearm, qty: 2 }], [{ item: 1, qty: 1 }])).toBe(true)
    expect(keepsQualifyingFirearm([accessory, firearm], [{ item: 0, qty: 3 }])).toBe(true)
  })

  it("never qualifies an order without a new firearm", () => {
    expect(keepsQualifyingFirearm([accessory, { ...firearm, tags: ["occasion"] }], [])).toBe(false)
  })
})
