import { describe, expect, it } from "vitest"
import { buildInvoiceDraft, type InvoiceSource } from "./documents.js"

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

describe("against the real Henrri (sandbox, 2026-10-14)", () => {
  // Totals Henrri itself computed for these orders: our check must agree with
  // them, not merely with our own VAT function (audit 2026-10-14).
  const line = (sku: string, qty: number, priceHt: number, vatPct: number, discountHt = 0) => ({
    variantId: sku,
    qty,
    priceHt,
    name: sku,
    sku,
    category: "accessoire-tireur",
    requiresPaymentVirement: false,
    vatPct,
    discountHt,
  })

  it("agrees with invoice 26-10-5: three 0.33 lines, a VIP discount and two parcels → 1 337.18", () => {
    const sandboxOrder = {
      itemsJson: [
        line("CAR", 1, 1000, 20),
        line("PAS-1", 1, 0.33, 20),
        line("PAS-2", 1, 0.33, 20),
        line("PAS-3", 1, 0.33, 20),
        line("TAP", 2, 50, 20, 15),
      ],
      shippingPortions: [
        { amountTtc: 25, priceHt: 20.83, vatAmount: 4.17, vatPct: 20 },
        { amountTtc: 9, priceHt: 7.5, vatAmount: 1.5, vatPct: 20 },
      ],
      totalTtc: 1337.18,
    }
    expect(buildInvoiceDraft(sandboxOrder).ok).toBe(true)
  })

  it("agrees with invoice 26-10-2: two rates, rounded by rate → 120.62", () => {
    const sandboxOrder = {
      itemsJson: [
        line("PAS-1", 1, 0.33, 20),
        line("PAS-2", 1, 0.33, 20),
        line("PAS-3", 1, 0.33, 20),
        line("LIV", 1, 7.99, 5.5),
        line("TAP", 2, 50, 20, 15),
      ],
      shippingPortions: [{ amountTtc: 9, priceHt: 7.5, vatAmount: 1.5, vatPct: 20 }],
      totalTtc: 120.62,
    }
    expect(buildInvoiceDraft(sandboxOrder).ok).toBe(true)
    expect(buildInvoiceDraft({ ...sandboxOrder, totalTtc: 120.63 })).toEqual({ ok: false, reason: "SnapshotMismatch" })
  })
})
