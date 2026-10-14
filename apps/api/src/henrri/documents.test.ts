import { computeVatTotals } from "@armurier/shared"
import { describe, expect, it } from "vitest"
import { buildCreditNoteDraft, buildInvoiceDraft, type InvoiceSource, nearestExpressibleRefunds } from "./documents.js"

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
const PORT = { reference: "PORT", description: "Frais de port" }
const REFUND = { reference: "REMBOURSEMENT", description: "Remboursement" }
const rifleParcel = { amountTtc: 25, priceHt: 20.83, vatAmount: 4.17, vatPct: 20 }
const smallParcel = { amountTtc: 9, priceHt: 7.5, vatAmount: 1.5, vatPct: 20 }

function order(overrides: Partial<InvoiceSource> = {}): InvoiceSource {
  // Rifle 1200 + mat (100 − 15) × 1.2 = 102 + shipping 34.
  return { itemsJson: [rifle, mat], shippingPortions: [rifleParcel, smallParcel], totalTtc: 1336, ...overrides }
}

describe("buildInvoiceDraft", () => {
  it("bills each line at its frozen HT price and VAT rate", () => {
    const result = buildInvoiceDraft(order())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.lines.slice(0, 2)).toEqual([
      {
        designation: "Carabine",
        article: { reference: "CAR-1", description: "Carabine" },
        quantity: 1,
        unitPrice: 1000,
        vatPct: 20,
      },
      {
        designation: "Tapis de tir",
        article: { reference: "TAP-1", description: "Tapis de tir" },
        quantity: 2,
        unitPrice: 50,
        vatPct: 20,
      },
    ])
  })

  it("shows the VIP discount as its own line, right under the line it reduces", () => {
    const result = buildInvoiceDraft(order())
    if (!result.ok) throw new Error(result.reason)
    expect(result.draft.lines[2]).toEqual({
      designation: "Remise VIP — Tapis de tir",
      article: { reference: "REMISE-VIP", description: "Remise VIP" },
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
      { designation: "Frais de port", article: PORT, quantity: 1, unitPrice: 20.83, vatPct: 20 },
      { designation: "Frais de port", article: PORT, quantity: 1, unitPrice: 8.53, vatPct: 5.5 },
    ])
  })

  it("merges the delivery shares that share a VAT rate", () => {
    const result = buildInvoiceDraft(order())
    if (!result.ok) throw new Error(result.reason)
    expect(result.draft.lines.at(-1)).toEqual({
      designation: "Frais de port",
      article: PORT,
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

  it("checks the total the way Henrri computes it: VAT by rate, not line by line", () => {
    const pastille = (sku: string) => ({ ...mat, sku, qty: 1, priceHt: 0.33, discountHt: 0 })
    const cheap = order({ itemsJson: [pastille("P-1"), pastille("P-2"), pastille("P-3")], shippingPortions: [] })
    // 0.99 HT at 20 % → 0.20 VAT: 1.19, where three lines of 0.40 would make 1.20.
    expect(buildInvoiceDraft({ ...cheap, totalTtc: 1.19 }).ok).toBe(true)
    expect(buildInvoiceDraft({ ...cheap, totalTtc: 1.2 })).toEqual({ ok: false, reason: "SnapshotMismatch" })
  })

  it("refuses a snapshot whose lines do not add up to the order total", () => {
    expect(buildInvoiceDraft(order({ totalTtc: 1336.01 }))).toEqual({ ok: false, reason: "SnapshotMismatch" })
  })
})

/** What Henrri totals for these lines: HT and VAT rounded apart, line by line here. */
function henrriTtcCents(lines: Array<{ unitPrice: number; quantity: number; vatPct: number }>) {
  return lines.reduce(
    (sum, line) =>
      sum +
      Math.round(computeVatTotals([{ priceHt: line.unitPrice * line.quantity, vatPct: line.vatPct }]).totalTtc * 100),
    0,
  )
}

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
    // Henrri's tax-included mode does not work through the API (sandbox,
    // 2026-10-14): each share is entered at the HT whose VAT-inclusive total, as
    // Henrri rounds it, is the share.
    // TTC 100 × 1200 / 1242.20 = 96.60 → 80.50 HT ; 100 × 42.20 / 1242.20 = 3.40 → 3.22 HT
    expect(result.draft.lines).toEqual([
      {
        designation: "Remboursement partiel de la commande ABCD1234",
        article: REFUND,
        quantity: 1,
        unitPrice: 80.5,
        vatPct: 20,
      },
      {
        designation: "Remboursement partiel de la commande ABCD1234",
        article: REFUND,
        quantity: 1,
        unitPrice: 3.22,
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
    expect(henrriTtcCents(result.draft.lines)).toBe(1000)
  })

  it("keeps a single line when the order has a single VAT rate", () => {
    const result = buildCreditNoteDraft(order(), 50, "ABCD1234")
    if (!result.ok) throw new Error(result.reason)
    expect(result.draft.lines).toEqual([
      {
        designation: "Remboursement partiel de la commande ABCD1234",
        article: REFUND,
        quantity: 1,
        unitPrice: 41.67,
        vatPct: 20,
      },
    ])
  })

  it("moves a cent between rates when a share has no HT Henrri can land on", () => {
    // Shared naively, 1.02 gives 0.99 at 20 % — no HT reaches it (0.82 → 0.98,
    // 0.83 → 1.00) — and 0.03 at 5.5 %. 0.98 + 0.04 both exist.
    const withBook = order({ itemsJson: [rifle, book], shippingPortions: [], totalTtc: 1242.2 })
    const result = buildCreditNoteDraft(withBook, 1.02, "ABCD1234")
    if (!result.ok) throw new Error(result.reason)
    expect(henrriTtcCents(result.draft.lines)).toBe(102)
    expect(result.draft.expectedTotalTtc).toBe(1.02)
  })

  it("refuses an amount Henrri cannot express at all", () => {
    // Single rate: 27.77 HT → 33.32, 27.78 HT → 33.34.
    expect(buildCreditNoteDraft(order(), 33.33, "ABCD1234")).toEqual({ ok: false, reason: "InexpressibleAmount" })
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

describe("nearestExpressibleRefunds", () => {
  it("offers the closest amounts Henrri can express, below and above", () => {
    expect(nearestExpressibleRefunds(order(), 33.33)).toEqual({ below: 33.32, above: 33.34 })
  })

  it("never goes above the order total", () => {
    expect(nearestExpressibleRefunds(order(), 1336)).toEqual({ below: 1335.98, above: null })
  })
})
