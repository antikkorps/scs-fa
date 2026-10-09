// Supplier catalogue import (story 12.2) — the pure half of the engine.
//
// Three stages share these types and rules, so they live here once:
//   1. collectors (tools/catalog-collect) emit `CollectedProduct` lines;
//   2. the triage builder reconciles them with each supplier's price list and
//      writes the triage workbook whose columns are `CATALOG_IMPORT_COLUMNS`;
//   3. the admin import reads that workbook back with `parseCatalogImportTable`.
//
// Nothing here touches the database: whether a category exists or a reference
// is already in the catalogue is the API's call.

import { z } from "zod"
import { LEGAL_CATEGORIES, type LegalCategory } from "./constants.js"
import { normaliseHeader } from "./csv.js"
import { parseBankAmount } from "./orders.js"
import { round2 } from "./pricing.js"
import { RESERVED_PRODUCT_SLUGS } from "./validation.js"

// --- Collector output ------------------------------------------------------

const httpUrl = z
  .string()
  .trim()
  .max(1024)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), { message: "Only http(s) URLs are accepted" })

/** One product as a collector saw it on a supplier's site — the pivot format. */
export const collectedProductSchema = z.object({
  supplier: z.string().trim().min(1).max(255),
  supplierSku: z.string().trim().min(1).max(100),
  ean: z.string().trim().max(32).optional(),
  name: z.string().trim().min(1).max(255),
  brand: z.string().trim().max(100).optional(),
  description: z.string().trim().max(5000).optional(),
  /** HTML as published by the supplier; sanitised by the API at import. */
  longDescription: z.string().max(100_000).optional(),
  specs: z.record(z.string(), z.string()).default({}),
  imageUrls: z.array(httpUrl).max(50).default([]),
  sourceCategory: z.string().trim().max(255).optional(),
  /**
   * The legal classification the SUPPLIER announces (Humbert: "C1b", "B2abis").
   * Shown next to the legal category in the triage sheet to help the human —
   * never copied into it.
   */
  supplierLegalClass: z.string().trim().max(50).optional(),
  /**
   * What the supplier charges US, excl. VAT, as its pro area shows it to a
   * signed-in reseller (BGM). Stands in for a price list; strictly admin data,
   * never a public field.
   */
  purchasePrice: z.number().positive().max(1_000_000).optional(),
  sourceUrl: httpUrl,
})

export type CollectedProduct = z.infer<typeof collectedProductSchema>

// --- Identifiers -----------------------------------------------------------

/**
 * Canonical form of a supplier reference, the key both sides of a
 * reconciliation are compared on. Case and the separators people type
 * inconsistently (`BK-01`, `BK 01`, `bk.01`) are dropped; leading zeros are
 * NOT — `0123` and `123` are two different articles.
 */
export function normaliseSupplierRef(ref: string): string {
  return ref
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s\-._/\\]/g, "")
}

/**
 * A GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) with its check digit verified, or
 * null. A spreadsheet that shows `4.00638E+12` has already lost digits: it is
 * rejected, not rebuilt into a wrong code.
 */
export function normaliseEan(raw: string): string | null {
  const digits = raw.replace(/\s/g, "")
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return null
  let sum = 0
  for (let i = 0; i < digits.length - 1; i++) {
    // Weights alternate 3,1,3… starting from the digit next to the check digit.
    const fromRight = digits.length - 1 - i
    sum += Number(digits[i]) * (fromRight % 2 === 1 ? 3 : 1)
  }
  const check = (10 - (sum % 10)) % 10
  return check === Number(digits.at(-1)) ? digits : null
}

/** Kebab-case, accent-free slug, capped without leaving a trailing dash. */
export function slugify(value: string, maxLength = 255): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/, "")
}

// --- Pricing ---------------------------------------------------------------

/**
 * Selling price (excl. VAT) that earns `marginPct` **of the selling price** —
 * the same definition as the profitability report (story 11.10), so the margin
 * proposed here is the margin the admin will later read there.
 * Returns null for a margin outside [0, 100).
 */
export function proposeSalePriceHt(costHt: number, marginPct: number): number | null {
  if (marginPct < 0 || marginPct >= 100) return null
  return round2(costHt / (1 - marginPct / 100))
}

// --- Supplier price lists --------------------------------------------------

/** Which headers of a supplier's price list hold what we need. */
export interface PriceListMapping {
  ref: string
  price: string
  ean?: string
}

