import { describe, expect, it } from "vitest"
import { computeVatTotals } from "./pricing.js"

describe("computeVatTotals", () => {
  it("adds the HT of each rate before computing its VAT, as Henrri does", () => {
    // Line by line: 3 × 0.40 = 1.20. By rate: 0.99 × 20 % = 0.198 → 0.20, so 1.19.
    const totals = computeVatTotals([
      { priceHt: 0.33, vatPct: 20 },
      { priceHt: 0.33, vatPct: 20 },
      { priceHt: 0.33, vatPct: 20 },
    ])
    expect(totals).toEqual({
      totalHt: 0.99,
      vatAmount: 0.2,
      totalTtc: 1.19,
      byRate: [{ vatPct: 20, totalHt: 0.99, vatAmount: 0.2 }],
    })
  })

  it("keeps one entry per rate, in the order the rates first appear", () => {
    const totals = computeVatTotals([
      { priceHt: 7.99, vatPct: 5.5 },
      { priceHt: 100, vatPct: 20 },
      { priceHt: -15, vatPct: 20 },
    ])
    expect(totals.byRate).toEqual([
      { vatPct: 5.5, totalHt: 7.99, vatAmount: 0.44 },
      { vatPct: 20, totalHt: 85, vatAmount: 17 },
    ])
    expect(totals.totalTtc).toBe(110.43)
  })

  it.each([
    // Half a cent of VAT goes up, as Henrri rounds (sandbox, 2026-10-14).
    [3, 5.5, 3.17],
    [0.25, 10, 0.28],
    [1, 5.5, 1.06],
    // Binary floating point must not tip a non-midpoint the wrong way.
    [1113.33, 20, 1336],
    [20.83, 20, 25],
  ])("rounds the VAT of %s HT at %s %% to a TTC of %s", (priceHt, vatPct, totalTtc) => {
    expect(computeVatTotals([{ priceHt, vatPct }]).totalTtc).toBe(totalTtc)
  })

  it("returns zeros for nothing", () => {
    expect(computeVatTotals([])).toEqual({ totalHt: 0, vatAmount: 0, totalTtc: 0, byRate: [] })
  })
})
