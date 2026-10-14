import { describe, expect, it } from "vitest"
import { henrriBlockReason, henrriDocumentLabel, henrriDocumentStatus } from "./henrri.js"

describe("henrriDocumentStatus (story 12.6)", () => {
  it("reads an issued document as done, a blocked one as needing action", () => {
    expect(henrriDocumentStatus("finalized")).toEqual({ label: "Émise", severity: "ok" })
    expect(henrriDocumentStatus("pending")).toEqual({ label: "En file", severity: "warn" })
    expect(henrriDocumentStatus("draft")).toEqual({ label: "En cours", severity: "warn" })
    expect(henrriDocumentStatus("blocked")).toEqual({ label: "Bloquée", severity: "bad" })
  })
})

describe("henrriDocumentLabel", () => {
  it("names the document with its number once Henrri gave it one", () => {
    expect(henrriDocumentLabel({ kind: "invoice", number: "26-10-1" })).toBe("Facture 26-10-1")
    expect(henrriDocumentLabel({ kind: "credit_note", number: null })).toBe("Avoir")
  })
})

describe("henrriBlockReason", () => {
  it.each([
    ["LegacySnapshot", "Commande antérieure à la facturation automatique : à facturer à la main dans Henrri."],
    ["InvoiceBlocked", "La facture de la commande est bloquée : la débloquer d'abord."],
    ["InexpressibleAmount", "Henrri ne peut pas émettre d'avoir de ce montant exact (arrondi de la TVA)."],
    ["MissingBillingAddress", "La commande n'a pas d'adresse de facturation."],
  ])("explains %s", (code, explanation) => {
    expect(henrriBlockReason(code)).toBe(explanation)
  })

  it("explains a total Henrri computed differently, with both amounts", () => {
    expect(henrriBlockReason("TotalMismatch: Henrri 129.01, expected 129.00")).toBe(
      "Le total calculé par Henrri (129.01 €) diffère de celui de la commande (129.00 €) : rien n'a été émis.",
    )
  })

  it("passes Henrri's own refusal through", () => {
    expect(henrriBlockReason("NUMBERING_ERROR: Numbering failed")).toBe(
      "Refus de Henrri — NUMBERING_ERROR: Numbering failed",
    )
  })

  it("says nothing when there is nothing wrong", () => {
    expect(henrriBlockReason(null)).toBe("")
  })
})