export interface PriceListRow {
  /** 1-based row of the source sheet, for the human who has to look it up. */
  line: number
  ref: string
  price: number
  ean: string | null
}

export interface TableIssue {
  line: number
  message: string
}

const HEADER_SEARCH_DEPTH = 20

/**
 * Read a supplier price list whose layout we only know through `mapping`.
 * Real price lists open with a title, a date, a logo row: the header is the
 * first of the top rows that carries both the reference and price columns.
 * Unreadable rows are reported, never guessed.
 */
export function readPriceList(
  table: string[][],
  mapping: PriceListMapping,
): { rows: PriceListRow[]; issues: TableIssue[] } {
  const want = { ref: normaliseHeader(mapping.ref), price: normaliseHeader(mapping.price) }
  const headerIndex = table
    .slice(0, HEADER_SEARCH_DEPTH)
    .findIndex(
      (r) => r.some((c) => normaliseHeader(c) === want.ref) && r.some((c) => normaliseHeader(c) === want.price),
    )
  if (headerIndex === -1) {
    throw new Error(`Price list header not found: expected columns "${mapping.ref}" and "${mapping.price}"`)
  }
  const headers = (table[headerIndex] ?? []).map(normaliseHeader)
  const col = (name: string | undefined) => (name ? headers.indexOf(normaliseHeader(name)) : -1)
  const refIdx = col(mapping.ref)
  const priceIdx = col(mapping.price)
  const eanIdx = col(mapping.ean)

  const rows: PriceListRow[] = []
  const issues: TableIssue[] = []
  for (let i = headerIndex + 1; i < table.length; i++) {
    const cells = table[i] ?? []
    if (cells.every((c) => c.trim() === "")) continue
    const line = i + 1
    const ref = (cells[refIdx] ?? "").trim()
    const price = parseBankAmount(cells[priceIdx] ?? "")
    if (!ref) {
      issues.push({ line, message: "Référence vide" })
    } else if (Number.isNaN(price) || price <= 0) {
      issues.push({ line, message: `Prix illisible pour ${ref} : « ${cells[priceIdx] ?? ""} »` })
    } else {
      rows.push({ line, ref, price, ean: eanIdx === -1 ? null : normaliseEan(cells[eanIdx] ?? "") })
    }
  }
  return { rows, issues }
}

// --- Reconciliation --------------------------------------------------------

export type ReconcileStatus = "matched" | "no_price" | "ambiguous"

export interface ReconciledRow {
  product: CollectedProduct
  price: PriceListRow | null
  status: ReconcileStatus
  matchedBy: "ref" | "ean" | null
}

/**
 * Pair each collected product with its line of the supplier's price list:
 * first on the normalised reference, then on the EAN. A reference that appears
 * twice in the price list is ambiguous and is NOT resolved by picking one —
 * a wrong price is worse than a missing one. Every price line that ends up
 * unused is returned, so nothing disappears silently.
 */
export function reconcileCatalog(
  products: CollectedProduct[],
  prices: PriceListRow[],
): { rows: ReconciledRow[]; orphanPrices: PriceListRow[] } {
  const byRef = new Map<string, PriceListRow[]>()
  const byEan = new Map<string, PriceListRow[]>()
  for (const p of prices) {
    const key = normaliseSupplierRef(p.ref)
    byRef.set(key, [...(byRef.get(key) ?? []), p])
    if (p.ean) byEan.set(p.ean, [...(byEan.get(p.ean) ?? []), p])
  }

  const used = new Set<PriceListRow>()
  const rows = products.map((product): ReconciledRow => {
    const refHits = byRef.get(normaliseSupplierRef(product.supplierSku)) ?? []
    if (refHits.length > 1) return { product, price: null, status: "ambiguous", matchedBy: null }
    const [refHit] = refHits
    if (refHit && !used.has(refHit)) {
      used.add(refHit)
      return { product, price: refHit, status: "matched", matchedBy: "ref" }
    }
    const ean = product.ean ? normaliseEan(product.ean) : null
    const eanHits = ean ? (byEan.get(ean) ?? []) : []
    if (eanHits.length > 1) return { product, price: null, status: "ambiguous", matchedBy: null }
    const [eanHit] = eanHits
    if (eanHit && !used.has(eanHit)) {
      used.add(eanHit)
      return { product, price: eanHit, status: "matched", matchedBy: "ean" }
    }
    return { product, price: null, status: "no_price", matchedBy: null }
  })

  return { rows, orphanPrices: prices.filter((p) => !used.has(p)) }
}

