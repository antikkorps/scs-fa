import { describe, expect, it } from "vitest"
import type { CatalogImportPreviewRow } from "~/types/admin"
import { exportSupplierLabel, filterPreviewRows, plural, previewFilterCounts } from "./catalogImport"

const row = (over: Partial<CatalogImportPreviewRow>): CatalogImportPreviewRow => ({
  line: 2,
  action: "create",
  errors: [],
  warnings: [],
  supplier: "BGM",
  supplierSku: "A",
  name: "x",
  sku: "BGM-A",
  images: 0,
  ...over,
})

const rows = [
  row({ line: 2 }),
  row({ line: 3, action: "invalid", errors: ["Nom manquant"] }),
  row({ line: 4, action: "update", warnings: ["Catégorie légale en base (none)…"] }),
  row({ line: 5, action: "update" }),
]

describe("filterPreviewRows", () => {
  it("filters on the action, and on the presence of warnings", () => {
    expect(filterPreviewRows(rows, "all")).toHaveLength(4)
    expect(filterPreviewRows(rows, "invalid").map((r) => r.line)).toEqual([3])
    expect(filterPreviewRows(rows, "update").map((r) => r.line)).toEqual([4, 5])
    expect(filterPreviewRows(rows, "warnings").map((r) => r.line)).toEqual([4])
  })

  it("counts every filter at once", () => {
    expect(previewFilterCounts(rows)).toEqual({ all: 4, invalid: 1, warnings: 1, create: 1, update: 2 })
  })
})

describe("plural", () => {
  it("agrees with the number, French style", () => {
    expect(plural(1, "produit")).toBe("1 produit")
    expect(plural(0, "produit")).toBe("0 produit")
    expect(plural(1200, "produit")).toMatch(/^1\s200 produits$/)
    expect(plural(2, "nouveau fournisseur", "nouveaux fournisseurs")).toBe("2 nouveaux fournisseurs")
  })
})

describe("exportSupplierLabel (story 12.5)", () => {
  it("counts a supplier's products, and calls an empty one's file what it is: blank", () => {
    expect(exportSupplierLabel({ id: "s1", name: "BGM", products: 1200 })).toBe("BGM (1\u202f200 produits)")
    expect(exportSupplierLabel({ id: "s2", name: "Toro", products: 0 })).toBe("Toro (fichier vierge)")
  })
})
