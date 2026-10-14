// Story 12.6 — what a Henrri invoice or credit note contains, built from the
// order snapshot alone. Pure: no database, no network. The Henrri client turns a
// draft into API calls; Henrri then recomputes the totals, and the caller only
// finalizes when they match `expectedTotalTtc` to the cent.

import { computeVatTotals, htCentsForTtc, round2 } from "@armurier/shared"
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

export type DraftRefusal = "LegacySnapshot" | "SnapshotMismatch" | "InvalidRefundAmount" | "InexpressibleAmount"

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

/** The totals Henrri will compute for these lines: VAT by rate, as the cart did. */
function totalsOf(lines: DraftLine[]) {
  return computeVatTotals(
    lines.map((line) => ({ priceHt: round2(line.unitPrice * line.quantity), vatPct: line.vatPct })),
  )
}

/** TTC cents carried by each VAT rate of the invoice. */
function ttcCentsByRate(lines: DraftLine[]): Map<number, number> {
  return new Map(totalsOf(lines).byRate.map((rate) => [rate.vatPct, toCents(rate.totalHt + rate.vatAmount)]))
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

/** The invoice lines, once checked to add up to the order total the way Henrri adds them. */
function checkedInvoiceLines(source: InvoiceSource): DraftLine[] | DraftRefusal {
  const lines = pricedLines(source)
  if (lines === null || source.shippingPortions === null) return "LegacySnapshot"
  const draftLines = invoiceLines(lines, source.shippingPortions)
  if (toCents(totalsOf(draftLines).totalTtc) !== toCents(source.totalTtc)) return "SnapshotMismatch"
  return draftLines
}

/** The invoice of a fully paid order: its lines, VIP discounts and delivery, in HT. */
export function buildInvoiceDraft(source: InvoiceSource): DraftResult {
  const lines = checkedInvoiceLines(source)
  if (typeof lines === "string") return { ok: false, reason: lines }
  return { ok: true, draft: { lines, expectedTotalTtc: source.totalTtc } }
}

/**
 * The credit note of a refund. A full refund mirrors the invoice; a partial one
 * is split between VAT rates in proportion to what each weighed on the order
 * (decision 2026-10-14). Henrri's tax-included mode does not work through the API,
 * so each share is entered at the HT whose VAT-inclusive total, as Henrri rounds
 * it, is the share — moving a cent between rates when a share has none. An amount
 * no split can express is refused: see `nearestExpressibleRefunds`.
 */
export function buildCreditNoteDraft(source: InvoiceSource, refundTtc: number, orderRef: string): DraftResult {
  const invoice = checkedInvoiceLines(source)
  if (typeof invoice === "string") return { ok: false, reason: invoice }

  const refundCents = toCents(refundTtc)
  const totalCents = toCents(source.totalTtc)
  if (refundCents <= 0 || refundCents > totalCents) return { ok: false, reason: "InvalidRefundAmount" }
  if (refundCents === totalCents) return { ok: true, draft: { lines: invoice, expectedTotalTtc: source.totalTtc } }

  const shares = expressibleShares(allocateCents(refundCents, ttcCentsByRate(invoice)))
  if (!shares) return { ok: false, reason: "InexpressibleAmount" }
  const lines = shares.map(({ vatPct, htCents }) => ({
    designation: `Remboursement partiel de la commande ${orderRef}`,
    article: REFUND_ARTICLE,
    quantity: 1,
    unitPrice: fromCents(htCents),
    vatPct,
  }))
  return { ok: true, draft: { lines, expectedTotalTtc: fromCents(refundCents) } }
}

interface ExpressibleShare {
  vatPct: number
  htCents: number
}

/** Each TTC share priced HT, or null when one has no HT that Henrri lands on. */
function pricedShares(ttcSharesByRate: Map<number, number>): ExpressibleShare[] | null {
  const priced: ExpressibleShare[] = []
  for (const [vatPct, ttcCents] of ttcSharesByRate) {
    const htCents = htCentsForTtc(ttcCents, vatPct)
    if (htCents === null) return null
    priced.push({ vatPct, htCents })
  }
  return priced
}

// One or two cents moved between two rates always suffice in practice: at most
// one TTC amount in a row is unreachable at the rates in force.
const CENT_SHIFTS = [1, -1, 2, -2]

/**
 * Prices the TTC shares HT; when one has no exact HT, moves a cent or two from
 * one rate to another (the refunded total is unchanged) until all do.
 */
function expressibleShares(ttcSharesByRate: Map<number, number>): ExpressibleShare[] | null {
  const direct = pricedShares(ttcSharesByRate)
  if (direct) return direct
  const rates = [...ttcSharesByRate.keys()]
  for (const shift of CENT_SHIFTS) {
    for (const from of rates) {
      for (const to of rates) {
        if (from === to) continue
        const shifted = new Map(ttcSharesByRate)
        shifted.set(from, (shifted.get(from) ?? 0) - shift)
        shifted.set(to, (shifted.get(to) ?? 0) + shift)
        if ([...shifted.values()].some((cents) => cents <= 0)) continue
        const priced = pricedShares(shifted)
        if (priced) return priced
      }
    }
  }
  return null
}

// How far the admin form looks for an amount Henrri can express.
const NEAREST_SEARCH_CENTS = 10

/**
 * The closest refund amounts, below and above `refundTtc`, for which a credit
 * note can be issued (decision 2026-10-14: the refund form offers them rather
 * than issuing a credit note that does not match the refund). Null on a side
 * with none within ten cents, or beyond the order total.
 */
export function nearestExpressibleRefunds(
  source: InvoiceSource,
  refundTtc: number,
): { below: number | null; above: number | null } {
  const refundCents = toCents(refundTtc)
  const expressible = (cents: number) => buildCreditNoteDraft(source, fromCents(cents), "").ok
  const search = (direction: 1 | -1) => {
    for (let step = 1; step <= NEAREST_SEARCH_CENTS; step += 1) {
      const cents = refundCents + direction * step
      if (expressible(cents)) return fromCents(cents)
    }
    return null
  }
  return { below: search(-1), above: search(1) }
}
