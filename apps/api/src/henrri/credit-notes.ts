// Story 12.6 — what a Henrri credit note contains (decisions 2026-10-14):
// - a goods return credits the returned articles, at their own VAT rate, net of
//   their VIP discount; the last unit of a line takes exactly what is left of it;
// - a goodwill gesture is split over what is left to credit, rate by rate, and
//   cancels it exactly when it settles the rest;
// - an overpayment refund gets no credit note: it does not reduce the sale;
// - credit notes, all together, never exceed the invoice.
// Each credit note is built on the ones before it (a ledger replayed from the
// order's earlier refunds), so the outcome is the same however often it is built.
// Pure: no database, no network.

import { computeVatTotals, htCentsForTtc } from "@armurier/shared"
import {
  addToBucket,
  type DocumentDraft,
  type DraftLine,
  type DraftRefusal,
  type DraftResult,
  fromCents,
  type InvoiceBreakdown,
  type InvoiceSource,
  invoiceBreakdown,
  REFUND_ARTICLE,
  SHIPPING_ARTICLE,
  shippingHtCentsByRate,
  toCents,
  totalsOf,
} from "./documents.js"

export type RefundKind = "goods_return" | "goodwill" | "overpayment"

/** An article of the order (its index in the snapshot) and how many came back. */
export interface ReturnedLine {
  item: number
  qty: number
}

export interface RefundRecord {
  kind: RefundKind
  /** What was refunded; for a goods return it follows from the lines. */
  amountTtc: number
  lines: ReturnedLine[] | null
  includesShipping: boolean
}

type AmountResult = { ok: true; amountTtc: number } | { ok: false; reason: DraftRefusal }

/** What earlier credit notes of the order already took. */
interface Ledger {
  returnedQty: number[]
  creditedItemHtCents: number[]
  shippingRefunded: boolean
  creditedHtCentsByRate: Map<number, number>
}

interface Credit {
  lines: DraftLine[]
  htCentsByRate: Map<number, number>
  items: Array<{ item: number; qty: number; htCents: number }>
  shipping: boolean
}

function sumOf(values: Iterable<number>): number {
  let total = 0
  for (const value of values) total += value
  return total
}

/** TTC cents Henrri totals for HT cents per rate: VAT rounded once per rate. */
function ttcCentsOf(htCentsByRate: Map<number, number>): number {
  return toCents(
    computeVatTotals([...htCentsByRate].map(([vatPct, cents]) => ({ priceHt: fromCents(cents), vatPct }))).totalTtc,
  )
}

function invoiceHtCentsByRate(breakdown: InvoiceBreakdown): Map<number, number> {
  return new Map(totalsOf(breakdown.invoiceLines).byRate.map((rate) => [rate.vatPct, toCents(rate.totalHt)]))
}

