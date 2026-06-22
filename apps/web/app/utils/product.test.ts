import { describe, expect, it } from "vitest"
import { inStock, isRegulated, legalCategoryLabel, stockLabel } from "./product.js"

describe("legalCategoryLabel", () => {
  it("labels each prefectural category", () => {
    expect(legalCategoryLabel("B")).toBe("Catégorie B")
    expect(legalCategoryLabel("C")).toBe("Catégorie C")
  })
  it("treats none / null as free sale", () => {
    expect(legalCategoryLabel("none")).toBe("Vente libre")
    expect(legalCategoryLabel(null)).toBe("Vente libre")
    expect(legalCategoryLabel(undefined)).toBe("Vente libre")
  })
})

describe("isRegulated", () => {
  it("is true for A/B/C/D and false for none/null", () => {
    expect(isRegulated("B")).toBe(true)
    expect(isRegulated("D")).toBe(true)
    expect(isRegulated("none")).toBe(false)
    expect(isRegulated(null)).toBe(false)
  })
})

describe("stock helpers", () => {
  it("inStock reflects positive quantity", () => {
    expect(inStock(3)).toBe(true)
    expect(inStock(0)).toBe(false)
    expect(inStock(null)).toBe(false)
  })
  it("stockLabel describes the state", () => {
    expect(stockLabel(0)).toBe("Rupture de stock")
    expect(stockLabel(2)).toBe("Plus que 2 en stock")
    expect(stockLabel(20)).toBe("En stock")
  })
})
