// Story 12.8d — what a Henrri quote contains, built from the quote request
// alone: each line at the price SCS set, then the delivery. Pure, like the
// invoice draft (documents.ts), and checked against the frozen total the same way.

import {
  type DocumentDraft,
  type DraftLine,
  type DraftResult,
  fromCents,
  type InvoiceSource,
  SHIPPING_ARTICLE,
  shippingHtCentsByRate,
  toCents,
  totalsOf,
} from "./documents.js"

export interface QuotationLine {
  productName: string
  productSku: string
  variantLabel: string | null
  qty: number
  /** Null until SCS has priced the line. */
  quotedPriceHt: number | null
  vatPct: number
}

export interface QuotationSource {
  lines: QuotationLine[]
  shippingPortions: NonNullable<InvoiceSource["shippingPortions"]>
  totalTtc: number
}

/** The quote's lines, on the very articles the invoice of the order will bill. */
export function buildQuotationDraft(source: QuotationSource): DraftResult {
  const lines: DraftLine[] = []
  for (const line of source.lines) {
    if (line.quotedPriceHt === null) return { ok: false, reason: "UnpricedLine" }
    lines.push({
      designation: line.variantLabel ? `${line.productName} — ${line.variantLabel}` : line.productName,
      article: { reference: line.productSku, description: line.productName },
      quantity: line.qty,
      unitPrice: line.quotedPriceHt,
      vatPct: line.vatPct,
    })
  }
  for (const [vatPct, htCents] of shippingHtCentsByRate(source.shippingPortions)) {
    lines.push({
      designation: SHIPPING_ARTICLE.description,
      article: SHIPPING_ARTICLE,
      quantity: 1,
      unitPrice: fromCents(htCents),
      vatPct,
    })
  }
  if (toCents(totalsOf(lines).totalTtc) !== toCents(source.totalTtc)) return { ok: false, reason: "SnapshotMismatch" }
  const draft: DocumentDraft = { lines, expectedTotalTtc: source.totalTtc }
  return { ok: true, draft }
}
