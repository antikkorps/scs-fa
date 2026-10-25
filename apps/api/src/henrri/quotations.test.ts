import { describe, expect, it } from "vitest"
import { buildQuotationDraft, type QuotationSource } from "./quotations.js"

const rifle = {
  productName: "Carabine Tikka T3x",
  productSku: "TIK-T3X",
  variantLabel: "Calibre .308",
  qty: 3,
  quotedPriceHt: 1084.5,
  vatPct: 20,
}
const sling = {
  productName: "Bretelle",
  productSku: "BRE-1",
  variantLabel: null,
  qty: 1,
  quotedPriceHt: 10.01,
  vatPct: 20,
}
const parcel = { amountTtc: 25, priceHt: 20.83, vatAmount: 4.17, vatPct: 20, requiresPaymentVirement: true }

const source = (overrides: Partial<QuotationSource> = {}): QuotationSource => ({
  lines: [rifle, sling],
  shippingPortions: [parcel],
  totalTtc: 3941.21,
  ...overrides,
})

describe("buildQuotationDraft (story 12.8d)", () => {
  it("bills each line at its quoted price, on the product's article, then the delivery", () => {
    const result = buildQuotationDraft(source())

    expect(result).toEqual({
      ok: true,
      draft: {
        expectedTotalTtc: 3941.21,
        lines: [
          {
            designation: "Carabine Tikka T3x — Calibre .308",
            article: { reference: "TIK-T3X", description: "Carabine Tikka T3x" },
            quantity: 3,
            unitPrice: 1084.5,
            vatPct: 20,
          },
          {
            designation: "Bretelle",
            article: { reference: "BRE-1", description: "Bretelle" },
            quantity: 1,
            unitPrice: 10.01,
            vatPct: 20,
          },
          {
            designation: "Frais de port",
            article: { reference: "PORT", description: "Frais de port" },
            quantity: 1,
            unitPrice: 20.83,
            vatPct: 20,
          },
        ],
      },
    })
  })

  it("leaves the delivery out when it is free", () => {
    const result = buildQuotationDraft(source({ shippingPortions: [], totalTtc: 3916.21 }))
    expect(result.ok && result.draft.lines.map((line) => line.article.reference)).toEqual(["TIK-T3X", "BRE-1"])
  })

  it("refuses a line SCS has not priced, and a total the lines do not add up to", () => {
    expect(buildQuotationDraft(source({ lines: [{ ...rifle, quotedPriceHt: null }] }))).toEqual({
      ok: false,
      reason: "UnpricedLine",
    })
    expect(buildQuotationDraft(source({ totalTtc: 3941.2 }))).toEqual({ ok: false, reason: "SnapshotMismatch" })
  })
})
