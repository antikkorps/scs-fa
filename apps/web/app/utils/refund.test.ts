import { describe, expect, it } from "vitest"
import { refundFailure } from "./refund.js"

describe("refundFailure", () => {
  it("offers the closest amounts Henrri can issue a credit note for (story 12.6)", () => {
    const failure = refundFailure({
      data: {
        error: "InexpressibleRefundAmount",
        message: "No credit note can add up to 33.33 €",
        suggestions: { below: 33.32, above: 33.34 },
      },
    })
    expect(failure.suggestions).toEqual([33.32, 33.34])
    expect(failure.message).toBe(
      "La facturation ne peut pas émettre d'avoir de ce montant exact (arrondi de la TVA). Choisissez un montant proche :",
    )
  })

  it("keeps only the sides that have an amount", () => {
    const failure = refundFailure({
      data: { error: "InexpressibleRefundAmount", suggestions: { below: 1335.98, above: null } },
    })
    expect(failure.suggestions).toEqual([1335.98])
  })

  it("passes any other refusal through, without suggestions", () => {
    expect(
      refundFailure({ data: { error: "AmountExceedsRefundable", message: "Refundable amount is 40.00" } }),
    ).toEqual({ message: "Refundable amount is 40.00", suggestions: [] })
  })

  it("falls back to a generic message", () => {
    expect(refundFailure(new Error("network"))).toEqual({ message: "Le remboursement a échoué.", suggestions: [] })
  })
})
