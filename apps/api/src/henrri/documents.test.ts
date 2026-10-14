import { describe, expect, it } from "vitest"
import { buildCreditNoteDraft, buildInvoiceDraft, type InvoiceSource } from "./documents.js"

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
const mat = {
  variantId: "v-mat",
  qty: 2,
  priceHt: 50,
  name: "Tapis de tir",
  sku: "TAP-1",
  category: "accessoire-tireur",
  requiresPaymentVirement: false,
  vatPct: 20,
  discountHt: 15,
}
const book = {
  variantId: "v-book",
  qty: 1,
  priceHt: 40,
  name: "Manuel de rechargement",
  sku: "LIV-1",
  category: "accessoire-autre",
  requiresPaymentVirement: false,
  vatPct: 5.5,
  discountHt: 0,
}
const rifleParcel = { amountTtc: 25, priceHt: 20.83, vatAmount: 4.17, vatPct: 20 }
const smallParcel = { amountTtc: 9, priceHt: 7.5, vatAmount: 1.5, vatPct: 20 }

function order(overrides: Partial<InvoiceSource> = {}): InvoiceSource {
  // Rifle 1200 + mat (100 − 15) × 1.2 = 102 + shipping 34.
  return { itemsJson: [rifle, mat], shippingPortions: [rifleParcel, smallParcel], totalTtc: 1336, ...overrides }
}

describe("buildInvoiceDraft", () => {
  it("bills each line at its frozen HT price and VAT rate, in HT mode", () => {
    const result = buildInvoiceDraft(order())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.taxIncluded).toBe(false)
    expect(result.draft.lines.slice(0, 2)).toEqual([
      { designation: "Carabine", reference: "CAR-1", quantity: 1, unitPrice: 1000, vatPct: 20 },
      { designation: "Tapis de tir", reference: "TAP-1", quantity: 2, unitPrice: 50, vatPct: 20 },
    ])
  })

  it("shows the VIP discount as its own line, right under the line it reduces", () => {
    const result = buildInvoiceDraft(order())
    if (!result.ok) throw new Error(result.reason)
    expect(result.draft.lines[2]).toEqual({
      designation: "Remise VIP — Tapis de tir",
      reference: null,
      quantity: 1,
      unitPrice: -15,
      vatPct: 20,
    })
  })

  it("bills the delivery as one line per VAT rate", () => {
    const withBook = order({
      itemsJson: [rifle, book],
      shippingPortions: [rifleParcel, { amountTtc: 9, priceHt: 8.53, vatAmount: 0.47, vatPct: 5.5 }],
      // 1200 + 42.20 + 25 + 9
      totalTtc: 1276.2,
    })
    const result = buildInvoiceDraft(withBook)
    if (!result.ok) throw new Error(result.reason)
    expect(result.draft.lines.filter((line) => line.designation === "Frais de port")).toEqual([
      { designation: "Frais de port", reference: null, quantity: 1, unitPrice: 20.83, vatPct: 20 },
      { designation: "Frais de port", reference: null, quantity: 1, unitPrice: 8.53, vatPct: 5.5 },
    ])
  })

  it("merges the delivery shares that share a VAT rate", () => {
    const result = buildInvoiceDraft(order())
    if (!result.ok) throw new Error(result.reason)
    expect(result.draft.lines.at(-1)).toEqual({
      designation: "Frais de port",
      reference: null,
      quantity: 1,
      unitPrice: 28.33,
      vatPct: 20,
    })
  })

  it("adds no delivery line when the delivery was free", () => {
    const result = buildInvoiceDraft(order({ shippingPortions: [], totalTtc: 1302 }))
    if (!result.ok) throw new Error(result.reason)
    expect(result.draft.lines.some((line) => line.designation === "Frais de port")).toBe(false)
  })

  it("expects the order's own TTC total", () => {
    const result = buildInvoiceDraft(order())
    if (!result.ok) throw new Error(result.reason)
    expect(result.draft.expectedTotalTtc).toBe(1336)
  })

  it("refuses an order placed before the snapshot carried VAT rates", () => {
    const { vatPct: _vatPct, discountHt: _discountHt, ...legacyLine } = rifle
    expect(buildInvoiceDraft(order({ itemsJson: [legacyLine] }))).toEqual({
      ok: false,
      reason: "LegacySnapshot",
    })
  })

  it("refuses an order whose delivery split was not frozen", () => {
    expect(buildInvoiceDraft(order({ shippingPortions: null }))).toEqual({ ok: false, reason: "LegacySnapshot" })
  })

  it("refuses a snapshot whose lines do not add up to the order total", () => {
    expect(buildInvoiceDraft(order({ totalTtc: 1336.01 }))).toEqual({ ok: false, reason: "SnapshotMismatch" })
  })
})

