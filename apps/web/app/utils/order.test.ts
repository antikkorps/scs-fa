import { describe, expect, it } from "vitest"
import {
  legalStatusLabel,
  parcelItemLabel,
  paymentStatusLabel,
  shipmentStatusLabel,
  shippingStatusLabel,
  statusTone,
} from "./order.js"

describe("shipping labels (story 11.9)", () => {
  it("translates the order's shipping status and each parcel's", () => {
    expect(shippingStatusLabel("partially_shipped")).toBe("Partiellement expédiée")
    expect(shippingStatusLabel("delivered")).toBe("Livrée")
    expect(shipmentStatusLabel("shipped")).toBe("En route")
    expect(shipmentStatusLabel(undefined)).toBe("—")
  })

  it("names what a parcel holds, part of a split article included", () => {
    expect(parcelItemLabel({ label: "Carabine", qty: 1, part: 1, parts: 2 })).toBe("Carabine (partie 1/2)")
    expect(parcelItemLabel({ label: "Lunette", qty: 2, part: 1, parts: 1 })).toBe("Lunette × 2")
  })

  it("reads a parcel that has left as good news", () => {
    expect(statusTone("shipped")).toBe("positive")
    expect(statusTone("delivered")).toBe("positive")
  })
})

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
