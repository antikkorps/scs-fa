// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import type { CartSummary } from "~/types/cart"
import CartTotals from "./CartTotals.vue"

const NO_SHIPPING: CartSummary["shipping"] = {
  totalTtc: 0,
  totalHt: 0,
  vatAmount: 0,
  breakdown: [],
  smallParcelFree: false,
  smallParcelFreeRemainingTtc: null,
  portions: [],
}

const summary = (overrides: Partial<CartSummary> = {}): CartSummary => ({
  itemCount: 1,
  subtotalHt: 1000,
  vipDiscountAmount: 0,
  vatAmount: 204.17,
  totalTtc: 1225,
  shipping: {
    ...NO_SHIPPING,
    totalTtc: 25,
    totalHt: 20.83,
    vatAmount: 4.17,
    breakdown: [{ shippingClass: "firearm", units: 1, amountTtc: 25 }],
  },
  ...overrides,
})

const text = async (s: CartSummary) => (await mountSuspended(CartTotals, { props: { summary: s } })).text()

describe("CartTotals (story 12.3)", () => {
  it("shows the delivery before the total, HT in the column and TTC per class", async () => {
    const t = await text(summary())
    expect(t).toContain("Livraison HT")
    expect(t).toMatch(/20,83/)
    expect(t).toContain("1 colis assuré")
    expect(t).toMatch(/25,00\s*€ TTC/)
    expect(t.indexOf("Livraison HT")).toBeLessThan(t.indexOf("Total TTC"))
  })

  it("says when delivery is free rather than showing 0", async () => {
    const t = await text(
      summary({
        shipping: {
          ...NO_SHIPPING,
          smallParcelFree: true,
          breakdown: [{ shippingClass: "small", units: 1, amountTtc: 0 }],
        },
      }),
    )
    expect(t).toContain("Offerte")
    expect(t).toContain("offerte")
  })

  it("tells how far the free-delivery threshold is", async () => {
    const t = await text(
      summary({
        shipping: {
          ...NO_SHIPPING,
          totalTtc: 9,
          totalHt: 7.5,
          vatAmount: 1.5,
          breakdown: [{ shippingClass: "small", units: 1, amountTtc: 9 }],
          smallParcelFreeRemainingTtc: 30,
        },
      }),
    )
    expect(t).toMatch(/Plus que 30,00/)
  })

  it("hides the delivery row for an empty cart", async () => {
    const t = await text(summary({ itemCount: 0, subtotalHt: 0, vatAmount: 0, totalTtc: 0, shipping: NO_SHIPPING }))
    expect(t).not.toContain("Livraison")
  })
})