/** HT cents still creditable, by rate (rates fully credited are left out). */
function remainingHtCentsByRate(breakdown: InvoiceBreakdown, ledger: Ledger): Map<number, number> {
  const remaining = new Map<number, number>()
  for (const [vatPct, cents] of invoiceHtCentsByRate(breakdown)) {
    const left = cents - (ledger.creditedHtCentsByRate.get(vatPct) ?? 0)
    if (left > 0) remaining.set(vatPct, left)
  }
  return remaining
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

/** Each TTC share priced HT, or null when one has no HT that Henrri lands on. */
function pricedShares(ttcSharesByRate: Map<number, number>): Map<number, number> | null {
  const priced = new Map<number, number>()
  for (const [vatPct, ttcCents] of ttcSharesByRate) {
    const htCents = htCentsForTtc(ttcCents, vatPct)
    if (htCents === null) return null
    priced.set(vatPct, htCents)
  }
  return priced
}

// One or two cents moved between two rates always suffice in practice: at most
// one TTC amount in a row is unreachable at the rates in force.
const CENT_SHIFTS = [1, -1, 2, -2]

/** The TTC shares priced HT, moving a cent or two between rates when one has no exact HT. */
function expressibleShares(ttcSharesByRate: Map<number, number>): Map<number, number> | null {
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

function exceedsRemaining(htCentsByRate: Map<number, number>, remaining: Map<number, number>): boolean {
  return [...htCentsByRate].some(([vatPct, cents]) => cents > (remaining.get(vatPct) ?? 0))
}

function goodsReturnCredit(breakdown: InvoiceBreakdown, refund: RefundRecord, ledger: Ledger): Credit | DraftRefusal {
  const returned = refund.lines ?? []
  if (returned.length === 0 && !refund.includesShipping) return "NothingToCredit"

  const credit: Credit = { lines: [], htCentsByRate: new Map(), items: [], shipping: false }
  for (const { item, qty } of returned) {
    const line = breakdown.lines[item]
    const alreadyReturned = ledger.returnedQty[item] ?? 0
    if (!line || !Number.isInteger(qty) || qty <= 0 || alreadyReturned + qty > line.qty) return "ReturnExceedsOrder"

    const netCents = toCents(line.priceHt * line.qty) - toCents(line.discountHt)
    const isLast = alreadyReturned + qty === line.qty
    // The last unit back takes exactly what is left of the line: returns add up to it.
    const htCents = isLast
      ? netCents - (ledger.creditedItemHtCents[item] ?? 0)
      : Math.round((netCents * qty) / line.qty)
    credit.lines.push({
      designation: `Retour — ${line.name}${qty > 1 ? ` × ${qty}` : ""}`,
      article: { reference: line.sku, description: line.name },
      quantity: 1,
      unitPrice: fromCents(htCents),
      vatPct: line.vatPct,
    })
    addToBucket(credit.htCentsByRate, line.vatPct, htCents)
    credit.items.push({ item, qty, htCents })
  }

  if (refund.includesShipping) {
    if (ledger.shippingRefunded) return "ShippingAlreadyRefunded"
    for (const [vatPct, htCents] of shippingHtCentsByRate(breakdown.shipping)) {
      credit.lines.push({
        designation: "Frais de port remboursés",
        article: SHIPPING_ARTICLE,
        quantity: 1,
        unitPrice: fromCents(htCents),
        vatPct,
      })
      addToBucket(credit.htCentsByRate, vatPct, htCents)
    }
    credit.shipping = true
  }

  // A goodwill gesture may already have taken part of these rates.
  if (exceedsRemaining(credit.htCentsByRate, remainingHtCentsByRate(breakdown, ledger))) return "InvalidRefundAmount"
  return credit
}

function goodwillCredit(
  breakdown: InvoiceBreakdown,
  amountCents: number,
  ledger: Ledger,
  orderRef: string,
): Credit | DraftRefusal {
  const remaining = remainingHtCentsByRate(breakdown, ledger)
  const remainingTtcCents = ttcCentsOf(remaining)
  if (amountCents <= 0 || amountCents > remainingTtcCents) return "InvalidRefundAmount"

  let htCentsByRate: Map<number, number> | null
  if (amountCents === remainingTtcCents) {
    // Settles the rest: cancels exactly what is left, rate by rate.
    htCentsByRate = remaining
  } else {
    const weights = new Map([...remaining].map(([vatPct, cents]) => [vatPct, ttcCentsOf(new Map([[vatPct, cents]]))]))
    htCentsByRate = expressibleShares(allocateCents(amountCents, weights))
    if (!htCentsByRate) return "InexpressibleAmount"
    if (exceedsRemaining(htCentsByRate, remaining)) return "InvalidRefundAmount"
  }

  const lines = [...htCentsByRate].map(([vatPct, htCents]) => ({
    designation: `Geste commercial — commande ${orderRef}`,
    article: REFUND_ARTICLE,
    quantity: 1,
    unitPrice: fromCents(htCents),
    vatPct,
  }))
  return { lines, htCentsByRate, items: [], shipping: false }
}

function creditOf(breakdown: InvoiceBreakdown, refund: RefundRecord, ledger: Ledger, orderRef: string) {
  return refund.kind === "goods_return"
    ? goodsReturnCredit(breakdown, refund, ledger)
    : goodwillCredit(breakdown, toCents(refund.amountTtc), ledger, orderRef)
}

function record(ledger: Ledger, credit: Credit) {
  for (const { item, qty, htCents } of credit.items) {
    ledger.returnedQty[item] = (ledger.returnedQty[item] ?? 0) + qty
    ledger.creditedItemHtCents[item] = (ledger.creditedItemHtCents[item] ?? 0) + htCents
  }
  if (credit.shipping) ledger.shippingRefunded = true
  for (const [vatPct, cents] of credit.htCentsByRate) addToBucket(ledger.creditedHtCentsByRate, vatPct, cents)
}

/** What the order's earlier refunds took, credit note by credit note. */
function replay(breakdown: InvoiceBreakdown, previous: RefundRecord[], orderRef: string): Ledger | DraftRefusal {
  const ledger: Ledger = {
    returnedQty: [],
    creditedItemHtCents: [],
    shippingRefunded: false,
    creditedHtCentsByRate: new Map(),
  }
  for (const refund of previous) {
    if (refund.kind === "overpayment") continue
    const credit = creditOf(breakdown, refund, ledger, orderRef)
    if (typeof credit === "string") return credit
    record(ledger, credit)
  }
  return ledger
}

/** The credit note of `refund`, built on the order's earlier refunds (`previous`, oldest first). */
export function creditNoteFor(
  source: InvoiceSource,
  refund: RefundRecord,
  previous: RefundRecord[],
  orderRef: string,
): DraftResult {
  if (refund.kind === "overpayment") return { ok: false, reason: "NoCreditNote" }
  const breakdown = invoiceBreakdown(source)
  if (typeof breakdown === "string") return { ok: false, reason: breakdown }
  const ledger = replay(breakdown, previous, orderRef)
  if (typeof ledger === "string") return { ok: false, reason: ledger }

  const credit = creditOf(breakdown, refund, ledger, orderRef)
  if (typeof credit === "string") return { ok: false, reason: credit }
  const draft: DocumentDraft = { lines: credit.lines, expectedTotalTtc: fromCents(ttcCentsOf(credit.htCentsByRate)) }
  return { ok: true, draft }
}

/** The money a refund moves: computed from the lines for a goods return. */
export function refundedAmountOf(source: InvoiceSource, refund: RefundRecord, previous: RefundRecord[]): AmountResult {
  if (refund.kind === "overpayment") return { ok: true, amountTtc: refund.amountTtc }
  const creditNote = creditNoteFor(source, refund, previous, "")
  if (!creditNote.ok) return creditNote
  return { ok: true, amountTtc: creditNote.draft.expectedTotalTtc }
}

/** TTC still creditable on the order once its earlier credit notes are out. */
export function remainingToCredit(source: InvoiceSource, previous: RefundRecord[]): AmountResult {
  const breakdown = invoiceBreakdown(source)
  if (typeof breakdown === "string") return { ok: false, reason: breakdown }
  const ledger = replay(breakdown, previous, "")
  if (typeof ledger === "string") return { ok: false, reason: ledger }
  return { ok: true, amountTtc: fromCents(ttcCentsOf(remainingHtCentsByRate(breakdown, ledger))) }
}

// How far the refund form looks for a gesture Henrri can express.
const NEAREST_SEARCH_CENTS = 10

/**
 * The closest goodwill amounts, below and above `amountTtc`, that a credit note
 * can express — never above `capTtc`, what the payment channel can still refund
 * (audit 2026-10-14). Null on a side with none within ten cents.
 */
export function nearestExpressibleRefunds(
  source: InvoiceSource,
  amountTtc: number,
  previous: RefundRecord[],
  capTtc: number,
): { below: number | null; above: number | null } {
  const amountCents = toCents(amountTtc)
  const capCents = toCents(capTtc)
  const expressible = (cents: number) =>
    creditNoteFor(
      source,
      { kind: "goodwill", amountTtc: fromCents(cents), lines: null, includesShipping: false },
      previous,
      "",
    ).ok
  const search = (direction: 1 | -1) => {
    for (let step = 1; step <= NEAREST_SEARCH_CENTS; step += 1) {
      const cents = amountCents + direction * step
      if (cents <= 0 || cents > capCents) return null
      if (expressible(cents)) return fromCents(cents)
    }
    return null
  }
  return { below: search(-1), above: search(1) }
}
