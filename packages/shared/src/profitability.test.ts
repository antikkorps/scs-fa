import { describe, expect, it } from "vitest"
import { computePayoutHt, computeProfitability, refundFactorFor, resolveChargesHt } from "./profitability.js"

describe("resolveChargesHt", () => {
  it("prefers a flat amount over a percentage", () => {
    expect(resolveChargesHt(1000, { priceHt: 1000, chargesAmountHt: 42, chargesPct: 10 })).toBe(42)
  })

  it("falls back to the global default only when the article says nothing", () => {
    expect(resolveChargesHt(1000, { priceHt: 1000, defaultChargesPct: 8 })).toBe(80)
  })

  /** 0 is an answer, not an absence — a "no charges" article must stay at zero. */
  it("honours an explicit zero instead of falling back", () => {
    expect(resolveChargesHt(1000, { priceHt: 1000, chargesPct: 0, defaultChargesPct: 8 })).toBe(0)
    expect(resolveChargesHt(1000, { priceHt: 1000, chargesAmountHt: 0, defaultChargesPct: 8 })).toBe(0)
  })

  it("ignores a negative amount and caps a percentage at 100", () => {
    expect(resolveChargesHt(1000, { priceHt: 1000, chargesAmountHt: -50 })).toBe(0)
    expect(resolveChargesHt(1000, { priceHt: 1000, chargesPct: 250 })).toBe(1000)
  })
})

describe("computeProfitability", () => {
  it("subtracts cost, charges AND what is owed to a third party", () => {
    // 1000 − 600 achat − 50 charges (5%) − 100 reversement (10%) = 250
    const p = computeProfitability({
      priceHt: 1000,
      costPriceHt: 600,
      chargesPct: 5,
      beneficiarySharePct: 10,
    })
    expect(p).toMatchObject({ costPriceHt: 600, chargesHt: 50, payoutHt: 100, marginHt: 250, marginPct: 25 })
  })

  /**
   * The whole point of the story: a margin that ignored the reversement would
   * read as profit and would not be.
   */
  it("shows the reversement eating into the margin", () => {
    const without = computeProfitability({ priceHt: 1000, costPriceHt: 600 })
    const with20 = computeProfitability({ priceHt: 1000, costPriceHt: 600, beneficiarySharePct: 20 })
    expect(without.marginHt).toBe(400)
    expect(with20.marginHt).toBe(200)
  })

  it("reports a loss rather than clamping it to zero", () => {
    // 100 − 90 achat − 10 charges − 20 reversement = −20
    const p = computeProfitability({ priceHt: 100, costPriceHt: 90, chargesPct: 10, beneficiarySharePct: 20 })
    expect(p.marginHt).toBe(-20)
    expect(p.marginPct).toBe(-20)
  })

  /** An unknown purchase price makes the margin an upper bound, not a fact. */
  it("says out loud when the cost is unknown", () => {
    expect(computeProfitability({ priceHt: 1000 }).costUnknown).toBe(true)
    expect(computeProfitability({ priceHt: 1000, costPriceHt: 0 }).costUnknown).toBe(false)
  })

  it("does not divide by zero on a free article", () => {
    expect(computeProfitability({ priceHt: 0, costPriceHt: 10 })).toMatchObject({ marginHt: -10, marginPct: 0 })
  })

  it("rounds every figure to the cent", () => {
    const p = computeProfitability({ priceHt: 333.33, costPriceHt: 111.11, chargesPct: 3.33 })
    expect(p.chargesHt).toBe(11.1)
    expect(p.marginHt).toBe(211.12)
  })
})

describe("computePayoutHt", () => {
  it("computes the share on the HT line", () => {
    expect(computePayoutHt(800, 12.5)).toBe(100)
  })

  it("owes nothing on a fully refunded sale", () => {
    expect(computePayoutHt(800, 12.5, 0)).toBe(0)
  })

  it("reduces the share in proportion to a partial refund", () => {
    expect(computePayoutHt(800, 10, 0.5)).toBe(40)
  })

  it("treats a missing or absurd rate as zero, and clamps the factor", () => {
    expect(computePayoutHt(800, 0)).toBe(0)
    expect(computePayoutHt(800, 10, 5)).toBe(80)
    expect(computePayoutHt(-800, 10)).toBe(0)
  })
})

describe("refundFactorFor", () => {
  it("is 1 when nothing was refunded and 0 when all of it was", () => {
    expect(refundFactorFor(1200, 0)).toBe(1)
    expect(refundFactorFor(1200, 1200)).toBe(0)
  })

  it("is the surviving share on a partial refund", () => {
    expect(refundFactorFor(1200, 300)).toBe(0.75)
  })

  it("never goes negative, even if refunds somehow exceed the total", () => {
    expect(refundFactorFor(1200, 5000)).toBe(0)
    expect(refundFactorFor(0, 0)).toBe(0)
  })
})