// --- Triage workbook <-> import --------------------------------------------

export interface CatalogImportColumn {
  key: string
  header: string
  required: boolean
}

/**
 * The columns of the triage workbook, in order. The builder writes these
 * headers and the import reads them back — one list, so the two cannot drift.
 * The import also accepts a column titled with its technical `key`.
 */
export const CATALOG_IMPORT_COLUMNS = [
  { key: "import", header: "Importer", required: true },
  // Story 12.4: online or not. Blank leaves an existing product as it is.
  { key: "active", header: "Actif", required: false },
  { key: "supplier", header: "Fournisseur", required: true },
  { key: "supplierSku", header: "Réf. fournisseur", required: true },
  { key: "ean", header: "EAN", required: false },
  { key: "name", header: "Nom", required: true },
  { key: "brand", header: "Marque", required: false },
  { key: "category", header: "Catégorie", required: true },
  { key: "legalCategory", header: "Catégorie légale", required: true },
  // Informational only: the import ignores it.
  { key: "supplierLegalClass", header: "Classement fournisseur", required: false },
  { key: "costPriceHt", header: "Prix d'achat HT", required: false },
  { key: "priceHt", header: "Prix de vente HT", required: true },
  { key: "vatPct", header: "TVA %", required: false },
  { key: "stockQty", header: "Stock", required: false },
  { key: "description", header: "Description courte", required: false },
  { key: "longDescription", header: "Description longue", required: false },
  { key: "imageUrls", header: "Images", required: false },
  { key: "sourceCategory", header: "Famille fournisseur", required: false },
  { key: "sourceUrl", header: "URL source", required: false },
  { key: "matchStatus", header: "Rapprochement", required: false },
  { key: "sku", header: "SKU", required: false },
  // Story 12.4, written by the catalogue export. Informational: the import ignores it.
  { key: "duplicates", header: "Doublon possible", required: false },
  // When the exported product was last modified: lets the import spot a sheet
  // older than an edit made in the back-office since.
  { key: "version", header: "Version", required: false },
] as const satisfies readonly CatalogImportColumn[]

export type CatalogImportColumnKey = (typeof CATALOG_IMPORT_COLUMNS)[number]["key"]

/** Values offered in the legal-category drop-down of the triage workbook. */
export const LEGAL_CATEGORY_CHOICES = ["A", "B", "C", "D", "Aucune"] as const

/** Values offered in the "Importer" and "Actif" drop-downs. */
export const IMPORT_CHOICES = ["oui", "non"] as const

const NONE_SPELLINGS = new Set(
  ["none", "aucune", "aucun", "libre", "nonclassee", "hors categorie"].map(normaliseHeader),
)

/** A legal category from what a human typed, or null — never a guess. */
export function parseLegalCategory(raw: string): LegalCategory | null {
  const value = raw.trim()
  if (!value) return null
  const upper = value.toUpperCase()
  if ((LEGAL_CATEGORIES as readonly string[]).includes(upper) && upper !== "NONE") return upper as LegalCategory
  return NONE_SPELLINGS.has(normaliseHeader(value)) ? "none" : null
}

const YES = new Set(["oui", "o", "yes", "y", "x", "1", "true", "vrai"])
const NO = new Set(["non", "n", "no", "0", "false", "faux"])

export interface CatalogImportRow {
  /** "Actif": true / false, or null when the cell is blank (an existing product keeps its state). */
  active: boolean | null
  /** "Version": the product's last modification when the sheet was exported, or null. */
  version: Date | null
  supplier: string
  supplierSku: string
  ean: string | null
  name: string
  brand: string | null
  /** Category slug or display name — resolved against the database by the API. */
  category: string
  legalCategory: LegalCategory
  costPriceHt: number | null
  priceHt: number
  /** Null when the cell is blank: a new product then gets 20 %, an existing one keeps its rate. */
  vatPct: number | null
  /** Null when the cell is blank: a new product then starts at 0, an existing one keeps its stock. */
  stockQty: number | null
  description: string | null
  longDescription: string | null
  imageUrls: string[]
  sourceCategory: string | null
  sourceUrl: string | null
  sku: string
  slug: string
}

