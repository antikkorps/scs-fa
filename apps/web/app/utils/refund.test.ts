import { describe, expect, it } from "vitest"
import {
  REFUND_KIND_OPTIONS,
  refundFailure,
  refundRequestBody,
  returnableQuantities,
  shippingRefunded,
} from "./refund.js"

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

describe("refund kinds (story 12.6, decisions 2026-10-14)", () => {
  const items = [
    { name: "Carabine", qty: 1 },
    { name: "Tapis de tir", qty: 3 },
  ]
  const refunds = [
    { kind: "goods_return" as const, status: "succeeded", lines: [{ item: 1, qty: 2 }], includesShipping: true },
    { kind: "goods_return" as const, status: "failed", lines: [{ item: 0, qty: 1 }], includesShipping: false },
    { kind: "goodwill" as const, status: "succeeded", lines: null, includesShipping: false },
  ]

  it("names the three kinds of refund", () => {
    expect(REFUND_KIND_OPTIONS.map((option) => option.label)).toEqual([
      "Retour d'articles",
      "Geste commercial",
      "Trop-perçu (virement)",
    ])
  })

  it("counts what is left to return per article, ignoring refunds that failed", () => {
    expect(returnableQuantities(items, refunds)).toEqual([1, 1])
  })

  it("knows whether the delivery was already refunded", () => {
    expect(shippingRefunded(refunds)).toBe(true)
    expect(shippingRefunded([])).toBe(false)
  })

  it("asks for a return with only the articles picked", () => {
    expect(
      refundRequestBody({
        kind: "goods_return",
        channel: "carte",
        quantities: [0, 2],
        includesShipping: false,
        amount: null,
        reason: " Colis abîmé ",
      }),
    ).toEqual({
      kind: "goods_return",
      channel: "carte",
      lines: [{ item: 1, qty: 2 }],
      includesShipping: false,
      reason: "Colis abîmé",
    })
  })

  it("asks for a gesture or an overpayment by amount, the overpayment on the transfer", () => {
    const base = { quantities: [], includesShipping: false, reason: "" }
    expect(refundRequestBody({ ...base, kind: "goodwill", channel: "carte", amount: 15 })).toEqual({
      kind: "goodwill",
      channel: "carte",
      amount: 15,
    })
    expect(refundRequestBody({ ...base, kind: "overpayment", channel: "carte", amount: 5 })).toEqual({
      kind: "overpayment",
      channel: "virement",
      amount: 5,
    })
  })

  it("explains the new refusals", () => {
    expect(refundFailure({ data: { error: "ExceedsInvoice" } }).message).toBe(
      "Les avoirs dépasseraient le montant de la facture.",
    )
    expect(refundFailure({ data: { error: "ExceedsOverpayment", message: "Paid in excess: 10.00" } }).message).toBe(
      "Le montant dépasse le trop-perçu restant.",
    )
    expect(refundFailure({ data: { error: "ReturnExceedsOrder" } }).message).toBe(
      "Plus d'articles que la commande n'en compte, ou qu'il n'en reste à retourner.",
    )
  })
})
