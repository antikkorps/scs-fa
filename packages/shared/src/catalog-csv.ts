// Story 12.16d — the catalogue export as CSV, for those who work in CSV rather
// than in the workbook. Same columns as the import, written for a French Excel.
import { CATALOG_IMPORT_COLUMNS } from "./catalog-import.js"
import { toCsv } from "./csv.js"
import type { CatalogSheetRow } from "./spreadsheet.js"

// Without it, Excel opens a UTF-8 file as Windows-1252 and mangles the accents.
const UTF8_BOM = "﻿"

/** A French Excel reads `1249.5` as text, or worse as a date: write `1249,5`. */
function csvValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  return typeof value === "number" ? String(value).replace(".", ",") : value
}

export function catalogSheetCsv(rows: readonly CatalogSheetRow[]): string {
  const header = CATALOG_IMPORT_COLUMNS.map((column) => column.header)
  const lines = rows.map((row) => CATALOG_IMPORT_COLUMNS.map((column) => csvValue(row[column.key])))
  return UTF8_BOM + toCsv([header, ...lines])
}
