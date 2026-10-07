// Spreadsheet reading for the imports (story 12.2): `.xlsx` or `.csv`, told
// apart by their bytes rather than by a file name the uploader controls. And
// the one catalogue sheet both the triage workbook (collection tool) and the
// catalogue export (story 12.4) write, so the two cannot drift.
//
// Exposed as the `@armurier/shared/spreadsheet` sub-path and deliberately NOT
// re-exported from the package index: it pulls in exceljs, which the web
// bundle must never carry.

import ExcelJS from "exceljs"
import {
  CATALOG_IMPORT_COLUMNS,
  type CatalogImportColumnKey,
  IMPORT_CHOICES,
  LEGAL_CATEGORY_CHOICES,
} from "./catalog-import.js"
import { fixC1, parseCsv } from "./csv.js"

export class SpreadsheetError extends Error {}

export interface ReadSpreadsheetOptions {
  /** Worksheet to read in a workbook; the first one by default. */
  sheet?: string
  /** Refuse anything longer — an import is a bounded, reviewed batch. */
  maxRows?: number
}

const DEFAULT_MAX_ROWS = 20_000
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

const isZip = (bytes: Uint8Array) => ZIP_MAGIC.every((b, i) => bytes[i] === b)

/** One cell as the text a human reads in it. Formulas are never evaluated. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  if (typeof value === "boolean") return value ? "oui" : "non"
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if ("richText" in value) return value.richText.map((r) => r.text).join("")
  if ("hyperlink" in value) return value.hyperlink
  // A formula: only the result Excel cached when it saved the file counts.
  if ("formula" in value || "sharedFormula" in value) {
    const result = (value as ExcelJS.CellFormulaValue).result
    return result === undefined || result === null || typeof result === "object"
      ? cellText(result as never)
      : String(result)
  }
  return ""
}

async function readXlsx(bytes: Uint8Array, options: ReadSpreadsheetOptions): Promise<string[][]> {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(bytes as unknown as ArrayBuffer)
  } catch {
    throw new SpreadsheetError("Unreadable workbook")
  }
  const ws = options.sheet ? wb.getWorksheet(options.sheet) : wb.worksheets[0]
  if (!ws) throw new SpreadsheetError(options.sheet ? `No sheet named "${options.sheet}"` : "Empty workbook")
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS
  if (ws.rowCount > maxRows) throw new SpreadsheetError(`Too many rows: ${maxRows} at most`)

  const table: string[][] = []
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const cells: string[] = []
    for (let c = 1; c <= row.cellCount; c++) cells.push(cellText(row.getCell(c).value).trim())
    // Blank rows stay (as []) so a row's index is the number Excel shows.
    table.push(cells.some((c) => c !== "") ? cells : [])
  }
  while (table.length > 0 && table.at(-1)?.length === 0) table.pop()
  return table
}

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    // A CSV saved by a French Excel is Windows-1252, not UTF-8 — and Node
    // decodes its 0x80–0x9F range (’, €, œ…) as control characters.
    return fixC1(new TextDecoder("windows-1252").decode(bytes))
  }
}

/**
 * Read a spreadsheet upload into rows of text cells. A zip is read as a
 * workbook; anything else must be text and is read as CSV.
 */
export async function readSpreadsheet(bytes: Uint8Array, options: ReadSpreadsheetOptions = {}): Promise<string[][]> {
  if (isZip(bytes)) return readXlsx(bytes, options)
  // NUL bytes do not occur in a CSV: this is some other binary format.
  if (bytes.includes(0)) throw new SpreadsheetError("Not a spreadsheet: expected .xlsx or .csv")
  const table = parseCsv(decodeText(bytes))
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS
  if (table.length > maxRows) throw new SpreadsheetError(`Too many rows: ${maxRows} at most`)
  return table
}

// --- Writing the catalogue sheet ----------------------------------------------

/** One row of the catalogue sheet, by column key; missing keys are blank. */
export type CatalogSheetRow = Partial<Record<CatalogImportColumnKey, string | number | null>>

