// Story 12.6 — what a Henrri invoice or credit note contains, built from the
// order snapshot alone. Pure: no database, no network. The Henrri client turns a
// draft into API calls; Henrri then recomputes the totals, and the caller only
// finalizes when they match `expectedTotalTtc` to the cent.

import { computePriceTtc, round2 } from "@armurier/shared"
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
  /** HT, at up to 8 decimals (Henrri's precision). */
  unitPrice: number
  vatPct: number
}

export interface DocumentDraft {
  lines: DraftLine[]
  expectedTotalTtc: number
}

export type DraftRefusal = "LegacySnapshot" | "SnapshotMismatch" | "InvalidRefundAmount"

export type DraftResult = { ok: true; draft: DocumentDraft } | { ok: false; reason: DraftRefusal }

interface PricedLine {
  name: string
  sku: string
  qty: number
  priceHt: number
  vatPct: number
  discountHt: number
}

// Lines without a product SKU bill these fixed articles, at any VAT rate (the
// line carries its own rate and price).
const SHIPPING_ARTICLE: DraftArticle = { reference: "PORT", description: "Frais de port" }
const VIP_DISCOUNT_ARTICLE: DraftArticle = { reference: "REMISE-VIP", description: "Remise VIP" }
const REFUND_ARTICLE: DraftArticle = { reference: "REMBOURSEMENT", description: "Remboursement" }

function toCents(amount: number): number {
  return Math.round(amount * 100)
}

function fromCents(cents: number): number {
  return cents / 100
}

// Henrri keeps HT prices to 8 decimals (sandbox, 2026-10-14).
const HENRRI_PRICE_DECIMALS = 1e8

/** The HT price whose VAT-inclusive value is exactly `ttc`, at Henrri's precision. */
function htFromTtc(ttc: number, vatPct: number): number {
  return Math.round((ttc / (1 + vatPct / 100)) * HENRRI_PRICE_DECIMALS) / HENRRI_PRICE_DECIMALS
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

/** TTC of a line, rounded the way the cart rounded it (net HT, then VAT). */
function lineTtc(line: PricedLine): number {
  return computePriceTtc(round2(line.priceHt * line.qty - line.discountHt), line.vatPct)
}

/** Adds `cents` to the bucket of `vatPct`, keeping first-seen order. */
function addToBucket(buckets: Map<number, number>, vatPct: number, cents: number) {
  buckets.set(vatPct, (buckets.get(vatPct) ?? 0) + cents)
}

function invoiceLines(lines: PricedLine[], shipping: NonNullable<InvoiceSource["shippingPortions"]>): DraftLine[] {
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

  const shippingHtCentsByRate = new Map<number, number>()
  for (const portion of shipping) {
    addToBucket(shippingHtCentsByRate, portion.vatPct, toCents(portion.priceHt))
  }
  for (const [vatPct, htCents] of shippingHtCentsByRate) {
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

/** TTC cents carried by each VAT rate of the order, goods and delivery together. */
function ttcCentsByRate(lines: PricedLine[], shipping: NonNullable<InvoiceSource["shippingPortions"]>) {
  const buckets = new Map<number, number>()
  for (const line of lines) addToBucket(buckets, line.vatPct, toCents(lineTtc(line)))
  for (const portion of shipping) addToBucket(buckets, portion.vatPct, toCents(portion.amountTtc))
  return buckets
}

function sumOf(values: Iterable<number>): number {
  let total = 0
  for (const value of values) total += value
  return total
}

/**
 * Splits `amountCents` across the buckets in proportion to their weight, by the
 * largest-remainder method: the shares always add up to `amountCents` exactly.
 */
function allocateCents(amountCents: number, weights: Map<number, number>): Map<number, number> {
  const totalWeight = sumOf(weights.values())
  const shares = [...weights].map(([key, weight]) => {
    const exact = (amountCents * weight) / totalWeight
    return { key, cents: Math.floor(exact), remainder: exact - Math.floor(exact) }
  })
  let leftover = amountCents - sumOf(shares.map((share) => share.cents))
  const byRemainder = [...shares].sort((a, b) => b.remainder - a.remainder)
  for (const share of byRemainder) {
    if (leftover === 0) break
    share.cents += 1
    leftover -= 1
  }
  return new Map(shares.filter((share) => share.cents > 0).map((share) => [share.key, share.cents]))
}

interface CheckedSnapshot {
  lines: PricedLine[]
  shipping: NonNullable<InvoiceSource["shippingPortions"]>
}

function checkedSnapshot(source: InvoiceSource): CheckedSnapshot | DraftRefusal {
  const lines = pricedLines(source)
  if (lines === null || source.shippingPortions === null) return "LegacySnapshot"
  const shipping = source.shippingPortions
  if (sumOf(ttcCentsByRate(lines, shipping).values()) !== toCents(source.totalTtc)) return "SnapshotMismatch"
  return { lines, shipping }
}

/** The invoice of a fully paid order: its lines, VIP discounts and delivery, in HT. */
export function buildInvoiceDraft(source: InvoiceSource): DraftResult {
  const snapshot = checkedSnapshot(source)
  if (typeof snapshot === "string") return { ok: false, reason: snapshot }
  return {
    ok: true,
    draft: {
      lines: invoiceLines(snapshot.lines, snapshot.shipping),
      expectedTotalTtc: source.totalTtc,
    },
  }
}

/**
 * The credit note of a refund. A full refund mirrors the invoice; a partial one
 * is split between VAT rates in proportion to what each weighed on the order
 * (decision 2026-10-14). Henrri's tax-included mode does not work through the API,
 * so each share is entered HT at 8 decimals: its TTC is then the refunded cents.
 */
export function buildCreditNoteDraft(source: InvoiceSource, refundTtc: number, orderRef: string): DraftResult {
  const snapshot = checkedSnapshot(source)
  if (typeof snapshot === "string") return { ok: false, reason: snapshot }

  const refundCents = toCents(refundTtc)
  const totalCents = toCents(source.totalTtc)
  if (refundCents <= 0 || refundCents > totalCents) return { ok: false, reason: "InvalidRefundAmount" }
  if (refundCents === totalCents) return buildInvoiceDraft(source)

  const shares = allocateCents(refundCents, ttcCentsByRate(snapshot.lines, snapshot.shipping))
  const lines = [...shares].map(([vatPct, cents]) => ({
    designation: `Remboursement partiel de la commande ${orderRef}`,
    article: REFUND_ARTICLE,
    quantity: 1,
    unitPrice: htFromTtc(fromCents(cents), vatPct),
    vatPct,
  }))
  return { ok: true, draft: { lines, expectedTotalTtc: fromCents(refundCents) } }
}
