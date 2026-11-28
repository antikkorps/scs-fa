import { describe, expect, it } from "vitest"
import { keptChoice, NO_SUPPLIER, supplierChoices, withSupplier } from "./supplier-filter"

const ROWS = [
  { id: "1", supplierName: "BGM Winfield" },
  { id: "2", supplierName: null },
  { id: "3", supplierName: "Cor Caroli" },
  { id: "4", supplierName: "BGM Winfield" },
]

// Story 12.16b: narrow the product list to one supplier, then archive it all.
describe("supplier filter", () => {
  it("offers each supplier once, sorted, then the products without one", () => {
    expect(supplierChoices(ROWS)).toEqual([
      { value: "BGM Winfield", label: "BGM Winfield (2)" },
      { value: "Cor Caroli", label: "Cor Caroli (1)" },
      { value: NO_SUPPLIER, label: "Sans fournisseur (1)" },
    ])
  })

  it("leaves out « Sans fournisseur » when every product has one", () => {
    expect(supplierChoices(ROWS.filter((row) => row.supplierName)).map((choice) => choice.value)).toEqual([
      "BGM Winfield",
      "Cor Caroli",
    ])
  })

  it("keeps the rows of the chosen supplier, of none, or all of them", () => {
    expect(withSupplier(ROWS, "BGM Winfield").map((row) => row.id)).toEqual(["1", "4"])
    expect(withSupplier(ROWS, NO_SUPPLIER).map((row) => row.id)).toEqual(["2"])
    expect(withSupplier(ROWS, "")).toHaveLength(4)
  })

  // Once a supplier's catalogue is archived, it leaves the choices: the filter
  // must not stay on it, showing an empty list under a blank select.
  it("falls back to every supplier when the chosen one is no longer offered", () => {
    const choices = supplierChoices(ROWS)
    expect(keptChoice("Cor Caroli", choices)).toBe("Cor Caroli")
    expect(keptChoice("Disparu", choices)).toBe("")
    expect(keptChoice("", choices)).toBe("")
  })
})
