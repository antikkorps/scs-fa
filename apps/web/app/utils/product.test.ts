import { describe, expect, it } from "vitest"
import {
  catalogueCanonical,
  catalogueCanonicalPath,
  categoryMetaDescription,
  categoryPath,
  inStock,
  isRegulated,
  legalCategoryLabel,
  stockLabel,
  tagMetaDescription,
  tagPath,
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
      "Armes de poing : Pistolets et revolvers. Catégorie légale, prix TTC et stock en temps réel — boutique armurerie SCS Firearms.",
    )
  })
  it("stands on its own when the category has no description", () => {
    expect(categoryMetaDescription("Munitions", null)).toBe(
      "Munitions. Catégorie légale, prix TTC et stock en temps réel — boutique armurerie SCS Firearms.",
    )
  })
})

describe("tag pages", () => {
  it("gives a tag its own page in the armurerie", () => {
    expect(tagPath("occasion")).toBe("/boutique/tag/occasion")
    expect(tagPath("état neuf")).toBe("/boutique/tag/%C3%A9tat%20neuf")
  })

  it("describes a tag page in its own words, or plainly", () => {
    expect(tagMetaDescription("Occasion", "Armes révisées par notre atelier.")).toBe(
      "Occasion : Armes révisées par notre atelier. Catégorie légale, prix TTC et stock en temps réel — boutique armurerie SCS Firearms.",
    )
    expect(tagMetaDescription("Occasion", null)).toBe(
      "Occasion. Catégorie légale, prix TTC et stock en temps réel — boutique armurerie SCS Firearms.",
    )
  })
})

describe("catalogueCanonicalPath", () => {
  it("sends the whole catalogue filtered on a single tag to that tag's page", () => {
    expect(catalogueCanonicalPath("/boutique", ["occasion"], false)).toBe("/boutique/tag/occasion")
  })

  it("keeps the page it filters otherwise", () => {
    expect(catalogueCanonicalPath("/boutique", [], false)).toBe("/boutique")
    expect(catalogueCanonicalPath("/boutique", ["occasion", "xixe"], false)).toBe("/boutique")
    expect(catalogueCanonicalPath("/boutique", ["occasion"], true)).toBe("/boutique")
    expect(catalogueCanonicalPath("/boutique/categorie/fusils", ["occasion"], false)).toBe("/boutique/categorie/fusils")
    expect(catalogueCanonicalPath("/boutique/tag/occasion", ["xixe"], false)).toBe("/boutique/tag/occasion")
  })
})
