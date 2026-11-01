// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import type { CartProductLine, CartSummary, CartView } from "~/types/cart"
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

// One rifle at 1,000 € HT, 20 % VAT — the lines only feed the VIP discount, VAT included.
const rifle = (discountAmount = 0) => ({ vatPct: 20, discountAmount }) as CartProductLine

const cartOf = (s: CartSummary, items: CartProductLine[] = [rifle()]): CartView => ({
  isVip: false,
  items,
  artworkItems: [],
  summary: s,
})

const text = async (s: CartSummary, items?: CartProductLine[]) =>
  (await mountSuspended(CartTotals, { props: { cart: cartOf(s, items) } })).text()

describe("CartTotals (story 12.3)", () => {
  it("shows an individual every row VAT included, the VAT as part of the total (audit 2026-11-01, I4)", async () => {
    const t = await text(summary())
    expect(t).not.toMatch(/\bHT\b/)
    expect(t).toMatch(/Articles\s*1\s200,00/)
    expect(t).toMatch(/Livraison\s*25,00/)
    expect(t).toMatch(/Total TTC\s*1\s225,00/)
    expect(t).toMatch(/dont TVA\s*204,17/)
    expect(t).toContain("1 colis assuré")
    expect(t.indexOf("Livraison")).toBeLessThan(t.indexOf("Total TTC"))
  })

  it("shows the VIP discount VAT included", async () => {
    const t = await text(summary({ vipDiscountAmount: 100, vatAmount: 184.17, totalTtc: 1105 }), [rifle(100)])
    expect(t).toMatch(/Articles\s*1\s200,00/)
    expect(t).toMatch(/Remise VIP\s*−\s*120,00/)
    expect(t).toMatch(/Total TTC\s*1\s105,00/)
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
