import { describe, expect, it } from "vitest"
import {
  catalogueCanonical,
  categoryMetaDescription,
  categoryPath,
  inStock,
  isRegulated,
  legalCategoryLabel,
  stockLabel,
} from "./product.js"

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

describe("categoryPath", () => {
  it("gives a category its own page, and the whole catalogue for none", () => {
    expect(categoryPath("arme-poing")).toBe("/boutique/categorie/arme-poing")
    expect(categoryPath("")).toBe("/boutique")
  })
})

describe("catalogueCanonical", () => {
  const SITE = "https://www.scs-firearms.com"
  it("points the first page at the bare listing", () => {
    expect(catalogueCanonical(SITE, "/boutique", 1)).toBe(`${SITE}/boutique`)
  })
  it("keeps a later page of results as a page of its own", () => {
    expect(catalogueCanonical(SITE, "/boutique/categorie/munition", 3)).toBe(
      `${SITE}/boutique/categorie/munition?page=3`,
    )
  })
})

describe("categoryMetaDescription", () => {
  it("weaves the category's own description in, without a doubled full stop", () => {
    expect(categoryMetaDescription("Armes de poing", "Pistolets et revolvers.")).toBe(
      "Armes de poing : Pistolets et revolvers. Catégorie légale, prix TTC et stock en temps réel — boutique armurerie SCS Firearm.",
    )
  })
  it("stands on its own when the category has no description", () => {
    expect(categoryMetaDescription("Munitions", null)).toBe(
      "Munitions. Catégorie légale, prix TTC et stock en temps réel — boutique armurerie SCS Firearm.",
    )
  })
})
