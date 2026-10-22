import { describe, expect, it } from "vitest"
import { cartChangeLabel, earliestHold } from "./cart.js"
import { formatEuros } from "./format.js"

describe("earliestHold (story 12.9a)", () => {
  it("is the first moment a held item goes back on sale", () => {
    expect(
      earliestHold({
        items: [{ heldUntil: null }, { heldUntil: "2026-10-22T10:20:00.000Z" }],
        artworkItems: [{ heldUntil: "2026-10-22T10:15:00.000Z" }],
      }),
    ).toBe("2026-10-22T10:15:00.000Z")
  })

  it("is null when nothing in the cart is held", () => {
    expect(earliestHold({ items: [{ heldUntil: null }], artworkItems: [] })).toBeNull()
  })
})

describe("cartChangeLabel (story 12.9d)", () => {
  const cart = {
    items: [{ id: "l-1", vatPct: 20 }],
    artworkItems: [{ id: "a-1", vatPct: 5.5 }],
  }

  it("states the old and new price, tax included", () => {
    expect(
      cartChangeLabel(
        { kind: "price_changed", lineId: "l-1", name: "Tapis de tir", previousPriceHt: 50, priceHt: 55 },
        cart,
      ),
    ).toBe(`Tapis de tir : le prix est passé de ${formatEuros(60)} à ${formatEuros(66)} TTC.`)
  })

  it("uses the print's own VAT rate", () => {
    expect(
      cartChangeLabel(
        { kind: "price_changed", lineId: "a-1", name: "Éclat", previousPriceHt: 100, priceHt: 200 },
        cart,
      ),
    ).toBe(`Éclat : le prix est passé de ${formatEuros(105.5)} à ${formatEuros(211)} TTC.`)
  })

  it("says why an article left the cart", () => {
    expect(cartChangeLabel({ kind: "unavailable", lineId: "l-9", name: "Carabine" }, cart)).toBe(
      "Carabine n'est plus disponible : il a été retiré de votre panier.",
    )
    expect(cartChangeLabel({ kind: "category_a", lineId: "l-9", name: "Fusil" }, cart)).toBe(
      "Fusil relève de la catégorie A, vendue aux seuls professionnels sur devis : il a été retiré de votre panier.",
    )
  })
})
