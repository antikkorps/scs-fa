import { describe, expect, it } from "vitest"
import { formatEuros } from "./format.js"
import { historyActorLabel, historyErrorLabel, historyEventLabel, type OrderHistoryEvent } from "./history.js"

function event(action: string, values: Partial<OrderHistoryEvent> = {}): OrderHistoryEvent {
  return {
    id: "e1",
    createdAt: "2026-10-18T10:00:00.000Z",
    action,
    entityType: "order",
    entityId: null,
    result: "success",
    error: null,
    reqId: null,
    actor: { kind: "system", name: null },
    oldValue: null,
    newValue: null,
    ...values,
  }
}

describe("historyEventLabel (story 12.7b)", () => {
  it("names the order's own steps with the status labels used everywhere else", () => {
    expect(historyEventLabel(event("order.created"))).toBe("Commande passée")
    expect(historyEventLabel(event("order.payment.received"))).toBe("Paiement : Payé")
    expect(historyEventLabel(event("order.shipping.partially_shipped"))).toBe("Expédition : Expédiée en partie")
    expect(historyEventLabel(event("order.legal.docs_verified"))).toBe("Conformité : Docs validés")
  })

  it("names payments, refunds and parcels", () => {
    expect(historyEventLabel(event("payment.stripe.init"))).toBe("Paiement par carte lancé")
    expect(historyEventLabel(event("payment.stripe.failed"))).toBe("Paiement par carte refusé")
    expect(historyEventLabel(event("payment.virement.reconciled"))).toBe("Virement rapproché")
    expect(historyEventLabel(event("payment.refund.succeeded", { newValue: { amountTtc: "40.00" } }))).toBe(
      `Remboursement effectué — ${formatEuros(40)}`,
    )
    expect(historyEventLabel(event("payment.refund.succeeded"))).toBe("Remboursement effectué")
    expect(historyEventLabel(event("shipment.shipped"))).toBe("Colis expédié")
  })

  it("names Henrri documents with their number once issued", () => {
    expect(historyEventLabel(event("henrri.invoice.issued", { newValue: { number: "26-10-1" } }))).toBe(
      "Facture 26-10-1 émise",
    )
    expect(historyEventLabel(event("henrri.credit_note.issued", { newValue: { number: "26-10-2" } }))).toBe(
      "Avoir 26-10-2 émis",
    )
    expect(historyEventLabel(event("henrri.invoice.blocked"))).toBe("Facture bloquée")
    expect(historyEventLabel(event("henrri.credit_note.held"))).toBe("Avoir émis — à vérifier")
    expect(historyEventLabel(event("henrri.retry"))).toBe("Facturation relancée")
  })

  it("shows an unknown action as it is, rather than hiding it", () => {
    expect(historyEventLabel(event("something.new"))).toBe("something.new")
  })
})

describe("historyErrorLabel", () => {
  it("explains Stripe's codes", () => {
    expect(historyErrorLabel("stripe.insufficient_funds")).toBe("Stripe : fonds insuffisants")
    expect(historyErrorLabel("stripe.amount_short")).toBe("Stripe : montant encaissé inférieur au montant dû")
    expect(historyErrorLabel("stripe.do_not_honor")).toBe("Stripe : do_not_honor")
  })

  it("explains Henrri's codes the way the invoicing panel does", () => {
    expect(historyErrorLabel("henrri.MissingBillingAddress")).toBe("La commande n'a pas d'adresse de facturation.")
    expect(historyErrorLabel("henrri.PaymentMismatch")).toBe(
      "Facture émise, mais les règlements reçus ne couvrent pas la facture : règlement à enregistrer à la main dans Henrri.",
    )
    expect(historyErrorLabel("henrri.NUMBERING_ERROR")).toBe("Refus de Henrri — NUMBERING_ERROR")
  })

  it("is empty without an error, and shows any other code as it is", () => {
    expect(historyErrorLabel(null)).toBe("")
    expect(historyErrorLabel("invalid_error_code")).toBe("invalid_error_code")
  })
})

describe("historyActorLabel", () => {
  it("says who acted, or that nobody clicked", () => {
    expect(historyActorLabel({ kind: "admin", name: "Fred Martin" })).toBe("Fred Martin (admin)")
    expect(historyActorLabel({ kind: "customer", name: "Jean Tireur" })).toBe("Jean Tireur (client)")
    expect(historyActorLabel({ kind: "system", name: null })).toBe("Automatique")
    expect(historyActorLabel({ kind: "customer", name: null })).toBe("client")
  })
})
