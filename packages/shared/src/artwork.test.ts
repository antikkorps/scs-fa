import { describe, expect, it } from "vitest"
import { calculateArtworkPrice, calculateArtworkPriceBreakdown } from "./artwork.js"

const SMALL = { priceFactor: 1.0 }
const MEDIUM = { priceFactor: 1.5 }
const LARGE = { priceFactor: 2.0 }

describe("calculateArtworkPrice", () => {
  // Reference examples from docs/seeds_and_workflows.ts (base 50€, increment 2€, edition 25)
  it("prices print 5/25 in medium format at 115€ HT", () => {
    expect(calculateArtworkPrice(50, 2, 25, 5, MEDIUM)).toBe(115)
  })

  it("prices the last print (25/25) in large format at 100€ HT (no rarity bonus)", () => {
    expect(calculateArtworkPrice(50, 2, 25, 25, LARGE)).toBe(100)
  })

  it("prices the first print (1/25) in large format at 148€ HT", () => {
    expect(calculateArtworkPrice(50, 2, 25, 1, LARGE)).toBe(148)
  })

  it("makes earlier prints strictly more expensive than later ones", () => {
    const early = calculateArtworkPrice(50, 2, 25, 1, SMALL)
    const late = calculateArtworkPrice(50, 2, 25, 25, SMALL)
    expect(early).toBeGreaterThan(late)
    expect(late).toBe(50) // last print = base only
  })

  it("scales only the base price by the format factor, never the rarity bonus", () => {
    // bonus for 10/25 = 2 * 15 = 30, identical across formats; base differs
    expect(calculateArtworkPrice(50, 2, 25, 10, SMALL)).toBe(50 * 1.0 + 30)
    expect(calculateArtworkPrice(50, 2, 25, 10, LARGE)).toBe(50 * 2.0 + 30)
  })

  it("rounds the result to 2 decimals (cents)", () => {
    // 10.001 * 1.0 = 10.001 -> 10.00
    expect(calculateArtworkPrice(10.001, 0, 10, 1, SMALL)).toBe(10)
  })

  it("handles a single-print edition (1/1)", () => {
    expect(calculateArtworkPrice(50, 2, 1, 1, SMALL)).toBe(50)
  })

  it("rejects an out-of-range print number", () => {
    expect(() => calculateArtworkPrice(50, 2, 25, 0, SMALL)).toThrow(RangeError)
    expect(() => calculateArtworkPrice(50, 2, 25, 26, SMALL)).toThrow(RangeError)
    expect(() => calculateArtworkPrice(50, 2, 25, 1.5, SMALL)).toThrow(RangeError)
  })

  it("rejects a non-positive edition limit", () => {
    expect(() => calculateArtworkPrice(50, 2, 0, 1, SMALL)).toThrow(RangeError)
    expect(() => calculateArtworkPrice(50, 2, -5, 1, SMALL)).toThrow(RangeError)
  })

  it("rejects a non-positive format factor and negative prices", () => {
    expect(() => calculateArtworkPrice(50, 2, 25, 1, { priceFactor: 0 })).toThrow(RangeError)
    expect(() => calculateArtworkPrice(-1, 2, 25, 1, SMALL)).toThrow(RangeError)
    expect(() => calculateArtworkPrice(50, -2, 25, 1, SMALL)).toThrow(RangeError)
  })
})

describe("calculateArtworkPriceBreakdown", () => {
  it("returns HT and 20% VAT-inclusive TTC", () => {
    expect(calculateArtworkPriceBreakdown(50, 2, 25, 5, MEDIUM, 20)).toEqual({
      priceHt: 115,
      priceTtc: 138,
    })
  })
})