export interface ParsedImportRow {
  /** 1-based row of the sheet. */
  line: number
  status: "valid" | "invalid" | "skipped"
  errors: string[]
  data: CatalogImportRow | null
  /** What the row says it is, as typed — so even a refused row can be found by a human. */
  label: { supplier: string | null; supplierSku: string | null; name: string | null }
}

export const MAX_IMPORT_IMAGES_PER_ROW = 20

/** Upload cap of a triage file: ~20 000 rows of text fit well under it. */
export const MAX_CATALOG_IMPORT_FILE_BYTES = 15 * 1024 * 1024

/** Limits mirror the columns they end up in (see `products`). */
const TEXT_LIMITS = {
  supplier: 255,
  supplierSku: 100,
  name: 255,
  brand: 100,
  category: 100,
  description: 1000,
  longDescription: 20000,
  sourceCategory: 255,
  sourceUrl: 1024,
  sku: 100,
} as const

/** The SKU an imported row gets when the sheet leaves it blank. */
export function deriveImportSku(supplier: string, supplierSku: string): string {
  return `${slugify(supplier, 40).toUpperCase()}-${normaliseSupplierRef(supplierSku)}`.slice(0, TEXT_LIMITS.sku)
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === "https:" || u.protocol === "http:"
  } catch {
    return false
  }
}

function parseRow(get: (key: CatalogImportColumnKey) => string, line: number): ParsedImportRow {
  const label = {
    supplier: get("supplier") || null,
    supplierSku: get("supplierSku") || null,
    name: get("name").slice(0, 255) || null,
  }
  const importCell = normaliseHeader(get("import"))
  if (!importCell || NO.has(importCell)) return { line, status: "skipped", errors: [], data: null, label }

  const errors: string[] = []
  if (!YES.has(importCell)) errors.push(`« Importer » doit valoir oui ou non (lu : « ${get("import")} »)`)

  const text = (key: keyof typeof TEXT_LIMITS, column: string, required: boolean): string | null => {
    const value = get(key)
    if (!value) {
      if (required) errors.push(`« ${column} » est vide`)
      return null
    }
    // A cell that starts with `=` is a formula that was never evaluated: storing
    // its source as a product name is never what the human meant.
    if (value.startsWith("=")) errors.push(`${column} : formule non évaluée « ${value.slice(0, 40)} »`)
    if (value.length > TEXT_LIMITS[key]) errors.push(`${column} : ${TEXT_LIMITS[key]} caractères au plus`)
    return value
  }
  const number = (key: CatalogImportColumnKey, column: string, fallback: number | null, min: number, max: number) => {
    const raw = get(key)
    if (!raw) return fallback
    const n = parseBankAmount(raw)
    if (Number.isNaN(n) || n < min || n > max) {
      errors.push(`${column} illisible ou hors bornes : « ${raw} »`)
      return fallback
    }
    return n
  }

  const supplier = text("supplier", "Fournisseur", true)
  const supplierSku = text("supplierSku", "Réf. fournisseur", true)
  const name = text("name", "Nom", true)
  const brand = text("brand", "Marque", false)
  const category = text("category", "Catégorie", true)
  const description = text("description", "Description courte", false)
  const longDescription = text("longDescription", "Description longue", false)
  const sourceCategory = text("sourceCategory", "Famille fournisseur", false)
  const sourceUrl = text("sourceUrl", "URL source", false)
  if (sourceUrl && !isHttpUrl(sourceUrl)) errors.push(`URL source invalide : « ${sourceUrl} »`)

  const legalCategory = parseLegalCategory(get("legalCategory"))
  if (!legalCategory) {
    errors.push(
      get("legalCategory")
        ? `Catégorie légale inconnue : « ${get("legalCategory")} » (A, B, C, D ou Aucune)`
        : "Catégorie légale obligatoire : elle n'est jamais déduite automatiquement",
    )
  }

  const rawEan = get("ean")
  const ean = rawEan ? normaliseEan(rawEan) : null
  if (rawEan && !ean) errors.push(`EAN invalide : « ${rawEan} »`)

  const priceHt = number("priceHt", "Prix de vente HT", null, 0, 10_000_000)
  if (priceHt === null && !get("priceHt")) errors.push("« Prix de vente HT » est vide")
  else if (priceHt === 0) errors.push("Prix de vente HT nul")
  const costPriceHt = number("costPriceHt", "Prix d'achat HT", null, 0, 10_000_000)
  // `products.vat_pct` is decimal(4,2): 100 would overflow and abort the whole batch.
  const vatPct = number("vatPct", "TVA %", null, 0, 99.99)
  const stockQty = number("stockQty", "Stock", null, 0, 1_000_000)

  const activeCell = normaliseHeader(get("active"))
  const active = !activeCell ? null : YES.has(activeCell) ? true : NO.has(activeCell) ? false : undefined
  if (active === undefined) errors.push(`« Actif » doit valoir oui, non ou rester vide (lu : « ${get("active")} »)`)

  const rawVersion = get("version")
  const version = rawVersion ? new Date(rawVersion) : null
  if (version && Number.isNaN(version.getTime())) {
    errors.push(`« Version » illisible : « ${rawVersion} » (colonne écrite par l'export, à ne pas modifier)`)
  }
  if (stockQty !== null && !Number.isInteger(stockQty)) errors.push(`Stock non entier : « ${get("stockQty")} »`)

  const imageUrls = get("imageUrls")
    .split(/[\s|]+/)
    .filter(Boolean)
  for (const url of imageUrls) if (!isHttpUrl(url)) errors.push(`URL d'image invalide : « ${url} »`)
  if (imageUrls.length > MAX_IMPORT_IMAGES_PER_ROW) errors.push(`${MAX_IMPORT_IMAGES_PER_ROW} images au plus`)

  const sku = text("sku", "SKU", false) ?? (supplier && supplierSku ? deriveImportSku(supplier, supplierSku) : "")
  const slug = slugify([brand, name, supplierSku].filter(Boolean).join(" "))
  if (name && supplierSku && (!slug || RESERVED_PRODUCT_SLUGS.includes(slug))) {
    errors.push("Impossible de dériver une adresse de page pour ce nom")
  }

  if (errors.length > 0 || !supplier || !supplierSku || !name || !category || !legalCategory || priceHt === null) {
    return { line, status: "invalid", errors, data: null, label }
  }
  return {
    line,
    label,
    status: "valid",
    errors: [],
    data: {
      active: active ?? null,
      version,
      supplier,
      supplierSku,
      ean,
      name,
      brand,
      category,
      legalCategory,
      costPriceHt,
      priceHt: round2(priceHt),
      vatPct,
      stockQty,
      description,
      longDescription,
      imageUrls,
      sourceCategory,
      sourceUrl,
      sku,
      slug,
    },
  }
}

