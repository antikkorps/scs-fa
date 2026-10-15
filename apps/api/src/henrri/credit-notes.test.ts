import { computeVatTotals } from "@armurier/shared"
import { describe, expect, it } from "vitest"
import {
  creditNoteFor,
  nearestExpressibleRefunds,
  type RefundRecord,
  refundedAmountOf,
  remainingToCredit,
} from "./credit-notes.js"
import type { InvoiceSource } from "./documents.js"

// Decisions 2026-10-14: a return credits the returned articles at their own VAT
// rate; a goodwill gesture is split pro rata over what is left to credit; an
// overpayment refund gets no credit note; credit notes never exceed the invoice.

const rifle = {
  variantId: "v-rifle",
  qty: 1,
  priceHt: 1000,
  name: "Carabine",
  sku: "CAR-1",
  category: "arme-longue",
  requiresPaymentVirement: true,
  vatPct: 20,
  discountHt: 0,
}
const mats = {
  variantId: "v-mat",
  qty: 3,
  priceHt: 50,
  name: "Tapis de tir",
  sku: "TAP-1",
  category: "accessoire-tireur",
  requiresPaymentVirement: false,
  vatPct: 20,
  discountHt: 10,
}
const print = {
  printId: "p-1",
  qty: 1,
  priceHt: 100,
  name: "Estampe",
  sku: "1/25",
  category: "gun-art",
  requiresPaymentVirement: false,
  vatPct: 5.5,
  discountHt: 0,
}
const parcel = { amountTtc: 25, priceHt: 20.83, vatAmount: 4.17, vatPct: 20 }

// HT at 20 %: 1000 + 140 + 20.83 = 1160.83 → VAT 232.17 ; at 5.5 %: 100 → 5.50. Total 1498.50.
const order: InvoiceSource = { itemsJson: [rifle, mats, print], shippingPortions: [parcel], totalTtc: 1498.5 }

const goodwill = (amountTtc: number): RefundRecord => ({
  kind: "goodwill",
  amountTtc,
  lines: null,
  includesShipping: false,
})
const goodsReturn = (lines: Array<{ item: number; qty: number }>, includesShipping = false): RefundRecord => ({
  kind: "goods_return",
  amountTtc: 0,
  lines,
  includesShipping,
})

/** What Henrri totals for a credit note: HT summed per rate, VAT rounded once per rate. */
function henrriTotal(lines: Array<{ unitPrice: number; quantity: number; vatPct: number }>) {
  return computeVatTotals(lines.map((line) => ({ priceHt: line.unitPrice * line.quantity, vatPct: line.vatPct })))
}

describe("credit note of a goods return", () => {
  it("credits the returned print at its own 5.5 % rate, not pro rata", () => {
    const result = creditNoteFor(order, goodsReturn([{ item: 2, qty: 1 }]), [], "ABCD1234")
    if (!result.ok) throw new Error(result.reason)
    expect(result.draft.lines).toEqual([
      {
        designation: "Retour — Estampe",
        article: { reference: "1/25", description: "Estampe" },
        quantity: 1,
        unitPrice: 100,
        vatPct: 5.5,
      },
    ])
    expect(result.draft.expectedTotalTtc).toBe(105.5)
  })

  it("credits part of a line net of its VIP discount", () => {
    // 3 mats: 150 HT − 10 VIP = 140 net ; 2 of them → 93.33.
    const result = creditNoteFor(order, goodsReturn([{ item: 1, qty: 2 }]), [], "ABCD1234")
    if (!result.ok) throw new Error(result.reason)
    expect(result.draft.lines).toEqual([
      expect.objectContaining({ designation: "Retour — Tapis de tir × 2", unitPrice: 93.33 }),
    ])
  })

  it("credits the last unit returned with exactly what is left of its line", () => {
    const first = goodsReturn([{ item: 1, qty: 2 }])
    const result = creditNoteFor(order, goodsReturn([{ item: 1, qty: 1 }]), [first], "ABCD1234")
    if (!result.ok) throw new Error(result.reason)
    // 140 − 93.33 = 46.67: the three returns add up to the line exactly.
    expect(result.draft.lines).toEqual([expect.objectContaining({ unitPrice: 46.67 })])
  })

  it("refunds the delivery once, at its own rates", () => {
    const result = creditNoteFor(order, goodsReturn([{ item: 0, qty: 1 }], true), [], "ABCD1234")
    if (!result.ok) throw new Error(result.reason)
    expect(result.draft.lines.at(-1)).toEqual({
      designation: "Frais de port remboursés",
      article: { reference: "PORT", description: "Frais de port" },
      quantity: 1,
      unitPrice: 20.83,
      vatPct: 20,
    })
    const again = creditNoteFor(order, goodsReturn([{ item: 1, qty: 1 }], true), [goodsReturn([], true)], "ABCD1234")
    expect(again).toEqual({ ok: false, reason: "ShippingAlreadyRefunded" })
  })

  it("refuses to return more than was bought, or than is left", () => {
    expect(creditNoteFor(order, goodsReturn([{ item: 1, qty: 4 }]), [], "ABCD1234")).toEqual({
      ok: false,
      reason: "ReturnExceedsOrder",
    })
    const first = goodsReturn([{ item: 2, qty: 1 }])
    expect(creditNoteFor(order, goodsReturn([{ item: 2, qty: 1 }]), [first], "ABCD1234")).toEqual({
      ok: false,
      reason: "ReturnExceedsOrder",
    })
    expect(creditNoteFor(order, goodsReturn([{ item: 9, qty: 1 }]), [], "ABCD1234")).toEqual({
      ok: false,
      reason: "ReturnExceedsOrder",
    })
  })

  it("refuses an empty return", () => {
    expect(creditNoteFor(order, goodsReturn([]), [], "ABCD1234")).toEqual({ ok: false, reason: "NothingToCredit" })
  })

  it("says what a return will refund: its credit note's total, exact for Henrri", () => {
    expect(refundedAmountOf(order, goodsReturn([{ item: 2, qty: 1 }]), [])).toEqual({ ok: true, amountTtc: 105.5 })
  })
})

