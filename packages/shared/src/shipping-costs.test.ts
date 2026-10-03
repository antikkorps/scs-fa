import { describe, expect, it } from "vitest"
import { calculateOrderPaymentSplit } from "./orders.js"
import {
  computeShippingCost,
  DEFAULT_SHIPPING_RATES,
  isDeliverableAddress,
  type ShippableLine,
  type ShippingRates,
  shippingClassLabel,
  shippingClassOf,
} from "./shipping-costs.js"
import { shippingRatesSchema } from "./validation.js"

const RATES: ShippingRates = { firearmParcelTtc: 25, smallParcelTtc: 9, smallParcelFreeFromTtc: 150, printTtc: 15 }

function line(overrides: Partial<ShippableLine>): ShippableLine {
  return {
    kind: "product",
    categorySlug: "accessoire",
    qty: 1,
    parcelCount: 1,
    vatPct: 20,
    netHt: 50,
    lineTtc: 60,
    requiresPaymentVirement: false,
    ...overrides,
  }
}

const sumTtc = (q: { portions: { amountTtc: number }[] }) =>
  Math.round(q.portions.reduce((s, p) => s + p.amountTtc, 0) * 100) / 100

describe("shippingClassOf", () => {
  it("classes firearms by category, everything else product-side as small, prints apart", () => {
    expect(shippingClassOf({ kind: "product", categorySlug: "arme-poing" })).toBe("firearm")
    expect(shippingClassOf({ kind: "product", categorySlug: "arme-longue" })).toBe("firearm")
    expect(shippingClassOf({ kind: "product", categorySlug: "munition" })).toBe("small")
    expect(shippingClassOf({ kind: "product", categorySlug: "optique" })).toBe("small")
    expect(shippingClassOf({ kind: "print", categorySlug: "gun-art" })).toBe("print")
  })
})

describe("computeShippingCost", () => {
  it("is free for an empty cart", () => {
    const q = computeShippingCost([], RATES)
    expect(q).toMatchObject({ totalTtc: 0, totalHt: 0, vatAmount: 0, breakdown: [], portions: [] })
  })

  it("charges a firearm per parcel: a category B weapon travels in two", () => {
    const q = computeShippingCost([line({ categorySlug: "arme-poing", parcelCount: 2, qty: 1 })], RATES)
    expect(q.totalTtc).toBe(50)
    expect(q.breakdown).toEqual([{ shippingClass: "firearm", units: 2, amountTtc: 50 }])
  })

  it("multiplies parcels by quantity", () => {
    const q = computeShippingCost([line({ categorySlug: "arme-longue", parcelCount: 2, qty: 3 })], RATES)
    expect(q.breakdown[0]).toEqual({ shippingClass: "firearm", units: 6, amountTtc: 150 })
  })

  it("treats a nonsensical parcel count as one parcel", () => {
    const q = computeShippingCost([line({ categorySlug: "arme-poing", parcelCount: 0 })], RATES)
    expect(q.totalTtc).toBe(25)
  })

  it("charges small parcels once per order, however many lines", () => {
    const q = computeShippingCost(
      [line({ categorySlug: "munition", lineTtc: 30, netHt: 25 }), line({ lineTtc: 40, netHt: 33.33 })],
      RATES,
    )
    expect(q.totalTtc).toBe(9)
    expect(q.breakdown).toEqual([{ shippingClass: "small", units: 1, amountTtc: 9 }])
    expect(q.smallParcelFree).toBe(false)
    expect(q.smallParcelFreeRemainingTtc).toBe(80)
  })

  it("waives small parcels from the threshold (inclusive), on what the customer pays", () => {
    const q = computeShippingCost([line({ lineTtc: 100 }), line({ lineTtc: 50 })], RATES)
    expect(q.totalTtc).toBe(0)
    expect(q.smallParcelFree).toBe(true)
    expect(q.smallParcelFreeRemainingTtc).toBeNull()
    expect(q.breakdown).toEqual([{ shippingClass: "small", units: 1, amountTtc: 0 }])
    expect(q.portions).toEqual([])
  })

  it("never waives small parcels when the grid has no threshold", () => {
    const q = computeShippingCost([line({ lineTtc: 10_000 })], { ...RATES, smallParcelFreeFromTtc: null })
    expect(q.totalTtc).toBe(9)
    expect(q.smallParcelFreeRemainingTtc).toBeNull()
  })

  it("does not count firearms or prints towards the small-parcel threshold", () => {
    const q = computeShippingCost(
      [
        line({ categorySlug: "arme-poing", lineTtc: 900 }),
        line({ kind: "print", lineTtc: 400 }),
        line({ lineTtc: 20 }),
      ],
      RATES,
    )
    expect(q.smallParcelFree).toBe(false)
    expect(q.totalTtc).toBe(25 + 15 + 9)
  })

  it("charges each print", () => {
    const q = computeShippingCost([line({ kind: "print", categorySlug: "gun-art" }), line({ kind: "print" })], RATES)
    expect(q.breakdown).toEqual([{ shippingClass: "print", units: 2, amountTtc: 30 }])
  })

  it("sums the classes present", () => {
    const q = computeShippingCost(
      [
        line({ categorySlug: "arme-poing", parcelCount: 2 }),
        line({ categorySlug: "munition", lineTtc: 40 }),
        line({ kind: "print" }),
      ],
      RATES,
    )
    expect(q.totalTtc).toBe(50 + 9 + 15)
    expect(q.breakdown.map((b) => b.shippingClass)).toEqual(["firearm", "small", "print"])
  })

  it("splits each slice into HT + VAT that add up to the TTC exactly", () => {
    const q = computeShippingCost([line({ categorySlug: "arme-poing", vatPct: 20 })], {
      ...RATES,
      firearmParcelTtc: 7.9,
    })
    expect(q.portions).toEqual([
      { amountTtc: 7.9, priceHt: 6.58, vatAmount: 1.32, vatPct: 20, requiresPaymentVirement: false },
    ])
    expect(q.totalHt + q.vatAmount).toBeCloseTo(q.totalTtc, 10)
  })

  it("taxes small parcels pro rata of the net HT of the goods they carry", () => {
    // 75 % of the goods at 20 %, 25 % at 5.5 %.
    const q = computeShippingCost(
      [line({ netHt: 300, lineTtc: 0, vatPct: 20 }), line({ netHt: 100, lineTtc: 0, vatPct: 5.5 })],
      { ...RATES, smallParcelTtc: 10 },
    )
    expect(q.portions.map((p) => [p.vatPct, p.amountTtc])).toEqual([
      [20, 7.5],
      [5.5, 2.5],
    ])
  })

  it("allocates to the cent with no cent lost or invented", () => {
    const lines = [1, 1, 1].map(() => line({ netHt: 10, lineTtc: 0 }))
    const q = computeShippingCost(lines, { ...RATES, smallParcelTtc: 10 })
    expect(q.portions.map((p) => p.amountTtc).sort()).toEqual([3.33, 3.33, 3.34])
    expect(sumTtc(q)).toBe(10)
  })

  it("shares evenly when every carried line is free", () => {
    const q = computeShippingCost([line({ netHt: 0, lineTtc: 0 }), line({ netHt: 0, lineTtc: 0 })], {
      ...RATES,
      smallParcelTtc: 9,
    })
    expect(q.portions.map((p) => p.amountTtc)).toEqual([4.5, 4.5])
  })

  it("follows each line's payment bucket: a transfer-only weapon's delivery is paid by transfer", () => {
    const q = computeShippingCost(
      [
        line({ categorySlug: "arme-poing", parcelCount: 2, requiresPaymentVirement: true }),
        line({ categorySlug: "optique", lineTtc: 40 }),
      ],
      RATES,
    )
    const split = calculateOrderPaymentSplit(
      q.portions.map((p) => ({
        priceHt: p.priceHt,
        vatPct: p.vatPct,
        vatAmount: p.vatAmount,
        requiresPaymentVirement: p.requiresPaymentVirement,
      })),
    )
    expect(split.virement.amountTtc).toBe(50)
    expect(split.carte.amountTtc).toBe(9)
  })

  it("ships a sane default grid", () => {
    expect(DEFAULT_SHIPPING_RATES.firearmParcelTtc).toBeGreaterThan(0)
    expect(DEFAULT_SHIPPING_RATES.smallParcelTtc).toBeGreaterThan(0)
    expect(DEFAULT_SHIPPING_RATES.printTtc).toBeGreaterThan(0)
  })
})

