import { describe, expect, it } from "vitest"
import { findPossibleDuplicates } from "./export.js"

const p = (id: string, supplier: string, name: string, over: { ean?: string; brand?: string } = {}) => ({
  id,
  supplier,
  supplierSku: `REF-${id}`,
  ean: over.ean ?? null,
  name,
  brand: over.brand ?? null,
  sku: `SKU-${id}`,
  published: id === "a",
})

describe("findPossibleDuplicates", () => {
  it("pairs the same EAN, or the same words in brand + name, across suppliers only", () => {
    const labels = findPossibleDuplicates([
      p("a", "BGM", "Liberty II 1x24", { brand: "Swampfox" }),
      p("b", "Cor Caroli", "Swampfox liberty ii 1X24"),
      p("c", "BGM", "Liberty II 1x24", { brand: "Swampfox" }),
      p("d", "Toro", "Lunette quelconque", { ean: "4006381333931" }),
      p("e", "Humbert", "Autre nom", { ean: "4006381333931" }),
      p("f", "Toro", "Sans jumeau"),
    ])
    // Same words, other supplier: flagged. Same supplier (a / c): not a cross-supplier duplicate.
    expect(labels.get("a")).toBe("Cor Caroli REF-b (inactif)")
    expect(labels.get("b")).toBe("BGM REF-a (actif) ; BGM REF-c (inactif)")
    expect(labels.get("d")).toBe("Humbert REF-e (inactif)")
    expect(labels.has("f")).toBe(false)
  })
})
