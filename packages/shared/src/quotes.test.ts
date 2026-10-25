import { describe, expect, it } from "vitest"
import {
  adminQuoteUpdateSchema,
  discountPctOf,
  organisationBillingAddressSchema,
  quotedUnitPriceHt,
  quoteTotals,
} from "./quotes.js"
import { type ShippableLine, spreadShippingTtc } from "./shipping-costs.js"

function shippable(overrides: Partial<ShippableLine>): ShippableLine {
  return {
    kind: "product",
    categorySlug: "accessoire-tireur",
    qty: 1,
    parcelCount: 1,
    vatPct: 20,
    netHt: 100,
    lineTtc: 120,
    requiresPaymentVirement: false,
    ...overrides,
  }
}

describe("quotedUnitPriceHt", () => {
  it("takes the discount off the public price, to the cent", () => {
    expect(quotedUnitPriceHt(1205, 10)).toBe(1084.5)
    expect(quotedUnitPriceHt(19.99, 15)).toBe(16.99)
    expect(quotedUnitPriceHt(100, 0)).toBe(100)
  })
})

describe("discountPctOf", () => {
  it("reads back the discount a typed price stands for", () => {
    expect(discountPctOf(1205, 1084.5)).toBe(10)
    expect(discountPctOf(100, 100)).toBe(0)
  })

  it("says nothing of a line whose public price is zero", () => {
    expect(discountPctOf(0, 10)).toBeNull()
  })
})

describe("spreadShippingTtc", () => {
  it("splits a typed delivery amount over the lines' VAT rates, pro rata, to the cent", () => {
    const portions = spreadShippingTtc(30, [
      shippable({ vatPct: 20, netHt: 200 }),
      shippable({ vatPct: 5.5, netHt: 100, requiresPaymentVirement: true }),
    ])

    expect(portions.map((portion) => portion.amountTtc)).toEqual([20, 10])
    expect(portions[1]).toMatchObject({ vatPct: 5.5, requiresPaymentVirement: true })
    expect(portions.reduce((sum, portion) => sum + Math.round(portion.amountTtc * 100), 0)).toBe(3000)
  })

  it("is empty for a free delivery", () => {
    expect(spreadShippingTtc(0, [shippable({})])).toEqual([])
  })
})

describe("quoteTotals", () => {
  it("adds the lines and the delivery by VAT rate, the way Henrri does", () => {
    const totals = quoteTotals(
      [
        { qty: 3, unitPriceHt: 1084.5, vatPct: 20 },
        { qty: 1, unitPriceHt: 10.01, vatPct: 20 },
      ],
      [{ priceHt: 20.83, vatPct: 20 }],
    )

    expect(totals.totalHt).toBe(3284.34)
    expect(totals.totalTtc).toBe(3941.21)
  })
})

describe("adminQuoteUpdateSchema", () => {
  const id = "00000000-0000-4000-8000-000000000001"

  it("takes a line either by its price or by its discount, never both", () => {
    expect(adminQuoteUpdateSchema.safeParse({ items: [{ id, unitPriceHt: 99.9 }] }).success).toBe(true)
    expect(adminQuoteUpdateSchema.safeParse({ items: [{ id, discountPct: 12.5 }] }).success).toBe(true)
    expect(adminQuoteUpdateSchema.safeParse({ items: [{ id, unitPriceHt: 1, discountPct: 1 }] }).success).toBe(false)
    expect(adminQuoteUpdateSchema.safeParse({ items: [{ id }] }).success).toBe(false)
  })

  it("refuses a negative price, a discount over 100 % and sub-cent amounts", () => {
    expect(adminQuoteUpdateSchema.safeParse({ items: [{ id, unitPriceHt: -1 }] }).success).toBe(false)
    expect(adminQuoteUpdateSchema.safeParse({ items: [{ id, discountPct: 101 }] }).success).toBe(false)
    expect(adminQuoteUpdateSchema.safeParse({ shippingTtc: 1.001 }).success).toBe(false)
  })

  it("takes a validity date as a calendar day, and needs at least one field", () => {
    expect(adminQuoteUpdateSchema.safeParse({ validUntil: "2026-11-30" }).success).toBe(true)
    expect(adminQuoteUpdateSchema.safeParse({ validUntil: "30/11/2026" }).success).toBe(false)
    expect(adminQuoteUpdateSchema.safeParse({ documentsSufficient: true }).success).toBe(true)
    expect(adminQuoteUpdateSchema.safeParse({}).success).toBe(false)
  })
})

describe("organisationBillingAddressSchema", () => {
  it("wants a street, a postcode and a city, in France by default", () => {
    const parsed = organisationBillingAddressSchema.parse({
      line1: " 12 rue de la Paix ",
      postal: "75002",
      city: "Paris",
    })
    expect(parsed).toEqual({ line1: "12 rue de la Paix", line2: null, postal: "75002", city: "Paris", country: "FR" })
    expect(organisationBillingAddressSchema.safeParse({ line1: "x", postal: "", city: "Paris" }).success).toBe(false)
  })
})
