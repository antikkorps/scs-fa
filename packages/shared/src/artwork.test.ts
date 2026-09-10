import { describe, expect, it } from "vitest"
import {
  type ArtworkFormatInput,
  buildArtworkPriceBands,
  buildArtworkPriceGrid,
  calculateArtworkPrice,
  calculateArtworkPriceBreakdown,
  normalizeOrientation,
  validateArtworkPriceGrid,
} from "./artwork.js"

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

describe("normalizeOrientation", () => {
  it("passes through known orientations", () => {
    expect(normalizeOrientation("portrait")).toBe("portrait")
    expect(normalizeOrientation("landscape")).toBe("landscape")
    expect(normalizeOrientation("square")).toBe("square")
  })

  it("defaults unknown / empty / non-string values to portrait", () => {
    expect(normalizeOrientation("paysage")).toBe("portrait")
    expect(normalizeOrientation("")).toBe("portrait")
    expect(normalizeOrientation(null)).toBe("portrait")
    expect(normalizeOrientation(undefined)).toBe("portrait")
    expect(normalizeOrientation(42)).toBe("portrait")
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

// --- Story 11.7: coherence of Gun Art prices across formats ---

const F = (id: string, name: string, priceFactor: number): ArtworkFormatInput => ({ id, name, priceFactor })

// The grid the client actually described: 3 formats from 40x50cm to 1m x 1m.
const SMALL_F = F("s", "40x50", 1)
const MEDIUM_F = F("m", "60x80", 1.5)
const LARGE_F = F("l", "100x100", 2)
const CLIENT_FORMATS = [SMALL_F, MEDIUM_F, LARGE_F]

describe("buildArtworkPriceBands", () => {
  it("bounds each format by its last and its first print", () => {
    const bands = buildArtworkPriceBands(50, 2, 25, CLIENT_FORMATS)
    expect(bands.map((b) => [b.formatId, b.minPriceHt, b.maxPriceHt])).toEqual([
      ["s", 50, 98], // 50x1 .. 50x1 + 2x24
      ["m", 75, 123],
      ["l", 100, 148],
    ])
  })

  it("orders formats from the smallest to the biggest whatever the input order", () => {
    const bands = buildArtworkPriceBands(50, 2, 25, [LARGE_F, SMALL_F, MEDIUM_F])
    expect(bands.map((b) => b.formatId)).toEqual(["s", "m", "l"])
  })

  it("breaks a factor tie by format name, so the order is stable", () => {
    const bands = buildArtworkPriceBands(50, 2, 25, [F("b", "B", 1), F("a", "A", 1)])
    expect(bands.map((b) => b.formatId)).toEqual(["a", "b"])
  })
})

describe("validateArtworkPriceGrid", () => {
  it("rejects the grid from the backlog: small 1/25 (98EUR) out-prices medium 25/25 (75EUR)", () => {
    const { valid, overlaps } = validateArtworkPriceGrid(50, 2, 25, CLIENT_FORMATS)
    expect(valid).toBe(false)
    expect(overlaps).toHaveLength(2)
    expect(overlaps[0]).toMatchObject({
      lowerFormatId: "s",
      upperFormatId: "m",
      lowerMaxPriceHt: 98,
      upperMinPriceHt: 75,
    })
  })

  it("tells the admin how to clear an overlap, both by increment and by factor", () => {
    const [overlap] = validateArtworkPriceGrid(50, 2, 25, CLIENT_FORMATS).overlaps
    // base x (1.5 - 1) / (25 - 1) = 25 / 24
    expect(overlap?.maxIncrementHt).toBeCloseTo(1.04, 2)
    // 1 + 2 x 24 / 50 = 1.96
    expect(overlap?.minUpperPriceFactor).toBeCloseTo(1.96, 2)
    // and applying either of them does clear it
    expect(validateArtworkPriceGrid(50, 1.04, 25, CLIENT_FORMATS.slice(0, 2)).valid).toBe(true)
    expect(validateArtworkPriceGrid(50, 2, 25, [SMALL_F, F("m", "60x80", 1.96)]).valid).toBe(true)
  })

  it("accepts a grid that satisfies base x factorDelta >= increment x (editionLimit - 1)", () => {
    // 50 x 1 = 50 >= 2 x 24 = 48
    const spread = [F("s", "40x50", 1), F("m", "60x80", 2), F("l", "100x100", 3)]
    const { valid, overlaps } = validateArtworkPriceGrid(50, 2, 25, spread)
    expect(valid).toBe(true)
    expect(overlaps).toEqual([])
  })

  it("accepts the exact boundary (touching bands) and rejects one cent past it", () => {
    // base 48, increment 2, 25 prints: small max = 48 + 48 = 96, medium min = 96
    expect(validateArtworkPriceGrid(48, 2, 25, [F("s", "S", 1), F("m", "M", 2)]).valid).toBe(true)
    expect(validateArtworkPriceGrid(47.99, 2, 25, [F("s", "S", 1), F("m", "M", 2)]).valid).toBe(false)
  })

  it("flags two formats sharing the same factor", () => {
    const { valid, overlaps } = validateArtworkPriceGrid(50, 2, 25, [F("a", "A", 1.5), F("b", "B", 1.5)])
    expect(valid).toBe(false)
    expect(overlaps[0]?.maxIncrementHt).toBe(0)
  })

  it("is satisfied by a zero increment, whatever the factors", () => {
    expect(validateArtworkPriceGrid(50, 0, 25, CLIENT_FORMATS).valid).toBe(true)
  })

  it("cannot overlap on a single-print edition (no rarity range)", () => {
    expect(validateArtworkPriceGrid(50, 2, 1, CLIENT_FORMATS).valid).toBe(true)
  })

  it("accepts zero or one format", () => {
    expect(validateArtworkPriceGrid(50, 2, 25, []).valid).toBe(true)
    expect(validateArtworkPriceGrid(50, 2, 25, [SMALL_F]).valid).toBe(true)
  })

  it("rejects invalid edition limits and negative prices", () => {
    expect(() => validateArtworkPriceGrid(50, 2, 0, CLIENT_FORMATS)).toThrow(RangeError)
    expect(() => validateArtworkPriceGrid(-1, 2, 25, CLIENT_FORMATS)).toThrow(RangeError)
  })
})

describe("buildArtworkPriceGrid", () => {
  it("returns one row per print, one cell per format, HT and TTC", () => {
    const grid = buildArtworkPriceGrid(50, 2, 25, CLIENT_FORMATS, 20)
    expect(grid.rows).toHaveLength(25)
    expect(grid.rows[0]?.printNumber).toBe(1)
    expect(grid.rows[0]?.cells).toHaveLength(3)
    expect(grid.rows[0]?.cells[0]).toMatchObject({ formatId: "s", priceHt: 98, priceTtc: 117.6 })
    expect(grid.rows[24]?.cells[2]).toMatchObject({ formatId: "l", priceHt: 100 })
  })

  it("highlights exactly the cells that out-price a bigger format", () => {
    const grid = buildArtworkPriceGrid(50, 2, 25, CLIENT_FORMATS, 20)
    // small format: 50 + 2 x (25 - n) > 75 <=> n < 12.5, so prints 1..12
    const flaggedSmall = grid.rows.filter((r) => r.cells[0]?.overlapping).map((r) => r.printNumber)
    expect(flaggedSmall).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    // the biggest format can never out-price anything
    expect(grid.rows.every((r) => r.cells[2]?.overlapping === false)).toBe(true)
  })

  it("highlights nothing on a coherent grid", () => {
    const grid = buildArtworkPriceGrid(50, 2, 25, [F("s", "S", 1), F("m", "M", 2), F("l", "L", 3)], 20)
    expect(grid.valid).toBe(true)
    expect(grid.rows.every((r) => r.cells.every((c) => c.overlapping === false))).toBe(true)
  })

  it("carries the same verdict as validateArtworkPriceGrid", () => {
    const grid = buildArtworkPriceGrid(50, 2, 25, CLIENT_FORMATS, 20)
    expect(grid.valid).toBe(false)
    expect(grid.overlaps).toHaveLength(2)
  })
})
