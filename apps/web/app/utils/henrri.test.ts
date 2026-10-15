import { describe, expect, it } from "vitest"
import { henrriBlockReason, henrriDocumentLabel, henrriDocumentStatus, invoiceDownloadUrl } from "./henrri.js"

describe("henrriDocumentStatus (story 12.6)", () => {
  it("reads an issued document held for an admin as needing action", () => {
    expect(henrriDocumentStatus("finalized", true)).toEqual({ label: "Émise — à vérifier", severity: "warn" })
  })

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

  it.each([
    "Http503: Unavailable",
    "Timeout: Henrri took over 30000 ms",
    "NetworkError: Henrri unreachable",
    "Http429: Too many requests",
    "QUOTA_EXCEEDED: You have exceeded your monthly Quota",
    "AuthenticationFailed: Henrri refused the API credentials",
    "NumberPending: Henrri finalized the document without its number",
  ])("reads %s as a passing incident the queue retries on its own", (lastError) => {
    expect(henrriBlockReason(lastError)).toMatch(/^Henrri .* nouvel essai automatique/)
  })

  it("explains the monthly quota and credentials, which need someone to act", () => {
    expect(henrriBlockReason("QUOTA_EXCEEDED: You have exceeded your monthly Quota")).toBe(
      "Henrri : crédits du mois épuisés (changer de pack ou attendre le mois prochain) — nouvel essai automatique.",
    )
    expect(henrriBlockReason("AuthenticationFailed: Henrri refused the API credentials")).toBe(
      "Henrri refuse les identifiants de l'API (clé à vérifier) — nouvel essai automatique.",
    )
  })

  it("explains a payment Henrri could not settle", () => {
    expect(henrriBlockReason("PaymentMismatch: received 1324.00, invoiced 1329.00")).toBe(
      "Facture émise, mais les règlements reçus (1324.00 €) ne couvrent pas la facture (1329.00 €) : règlement à enregistrer à la main dans Henrri.",
    )
  })

  it("keeps an internal error vague, its detail being in the server log", () => {
    expect(henrriBlockReason("InternalError")).toBe("Erreur interne : voir les journaux du serveur.")
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

describe("invoiceDownloadUrl", () => {
  it("goes through the same-origin proxy, which carries the session cookie", () => {
    expect(invoiceDownloadUrl("o-1", "d-2")).toBe("/bff/api/orders/o-1/invoices/d-2/pdf")
  })
})
