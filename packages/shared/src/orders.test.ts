import { describe, expect, it } from "vitest"
import { calculateOrderPaymentSplit, PAYMENT_SPLIT, requiresVirement } from "./orders.js"

describe("requiresVirement", () => {
  it("requires a bank transfer for regulated categories A/B/C", () => {
    expect(requiresVirement("A")).toBe(true)
    expect(requiresVirement("B")).toBe(true)
    expect(requiresVirement("C")).toBe(true)
  })

  it("allows card payment for D, unregulated and missing categories", () => {
    expect(requiresVirement("D")).toBe(false)
    expect(requiresVirement("none")).toBe(false)
    expect(requiresVirement(null)).toBe(false)
    expect(requiresVirement(undefined)).toBe(false)
  })
})

describe("calculateOrderPaymentSplit", () => {
  it("classifies an order with only regulated firearms as virement_only", () => {
    const split = calculateOrderPaymentSplit([{ priceHt: 1000, vatPct: 20, requiresPaymentVirement: true }])
    expect(split.splitType).toBe(PAYMENT_SPLIT.VIREMENT_ONLY)
    expect(split.virement.amountTtc).toBe(1200)
    expect(split.carte.amountTtc).toBe(0)
  })

  it("classifies an accessory-only order as carte_only", () => {
    const split = calculateOrderPaymentSplit([{ priceHt: 50, vatPct: 20, requiresPaymentVirement: false }])
    expect(split.splitType).toBe(PAYMENT_SPLIT.CARTE_ONLY)
    expect(split.carte.amountTtc).toBe(60)
    expect(split.virement.amountTtc).toBe(0)
  })

  it("splits a mixed order into both buckets", () => {
    const split = calculateOrderPaymentSplit([
      { priceHt: 1000, vatPct: 20, requiresPaymentVirement: true },
      { priceHt: 50, vatPct: 20, requiresPaymentVirement: false },
      { priceHt: 100, vatPct: 20, requiresPaymentVirement: false },
    ])
    expect(split.splitType).toBe(PAYMENT_SPLIT.MIXED)
    expect(split.virement.amountTtc).toBe(1200)
    expect(split.carte.amountTtc).toBe(180)
  })
})