describe("isDeliverableAddress", () => {
  it.each([
    ["FR", "75001", true],
    ["fr", " 69002 ", true],
    ["FR", "20000", true], // Ajaccio — Corsica is in
    ["FR", "20200", true], // Bastia
    ["FR", "01000", true],
    ["FR", "95000", true],
    ["FR", "97400", false], // La Réunion
    ["FR", "98800", false], // Nouvelle-Calédonie
    ["FR", "00100", false],
    ["FR", "7500", false],
    ["FR", "2A000", false],
    ["BE", "75001", false],
    ["MC", "98000", false],
  ])("%s %s → %s", (country, postal, expected) => {
    expect(isDeliverableAddress({ country, postal })).toBe(expected)
  })
})

describe("shippingClassLabel", () => {
  it("names each class for the customer", () => {
    expect(shippingClassLabel({ shippingClass: "firearm", units: 2 })).toContain("2 colis assurés")
    expect(shippingClassLabel({ shippingClass: "firearm", units: 1 })).toContain("1 colis assuré,")
    expect(shippingClassLabel({ shippingClass: "small", units: 1 })).toBe("Munitions et accessoires")
    expect(shippingClassLabel({ shippingClass: "print", units: 1 })).toContain("1 envoi ")
  })
})

describe("shippingRatesSchema", () => {
  it("accepts a full grid, cents included, and a null threshold", () => {
    expect(shippingRatesSchema.parse({ ...RATES, smallParcelTtc: "8.90", smallParcelFreeFromTtc: null })).toEqual({
      ...RATES,
      smallParcelTtc: 8.9,
      smallParcelFreeFromTtc: null,
    })
  })

  it.each([
    [{ ...RATES, firearmParcelTtc: -1 }],
    [{ ...RATES, printTtc: 1.234 }],
    [{ ...RATES, extra: 1 }],
    [{ firearmParcelTtc: 25 }],
  ])("refuses %o", (input) => {
    expect(shippingRatesSchema.safeParse(input).success).toBe(false)
  })
})
