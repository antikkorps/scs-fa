// Story 12.6 — what a Henrri invoice contains, built from the order snapshot
// alone, and the building blocks credit notes share with it (credit-notes.ts).
// Pure: no database, no network. The Henrri client turns a draft into API calls;
// Henrri then recomputes the totals, and the caller only finalizes when they
// match `expectedTotalTtc` to the cent.

import { computeVatTotals, round2 } from "@armurier/shared"
import type { orders } from "../db/schema.js"

type OrderRow = typeof orders.$inferSelect

export interface InvoiceSource {
  itemsJson: OrderRow["itemsJson"]
  shippingPortions: OrderRow["shippingPortions"]
  totalTtc: number
}

/** The Henrri catalog article a line bills: Henrri invoices articles only. */
export interface DraftArticle {
  reference: string
  description: string
}

export interface DraftLine {
  /** What the line reads on the invoice; may differ from the article's description. */
  designation: string
  article: DraftArticle
  quantity: number
  /** HT, in cents precision. */
  unitPrice: number
  vatPct: number
}

export interface DocumentDraft {
  lines: DraftLine[]
  expectedTotalTtc: number
}

export type DraftRefusal =
  | "LegacySnapshot"
  | "SnapshotMismatch"
  | "InvalidRefundAmount"
  | "InexpressibleAmount"
  | "ReturnExceedsOrder"
  | "ShippingAlreadyRefunded"
  | "NothingToCredit"
  | "NoCreditNote"
  | "UnpricedLine"

export type DraftResult = { ok: true; draft: DocumentDraft } | { ok: false; reason: DraftRefusal }

/** One line of the order snapshot, with what the invoice bills for it. */
export interface PricedLine {
  name: string
  sku: string
  qty: number
  priceHt: number
  vatPct: number
  discountHt: number
}

/** The order as invoiced: its lines, its delivery shares, and the invoice lines. */
export interface InvoiceBreakdown {
  lines: PricedLine[]
  shipping: NonNullable<InvoiceSource["shippingPortions"]>
  invoiceLines: DraftLine[]
}

// Lines without a product SKU bill these fixed articles, at any VAT rate (the
// line carries its own rate and price).
export const SHIPPING_ARTICLE: DraftArticle = { reference: "PORT", description: "Frais de port" }
const VIP_DISCOUNT_ARTICLE: DraftArticle = { reference: "REMISE-VIP", description: "Remise VIP" }
export const REFUND_ARTICLE: DraftArticle = { reference: "REMBOURSEMENT", description: "Remboursement" }

export function toCents(amount: number): number {
  return Math.round(amount * 100)
}

export function fromCents(cents: number): number {
  return cents / 100
}

/** Adds `cents` to the bucket of `vatPct`, keeping first-seen order. */
export function addToBucket(buckets: Map<number, number>, vatPct: number, cents: number) {
  buckets.set(vatPct, (buckets.get(vatPct) ?? 0) + cents)
}

/** The snapshot lines, or null when the order predates the VAT-carrying snapshot. */
function pricedLines(source: InvoiceSource): PricedLine[] | null {
  const lines: PricedLine[] = []
  for (const item of source.itemsJson) {
    if (item.vatPct === undefined || item.discountHt === undefined) return null
    lines.push({
      name: item.name,
      sku: item.sku,
      qty: item.qty,
      priceHt: item.priceHt,
      vatPct: item.vatPct,
      discountHt: item.discountHt,
    })
  }
  return lines
}

/** HT cents of the delivery, by VAT rate. */
export function shippingHtCentsByRate(shipping: InvoiceBreakdown["shipping"]): Map<number, number> {
  const buckets = new Map<number, number>()
  for (const portion of shipping) addToBucket(buckets, portion.vatPct, toCents(portion.priceHt))
  return buckets
}

function invoiceLines(lines: PricedLine[], shipping: InvoiceBreakdown["shipping"]): DraftLine[] {
  const draftLines: DraftLine[] = []
  for (const line of lines) {
    draftLines.push({
      designation: line.name,
      article: { reference: line.sku, description: line.name },
      quantity: line.qty,
      unitPrice: line.priceHt,
      vatPct: line.vatPct,
    })
    if (line.discountHt > 0) {
      draftLines.push({
        designation: `Remise VIP — ${line.name}`,
        article: VIP_DISCOUNT_ARTICLE,
        quantity: 1,
        unitPrice: -line.discountHt,
        vatPct: line.vatPct,
      })
    }
  }
  for (const [vatPct, htCents] of shippingHtCentsByRate(shipping)) {
    draftLines.push({
      designation: SHIPPING_ARTICLE.description,
      article: SHIPPING_ARTICLE,
      quantity: 1,
      unitPrice: fromCents(htCents),
      vatPct,
    })
  }
  return draftLines
}

/** The totals Henrri will compute for these lines: VAT by rate, as the cart did. */
export function totalsOf(lines: DraftLine[]) {
  return computeVatTotals(
    lines.map((line) => ({ priceHt: round2(line.unitPrice * line.quantity), vatPct: line.vatPct })),
  )
}

/** The order as invoiced, once checked to add up to its total the way Henrri adds it. */
export function invoiceBreakdown(source: InvoiceSource): InvoiceBreakdown | DraftRefusal {
  const lines = pricedLines(source)
  if (lines === null || source.shippingPortions === null) return "LegacySnapshot"
  const draftLines = invoiceLines(lines, source.shippingPortions)
  if (toCents(totalsOf(draftLines).totalTtc) !== toCents(source.totalTtc)) return "SnapshotMismatch"
  return { lines, shipping: source.shippingPortions, invoiceLines: draftLines }
}

/** The invoice of a fully paid order: its lines, VIP discounts and delivery, in HT. */
export function buildInvoiceDraft(source: InvoiceSource): DraftResult {
  const breakdown = invoiceBreakdown(source)
  if (typeof breakdown === "string") return { ok: false, reason: breakdown }
  return { ok: true, draft: { lines: breakdown.invoiceLines, expectedTotalTtc: source.totalTtc } }
}
