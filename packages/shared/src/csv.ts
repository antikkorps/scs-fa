// CSV reading shared by every import (bank statements, supplier catalogues).
//
// Written by hand rather than pulled from a dependency: the need is narrow and
// well defined — RFC 4180 quoting, the three delimiters French and English
// exports actually use, and no type coercion at all. A reference such as
// `00123` must reach the caller as the text it is, never as the number 123.

export type CsvDelimiter = ";" | "," | "\t"

const DELIMITERS: readonly CsvDelimiter[] = [";", ",", "\t"]

/**
 * Pick the delimiter from the first record, counting only characters that sit
 * OUTSIDE quotes — a quoted header such as `"Prix, HT"` must not vote for `,`.
 * Ties go to `;`, the default of a French Excel.
 */
function detectDelimiter(text: string): CsvDelimiter {
  const counts = new Map<CsvDelimiter, number>(DELIMITERS.map((d) => [d, 0]))
  let quoted = false
  for (const c of text) {
    if (c === '"') quoted = !quoted
    else if (!quoted && (c === "\n" || c === "\r")) break
    else if (!quoted && counts.has(c as CsvDelimiter)) {
      counts.set(c as CsvDelimiter, (counts.get(c as CsvDelimiter) ?? 0) + 1)
    }
  }
  let best: CsvDelimiter = ";"
  for (const d of DELIMITERS) if ((counts.get(d) ?? 0) > (counts.get(best) ?? 0)) best = d
  return best
}

/**
 * Parse CSV text into rows of trimmed string cells.
 *
 * - quoted fields may hold the delimiter, doubled quotes and **line breaks**
 *   (a product description routinely spans several lines);
 * - a UTF-8 BOM is dropped, CRLF / LF / CR are all accepted;
 * - blank lines are skipped, but empty cells are kept so columns stay aligned.
 */
export function parseCsv(input: string, options: { delimiter?: CsvDelimiter } = {}): string[][] {
  const text = input.startsWith("﻿") ? input.slice(1) : input
  const delimiter = options.delimiter ?? detectDelimiter(text)

  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false

  const endRow = () => {
    row.push(field)
    field = ""
    const cells = row.map((f) => f.trim())
    if (cells.some((c) => c.length > 0)) rows.push(cells)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') field += c
      else if (text[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
    } else if (c === '"') quoted = true
    else if (c === delimiter) {
      row.push(field)
      field = ""
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++
      endRow()
    } else field += c
  }
  if (field.length > 0 || row.length > 0) endRow()
  return rows
}

/**
 * Canonical form of a column header, so `Prix d'achat HT (€)`, `prix achat ht`
 * and `PRIX_ACHAT_HT` all designate the same column.
 */
export function normaliseHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}

// Windows-1252 glyphs for bytes 0x80–0x9F (U+FFFD where 1252 has none). Spelled
// out: Node's TextDecoder treats "windows-1252" as Latin-1 for this range.
const CP1252_C1 =
  "\u20ac\ufffd\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\ufffd\u017d\ufffd\ufffd\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\ufffd\u017e\u0178"

/**
 * Repair text whose curly quotes were stored as C1 control characters
 * (U+0080–U+009F) — Windows-1252 bytes pasted into a UTF-8 page. U+0092 is
 * the ’ of « d’autonomie ».
 */
export function fixC1(text: string): string {
  return text.replace(/[\u0080-\u009f]/g, (c) => CP1252_C1[c.charCodeAt(0) - 0x80] ?? c)
}
