import { describe, expect, it } from "vitest"
import {
  type CrossSellCandidate,
  type CrossSellSource,
  canAttachCrossSell,
  crossSellRejectionMessage,
  displayableCrossSells,
  isCrossSellBuyable,
  MAX_CROSS_SELLS_PER_PRODUCT,
  rejectCrossSell,
} from "./cross-sell.js"

const weaponB: CrossSellSource = { id: "w1", categorySlug: "arme-poing", legalCategory: "B" }
const weaponD: CrossSellSource = { id: "w2", categorySlug: "arme-defense", legalCategory: "D" }

function accessory(over: Partial<CrossSellCandidate> = {}): CrossSellCandidate {
  return {
    id: "a1",
    categorySlug: "aide-visee",
    legalCategory: "none",
    published: true,
    trackStock: true,
    stockQty: 5,
    ...over,
  }
}

describe("rejectCrossSell", () => {
  it("accepts a freely sold accessory on a regulated firearm", () => {
    expect(rejectCrossSell(weaponB, accessory())).toBeNull()
    expect(canAttachCrossSell(weaponB, accessory())).toBe(true)
  })

  it("refuses an article suggesting itself", () => {
    expect(rejectCrossSell(weaponB, accessory({ id: weaponB.id }))).toBe("self")
  })

  it("only lets a firearm carry the block", () => {
    const ammoAsSource: CrossSellSource = { id: "m1", categorySlug: "munition", legalCategory: "B" }
    expect(rejectCrossSell(ammoAsSource, accessory())).toBe("source-not-a-weapon")
  })

  /** A weapon is never an accessory: no firearm is ever suggested by another. */
  it("refuses to suggest another firearm", () => {
    expect(rejectCrossSell(weaponB, accessory({ id: "w3", categorySlug: "arme-longue", legalCategory: "C" }))).toBe(
      "not-an-accessory",
    )
  })

  /**
   * ⚠️ The only legal rule the code can hold, and it runs one way: category B
   * ammunition on a category D weapon sends the buyer towards a purchase they
   * cannot complete, while a freely sold accessory on a B firearm is fine.
   */
  it("refuses an accessory that demands more paperwork than the weapon", () => {
    const ammoB = accessory({ id: "m2", categorySlug: "munition", legalCategory: "B" })
    expect(rejectCrossSell(weaponD, ammoB)).toBe("stricter-legal-category")
    expect(rejectCrossSell(weaponB, ammoB)).toBeNull()
  })

  it("names every rejection", () => {
    expect(crossSellRejectionMessage("stricter-legal-category")).toMatch(/formalités/)
  })
})

describe("isCrossSellBuyable", () => {
  it("drops an unpublished or sold-out accessory", () => {
    expect(isCrossSellBuyable(accessory({ published: false }))).toBe(false)
    expect(isCrossSellBuyable(accessory({ stockQty: 0 }))).toBe(false)
  })

  it("keeps an accessory whose stock is not tracked", () => {
    expect(isCrossSellBuyable(accessory({ trackStock: false, stockQty: 0 }))).toBe(true)
  })
})

describe("displayableCrossSells", () => {
  /**
   * The rules are re-applied at display, not only at capture: a weapon
   * reclassified after the fact must stop offering what became too demanding.
   */
  it("re-checks the rules against the source as it is now", () => {
    const ammoB = accessory({ id: "m2", categorySlug: "munition", legalCategory: "B" })
    expect(displayableCrossSells(weaponB, [ammoB])).toHaveLength(1)
    expect(displayableCrossSells(weaponD, [ammoB])).toHaveLength(0)
  })

  it("keeps the admin's order and caps the block", () => {
    const many = Array.from({ length: MAX_CROSS_SELLS_PER_PRODUCT + 3 }, (_, i) => accessory({ id: `a${i}` }))
    const shown = displayableCrossSells(weaponB, many)
    expect(shown).toHaveLength(MAX_CROSS_SELLS_PER_PRODUCT)
    expect(shown[0]?.id).toBe("a0")
  })

  it("hides what cannot be bought", () => {
    expect(
      displayableCrossSells(weaponB, [accessory({ published: false }), accessory({ id: "a2", stockQty: 0 })]),
    ).toEqual([])
  })
})