describe("buildCreditNoteDraft", () => {
  it("mirrors the invoice when the whole order is refunded", () => {
    const invoice = buildInvoiceDraft(order())
    const creditNote = buildCreditNoteDraft(order(), 1336, "ABCD1234")
    expect(creditNote).toEqual(invoice)
  })

  it("splits a partial refund between VAT rates in proportion to what each rate weighed", () => {
    const withBook = order({
      itemsJson: [rifle, book],
      shippingPortions: [],
      // 1200 at 20 % + 42.20 at 5.5 %
      totalTtc: 1242.2,
    })
    const result = buildCreditNoteDraft(withBook, 100, "ABCD1234")
    if (!result.ok) throw new Error(result.reason)
    expect(result.draft.taxIncluded).toBe(true)
    // 100 × 1200 / 1242.20 = 96.60 ; 100 × 42.20 / 1242.20 = 3.40
    expect(result.draft.lines).toEqual([
      {
        designation: "Remboursement partiel de la commande ABCD1234",
        reference: null,
        quantity: 1,
        unitPrice: 96.6,
        vatPct: 20,
      },
      {
        designation: "Remboursement partiel de la commande ABCD1234",
        reference: null,
        quantity: 1,
        unitPrice: 3.4,
        vatPct: 5.5,
      },
    ])
    expect(result.draft.expectedTotalTtc).toBe(100)
  })

  it("never loses or invents a cent when splitting", () => {
    const thirds = order({
      itemsJson: [
        { ...rifle, priceHt: 10, discountHt: 0 },
        { ...book, priceHt: 10, discountHt: 0 },
      ],
      shippingPortions: [{ amountTtc: 10.55, priceHt: 10, vatAmount: 0.55, vatPct: 5.5 }],
      totalTtc: 33.1,
    })
    const result = buildCreditNoteDraft(thirds, 10, "ABCD1234")
    if (!result.ok) throw new Error(result.reason)
    const refundedCents = result.draft.lines.reduce((sum, line) => sum + Math.round(line.unitPrice * 100), 0)
    expect(refundedCents).toBe(1000)
  })

  it("keeps a single line when the order has a single VAT rate", () => {
    const result = buildCreditNoteDraft(order(), 50, "ABCD1234")
    if (!result.ok) throw new Error(result.reason)
    expect(result.draft.lines).toEqual([
      {
        designation: "Remboursement partiel de la commande ABCD1234",
        reference: null,
        quantity: 1,
        unitPrice: 50,
        vatPct: 20,
      },
    ])
  })

  it.each([0, -5, 1336.01])("refuses a refund of %s", (amount) => {
    expect(buildCreditNoteDraft(order(), amount, "ABCD1234")).toEqual({ ok: false, reason: "InvalidRefundAmount" })
  })

  it("refuses a refund on an order that could not be invoiced", () => {
    expect(buildCreditNoteDraft(order({ shippingPortions: null }), 50, "ABCD1234")).toEqual({
      ok: false,
      reason: "LegacySnapshot",
    })
  })
})