/**
 * Read a triage sheet (header row first) into validated rows. Rows not marked
 * for import are `skipped` without being validated — the human may have left
 * them half-filled on purpose. Within one file, a supplier reference may only
 * appear once: the second occurrence is refused, pointing at the first.
 */
export function parseCatalogImportTable(table: string[][]): { rows: ParsedImportRow[]; missingColumns: string[] } {
  // The header is the first non-blank row; blank rows are kept so line numbers stay true.
  const headerIndex = Math.max(
    0,
    table.findIndex((r) => r.some((c) => c.trim() !== "")),
  )
  const headers = (table[headerIndex] ?? []).map(normaliseHeader)
  const index = new Map<CatalogImportColumnKey, number>()
  for (const col of CATALOG_IMPORT_COLUMNS) {
    const i = headers.findIndex((h) => h === normaliseHeader(col.header) || h === normaliseHeader(col.key))
    if (i !== -1) index.set(col.key, i)
  }
  const missingColumns = CATALOG_IMPORT_COLUMNS.filter((c) => c.required && !index.has(c.key)).map((c) => c.header)
  if (missingColumns.length > 0) return { rows: [], missingColumns }

  const seen = new Map<string, number>()
  const rows: ParsedImportRow[] = []
  for (let i = headerIndex + 1; i < table.length; i++) {
    const cells = table[i] ?? []
    if (cells.every((c) => c.trim() === "")) continue
    const get = (key: CatalogImportColumnKey) => {
      const at = index.get(key)
      return at === undefined ? "" : (cells[at] ?? "").trim()
    }
    const row = parseRow(get, i + 1)
    if (row.data) {
      const key = `${normaliseHeader(row.data.supplier)}|${normaliseSupplierRef(row.data.supplierSku)}`
      const first = seen.get(key)
      if (first !== undefined) {
        row.status = "invalid"
        row.errors.push(`Doublon de la ligne ${first} (même fournisseur et même référence)`)
        row.data = null
      } else seen.set(key, row.line)
    }
    rows.push(row)
  }
  return { rows, missingColumns }
}
