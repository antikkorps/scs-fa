import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { CATALOG_IMPORT_COLUMNS } from "./catalog-import.js"
import { addCatalogSheet, readSpreadsheet, SpreadsheetError } from "./spreadsheet.js"

async function xlsx(build: (ws: ExcelJS.Worksheet, wb: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  build(wb.addWorksheet("À trier"), wb)
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

describe("readSpreadsheet — xlsx", () => {
  it("reads every cell as text, keeping references and EANs intact", async () => {
    const file = await xlsx((ws) => {
      ws.addRow(["Réf.", "Prix", "EAN"])
      ws.addRow(["00123", 12.5, 4006381333931])
    })
    expect(await readSpreadsheet(file)).toEqual([
      ["Réf.", "Prix", "EAN"],
      ["00123", "12.5", "4006381333931"],
    ])
  })

  it("keeps blank rows so line numbers match what Excel shows", async () => {
    const file = await xlsx((ws) => {
      ws.getCell("A1").value = "h"
      ws.getCell("A3").value = "x"
    })
    expect(await readSpreadsheet(file)).toEqual([["h"], [], ["x"]])
  })

  it("takes the cached result of a formula, never its source", async () => {
    const file = await xlsx((ws) => {
      ws.getCell("A1").value = { formula: "1+1", result: 2 }
      ws.getCell("B1").value = { formula: "NOW()" }
    })
    expect(await readSpreadsheet(file)).toEqual([["2", ""]])
  })

  it("flattens rich text, hyperlinks and dates", async () => {
    const file = await xlsx((ws) => {
      ws.getCell("A1").value = { richText: [{ text: "Lunette " }, { text: "3-9x40", font: { bold: true } }] }
      ws.getCell("B1").value = { text: "fiche", hyperlink: "https://a.fr/p" }
      ws.getCell("C1").value = new Date(Date.UTC(2026, 8, 28))
      ws.getCell("D1").value = true
    })
    expect(await readSpreadsheet(file)).toEqual([["Lunette 3-9x40", "https://a.fr/p", "2026-09-28", "oui"]])
  })

  it("reads the first sheet unless one is named", async () => {
    const file = await xlsx((ws, wb) => {
      ws.addRow(["first"])
      wb.addWorksheet("Autre").addRow(["second"])
    })
    expect(await readSpreadsheet(file)).toEqual([["first"]])
    expect(await readSpreadsheet(file, { sheet: "Autre" })).toEqual([["second"]])
    await expect(readSpreadsheet(file, { sheet: "Absente" })).rejects.toBeInstanceOf(SpreadsheetError)
  })

  it("refuses a sheet longer than the row cap", async () => {
    const file = await xlsx((ws) => {
      for (let i = 0; i < 11; i++) ws.addRow([i])
    })
    await expect(readSpreadsheet(file, { maxRows: 10 })).rejects.toThrow(/10/)
  })

  it("refuses a zip that is not a workbook", async () => {
    const notXlsx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6])
    await expect(readSpreadsheet(notXlsx)).rejects.toBeInstanceOf(SpreadsheetError)
  })
})

describe("readSpreadsheet — csv", () => {
  it("reads UTF-8 CSV", async () => {
    const file = new TextEncoder().encode("réf;prix\nA;1")
    expect(await readSpreadsheet(file)).toEqual([
      ["réf", "prix"],
      ["A", "1"],
    ])
  })

  it("falls back to Windows-1252, the encoding of a CSV saved by a French Excel", async () => {
    // "réf;prix" in Windows-1252: é = 0xE9, invalid on its own in UTF-8.
    const file = new Uint8Array([0x72, 0xe9, 0x66, 0x3b, 0x70, 0x72, 0x69, 0x78])
    expect(await readSpreadsheet(file)).toEqual([["réf", "prix"]])
  })

  it("decodes the Windows-1252 punctuation too — the apostrophe of « d’origine », the euro sign", async () => {
    // "d’o;5€" in Windows-1252: ’ = 0x92, € = 0x80.
    const file = new Uint8Array([0x64, 0x92, 0x6f, 0x3b, 0x35, 0x80])
    expect(await readSpreadsheet(file)).toEqual([["d’o", "5€"]])
  })

  it("refuses a binary file that is neither", async () => {
    await expect(readSpreadsheet(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]))).rejects.toBeInstanceOf(
      SpreadsheetError,
    )
  })
})

describe("addCatalogSheet — drop-downs", () => {
  type ListValidation = { type: string; formulae: string[] }
  const columnLetter = (key: string) =>
    String.fromCharCode(65 + CATALOG_IMPORT_COLUMNS.findIndex((column) => column.key === key))

  /** The validations of the sheet, by range ("C2:C501" → its list). */
  function validations(ws: ExcelJS.Worksheet): Record<string, ListValidation> {
    return (ws as unknown as { dataValidations: { model: Record<string, ListValidation> } }).dataValidations.model
  }
  const validationOf = (ws: ExcelJS.Worksheet, key: string) =>
    Object.entries(validations(ws)).find(([range]) => range.startsWith(`${columnLetter(key)}2:`))

  it("offers the declared suppliers in the Fournisseur column, from the hidden list sheet", () => {
    const wb = new ExcelJS.Workbook()
    const ws = addCatalogSheet(wb, "Catalogue", [], { categoryNames: ["Optiques"], supplierNames: ["BGM", "Humbert"] })
    const [, supplier] = validationOf(ws, "supplier") ?? []
    expect(supplier?.type).toBe("list")
    expect(supplier?.formulae).toEqual(["Listes!$B$1:$B$2"])
    const lists = wb.getWorksheet("Listes")
    expect([lists?.getCell("B1").value, lists?.getCell("B2").value]).toEqual(["BGM", "Humbert"])
  })

  it("leaves the Fournisseur column free when no supplier list is given", () => {
    const ws = addCatalogSheet(new ExcelJS.Workbook(), "À trier", [], { categoryNames: ["Optiques"] })
    expect(validationOf(ws, "supplier")).toBeUndefined()
  })

  it("keeps the drop-downs on the blank lines below the data, where new products are typed", () => {
    const ws = addCatalogSheet(new ExcelJS.Workbook(), "Catalogue", [{ name: "Lunette" }], {
      categoryNames: ["Optiques"],
      supplierNames: ["BGM"],
    })
    const [range] = validationOf(ws, "supplier") ?? []
    const lastRow = Number(range?.split(":")[1]?.replace(/^[A-Z]+/, ""))
    expect(lastRow).toBeGreaterThanOrEqual(500)
  })
})
