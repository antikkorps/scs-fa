import { describe, expect, it } from "vitest"
import { legalStatusLabel, paymentStatusLabel, statusTone } from "./order.js"

describe("paymentStatusLabel", () => {
  it("translates payment statuses to French", () => {
    expect(paymentStatusLabel("received")).toBe("Payée")
    expect(paymentStatusLabel("pending")).toBe("En attente")
    expect(paymentStatusLabel("refunded")).toBe("Remboursée")
  })
  it("falls back to an em dash for unknown/empty", () => {
    expect(paymentStatusLabel("weird")).toBe("—")
    expect(paymentStatusLabel(null)).toBe("—")
  })
})

describe("legalStatusLabel", () => {
  it("translates legal statuses to French", () => {
    expect(legalStatusLabel("payment_pending")).toBe("En attente de paiement")
    expect(legalStatusLabel("docs_verified")).toBe("Documents validés")
    expect(legalStatusLabel("completed")).toBe("Conforme")
  })
})

describe("statusTone", () => {
  it("classifies settled / failed / neutral", () => {
    expect(statusTone("received")).toBe("positive")
    expect(statusTone("docs_verified")).toBe("positive")
    expect(statusTone("failed")).toBe("negative")
    expect(statusTone("docs_rejected")).toBe("negative")
    expect(statusTone("pending")).toBe("neutral")
  })
})
