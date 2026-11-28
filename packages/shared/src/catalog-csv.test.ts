import { describe, expect, it } from "vitest"
import { catalogSheetCsv } from "./catalog-csv.js"
import { CATALOG_IMPORT_COLUMNS, parseCatalogImportTable } from "./catalog-import.js"
import { readSpreadsheet } from "./spreadsheet.js"

const ROW = {
  import: "oui",
  supplier: "BGM Winfield",
  supplierSku: "00123",
  name: "Carabine « 308 »; modèle 2026",
  category: "Armes longues",
  subcategory: "Carabines",
  legalCategory: "C",
  priceHt: 1249.5,
  vatPct: 20,
  tags: "chasse, calibre-308-win",
  description: null,
}

// Story 12.16d: Fred and Stéphane work in CSV; the export offers it alongside
// the workbook, in the very columns the import reads back.
describe("catalogSheetCsv", () => {
  it("writes a French Excel CSV: BOM, semicolons, the import's headers first", () => {
    const csv = catalogSheetCsv([ROW])
    expect(csv.startsWith("﻿")).toBe(true)
    const [header] = csv.slice(1).split("\r\n")
    expect(header?.split(";")).toEqual(CATALOG_IMPORT_COLUMNS.map((column) => column.header))
  })

  it("writes numbers with a decimal comma, as a French Excel reads them", () => {
    expect(catalogSheetCsv([ROW])).toContain(";1249,5;")
  })

  it("reads back through the import as the same product", async () => {
    const bytes = new TextEncoder().encode(catalogSheetCsv([ROW]))
    const { rows, missingColumns } = parseCatalogImportTable(await readSpreadsheet(bytes))
    expect(missingColumns).toEqual([])
    expect(rows[0]?.errors).toEqual([])
    expect(rows[0]?.data).toMatchObject({
      supplierSku: "00123",
      name: "Carabine « 308 »; modèle 2026",
      subcategory: "Carabines",
      priceHt: 1249.5,
      tags: ["chasse", "calibre-308-win"],
    })
  })
})