const COLUMN_WIDTHS: Partial<Record<CatalogImportColumnKey, number>> = {
  import: 10,
  active: 8,
  supplier: 18,
  supplierSku: 16,
  ean: 15,
  name: 42,
  brand: 16,
  category: 24,
  legalCategory: 14,
  supplierLegalClass: 14,
  costPriceHt: 12,
  priceHt: 13,
  vatPct: 7,
  stockQty: 8,
  description: 40,
  longDescription: 30,
  imageUrls: 30,
  sourceCategory: 26,
  sourceUrl: 30,
  matchStatus: 16,
  sku: 14,
  duplicates: 30,
  version: 22,
}

/**
 * Add the catalogue sheet to a workbook: every `CATALOG_IMPORT_COLUMNS` column,
 * frozen header, filters, money formats and the drop-downs (Importer, Actif,
 * Catégorie légale, Catégorie). The category list lives on a hidden sheet: it
 * may exceed the 255 characters an inline list allows.
 */
export function addCatalogSheet(
  wb: ExcelJS.Workbook,
  name: string,
  rows: CatalogSheetRow[],
  categoryNames: string[],
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1, xSplit: 6 }] })
  ws.columns = CATALOG_IMPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: COLUMN_WIDTHS[c.key] ?? 14 }))
  ws.getRow(1).font = { bold: true }
  for (const row of rows) ws.addRow(row)
  const last = Math.max(rows.length + 1, 2)
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: CATALOG_IMPORT_COLUMNS.length } }

  const lists = wb.addWorksheet("Listes", { state: "veryHidden" })
  categoryNames.forEach((n, i) => {
    lists.getCell(i + 1, 1).value = n
  })
  const col = (key: CatalogImportColumnKey) => ws.getColumn(key).letter
  // exceljs supports range validations but its typings omit them.
  const validations = (ws as unknown as { dataValidations: { add(range: string, v: ExcelJS.DataValidation): void } })
    .dataValidations
  const list = (key: CatalogImportColumnKey, formula: string, prompt: string) => {
    validations.add(`${col(key)}2:${col(key)}${last}`, {
      type: "list",
      allowBlank: true,
      formulae: [formula],
      showErrorMessage: true,
      errorTitle: "Valeur non prévue",
      error: prompt,
    })
  }
  list("import", `"${IMPORT_CHOICES.join(",")}"`, "Répondez oui ou non.")
  list("active", `"${IMPORT_CHOICES.join(",")}"`, "Répondez oui, non, ou laissez vide.")
  list("legalCategory", `"${LEGAL_CATEGORY_CHOICES.join(",")}"`, "Choisissez A, B, C, D ou Aucune.")
  if (categoryNames.length > 0)
    list("category", `Listes!$A$1:$A$${categoryNames.length}`, "Choisissez une catégorie de la liste.")
  for (const key of ["costPriceHt", "priceHt"] as const) ws.getColumn(key).numFmt = "#,##0.00 €"
  return ws
}

/**
 * A complete catalogue workbook — the catalogue sheet plus a "Lisez-moi"
 * sheet — as `.xlsx` bytes, for callers that do not hold exceljs themselves.
 */
export async function writeCatalogWorkbook(options: {
  creator: string
  sheetName: string
  rows: CatalogSheetRow[]
  categoryNames: string[]
  /** Lines of the read-me sheet; the first is its title. */
  readme: string[]
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = options.creator
  wb.created = new Date()
  addCatalogSheet(wb, options.sheetName, options.rows, options.categoryNames)
  const readme = wb.addWorksheet("Lisez-moi")
  readme.getColumn(1).width = 130
  options.readme.forEach((line, i) => {
    readme.getCell(i + 1, 1).value = line
  })
  readme.getCell(1, 1).font = { bold: true, size: 14 }
  return Buffer.from(await wb.xlsx.writeBuffer())
}
