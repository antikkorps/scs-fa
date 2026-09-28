// Spreadsheet reading for the imports (story 12.2): `.xlsx` or `.csv`, told
// apart by their bytes rather than by a file name the uploader controls.
//
// Exposed as the `@armurier/shared/spreadsheet` sub-path and deliberately NOT
// re-exported from the package index: it pulls in exceljs, which the web
// bundle must never carry.

import ExcelJS from "exceljs"
import { parseCsv } from "./csv.js"

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
    // A CSV saved by a French Excel is Windows-1252, not UTF-8.
    return new TextDecoder("windows-1252").decode(bytes)
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