describe("credit note of a goodwill gesture", () => {
  it("tells what is left to credit once earlier credit notes are out", () => {
    // 1498.50 − the print (105.50).
    expect(remainingToCredit(order, [goodsReturn([{ item: 2, qty: 1 }])])).toEqual({ ok: true, amountTtc: 1393 })
  })

  it("splits the gesture over what is left to credit, rate by rate", () => {
    // After the print came back, only the 20 % rate is left.
    const previous = [goodsReturn([{ item: 2, qty: 1 }])]
    const result = creditNoteFor(order, goodwill(50), previous, "ABCD1234")
    if (!result.ok) throw new Error(result.reason)
    expect(result.draft.lines).toEqual([
      {
        designation: "Geste commercial — commande ABCD1234",
        article: { reference: "REMBOURSEMENT", description: "Remboursement" },
        quantity: 1,
        unitPrice: 41.67,
        vatPct: 20,
      },
    ])
  })

  it("cancels exactly what is left when the gesture settles the rest", () => {
    const previous = [goodsReturn([{ item: 1, qty: 2 }]), goodwill(100)]
    const left = remainingToCredit(order, previous)
    if (!left.ok) throw new Error(left.reason)
    const result = creditNoteFor(order, goodwill(left.amountTtc), previous, "ABCD1234")
    if (!result.ok) throw new Error(result.reason)
    const credited = [...creditedLines(previous), ...result.draft.lines]
    // Every rate's HT is credited back to the cent.
    expect(henrriTotal(credited).byRate).toEqual([
      { vatPct: 20, totalHt: 1160.83, vatAmount: expect.any(Number) },
      { vatPct: 5.5, totalHt: 100, vatAmount: expect.any(Number) },
    ])
  })

  it("never credits more than the invoice, all credit notes together", () => {
    const previous = [goodsReturn([{ item: 0, qty: 1 }], true)]
    expect(creditNoteFor(order, goodwill(300), previous, "ABCD1234")).toEqual({
      ok: false,
      reason: "InvalidRefundAmount",
    })
  })

  it("refuses an amount Henrri cannot express", () => {
    const rifleOnly: InvoiceSource = { itemsJson: [rifle], shippingPortions: [], totalTtc: 1200 }
    expect(creditNoteFor(rifleOnly, goodwill(33.33), [], "ABCD1234")).toEqual({
      ok: false,
      reason: "InexpressibleAmount",
    })
  })
})

describe("overpayment refunds", () => {
  it("get no credit note: returning money paid in excess does not reduce the sale", () => {
    expect(
      creditNoteFor(order, { kind: "overpayment", amountTtc: 5, lines: null, includesShipping: false }, [], "ABCD1234"),
    ).toEqual({ ok: false, reason: "NoCreditNote" })
  })

  it("take nothing from what is left to credit", () => {
    const previous: RefundRecord[] = [{ kind: "overpayment", amountTtc: 5, lines: null, includesShipping: false }]
    const result = creditNoteFor(order, goodwill(1498.5), previous, "ABCD1234")
    expect(result.ok).toBe(true)
  })
})

describe("nearestExpressibleRefunds", () => {
  const rifleOnly: InvoiceSource = { itemsJson: [rifle], shippingPortions: [], totalTtc: 1200 }

  it("offers the closest gestures Henrri can express, below and above", () => {
    expect(nearestExpressibleRefunds(rifleOnly, 33.33, [], 1200)).toEqual({ below: 33.32, above: 33.34 })
  })

  it("never offers more than the channel can refund", () => {
    // Audit 2026-10-14: the card share of a mixed order can be the cap.
    expect(nearestExpressibleRefunds(rifleOnly, 33.33, [], 33.33)).toEqual({ below: 33.32, above: null })
  })
})

/** The lines of each credit note in turn, each built on the ones before it. */
function creditedLines(refunds: RefundRecord[]) {
  return refunds.flatMap((refund, index) => {
    const before = refunds.slice(0, index)
    const amount = refundedAmountOf(order, refund, before)
    if (!amount.ok) throw new Error(amount.reason)
    const result = creditNoteFor(order, { ...refund, amountTtc: amount.amountTtc }, before, "ABCD1234")
    if (!result.ok) throw new Error(result.reason)
    return result.draft.lines
  })
}
