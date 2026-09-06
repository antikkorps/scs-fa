import { describe, expect, it } from "vitest"
import {
  availabilityBadgeLabel,
  availabilityLongLabel,
  availabilitySchemaUrl,
  availabilityState,
  isPurchasable,
} from "./availability"

describe("availabilityState", () => {
  it("is available whenever there is stock", () => {
    expect(availabilityState({ stockQty: 5 })).toBe("available")
    expect(availabilityState({ stockQty: 1, isUnique: true })).toBe("available")
  })

  it("separates a sold one-off from an ordinary out-of-stock product", () => {
    // The whole point of the story: one is gone for good, the other restocks.
    expect(availabilityState({ stockQty: 0, isUnique: true })).toBe("sold")
    expect(availabilityState({ stockQty: 0, isUnique: false })).toBe("out_of_stock")
  })

  it("treats a missing or null stock as unavailable", () => {
    expect(availabilityState({ stockQty: null })).toBe("out_of_stock")
    expect(availabilityState({})).toBe("out_of_stock")
  })
})

describe("labels", () => {
  it("never promises a restock on a sold piece", () => {
    expect(availabilityBadgeLabel("sold")).toBe("Vendu")
    expect(availabilityLongLabel("sold")).toBe("Vendu — indisponible")
    expect(availabilityBadgeLabel("out_of_stock")).toBe("Rupture")
    expect(availabilityLongLabel("out_of_stock")).toBe("Rupture de stock")
  })
})

describe("structured data", () => {
  it("maps each state to the right schema.org value", () => {
    expect(availabilitySchemaUrl("available")).toBe("https://schema.org/InStock")
    // SoldOut, not OutOfStock: the difference is what tells a search engine the
    // item will never come back.
    expect(availabilitySchemaUrl("sold")).toBe("https://schema.org/SoldOut")
    expect(availabilitySchemaUrl("out_of_stock")).toBe("https://schema.org/OutOfStock")
  })
})

describe("isPurchasable", () => {
  it("allows only the available state", () => {
    expect(isPurchasable("available")).toBe(true)
    expect(isPurchasable("sold")).toBe(false)
    expect(isPurchasable("out_of_stock")).toBe(false)
  })
})
