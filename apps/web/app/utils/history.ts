// How the back-office tells an order's story (story 12.7b): one line per event,
// in plain French, with who acted and, on a failure, why.

import { formatEuros } from "./format"
import { henrriBlockReason } from "./henrri"
import { legalStatus, paymentStatus, shippingStatus } from "./status"

export type HistoryActorKind = "admin" | "customer" | "vendor" | "system"

export interface OrderHistoryEvent {
  id: string
  createdAt: string
  action: string
  entityType: string
  entityId: string | null
  result: "success" | "failure"
  error: string | null
  reqId: string | null
  actor: { kind: HistoryActorKind; name: string | null }
  oldValue: unknown
  newValue: unknown
}

const LABELS: Record<string, string> = {
  "order.created": "Commande passée",
  "payment.stripe.init": "Paiement par carte lancé",
  "payment.stripe.received": "Paiement par carte reçu",
  "payment.stripe.failed": "Paiement par carte refusé",
  "payment.stripe.cancelled": "Paiement par carte abandonné",
  "payment.stripe.amount_mismatch": "Paiement par carte : montant insuffisant",
  "payment.virement.claimed": "Virement déclaré par le client",
  "payment.virement.reconciled": "Virement rapproché",
  "payment.refund.pending": "Remboursement demandé",
  "payment.refund.succeeded": "Remboursement effectué",
  "payment.refund.failed": "Remboursement échoué",
  "payment.refund.cancelled": "Remboursement annulé",
  "shipment.created": "Colis préparé",
  "shipment.preparing": "Colis remis en préparation",
  "shipment.shipped": "Colis expédié",
  "shipment.delivered": "Colis livré",
  "shipment.updated": "Colis modifié",
  "shipment.deleted": "Colis supprimé",
  "henrri.retry": "Facturation relancée",
}

/** The order's own statuses, named as on its badges. */
const ORDER_STATUSES: Record<string, { prefix: string; label: (status: string) => string }> = {
  payment: { prefix: "Paiement", label: (status) => paymentStatus(status).label },
  shipping: { prefix: "Expédition", label: (status) => shippingStatus(status).label },
  legal: { prefix: "Conformité", label: (status) => legalStatus(status).label },
}

const HENRRI_STEPS: Record<string, { invoice: string; credit_note: string }> = {
  issued: { invoice: "émise", credit_note: "émis" },
  blocked: { invoice: "bloquée", credit_note: "bloqué" },
  held: { invoice: "émise — à vérifier", credit_note: "émis — à vérifier" },
}

function fieldOf(values: unknown, key: string): unknown {
  return values && typeof values === "object" ? (values as Record<string, unknown>)[key] : undefined
}

function henrriLabel(kind: string, step: string, number: unknown): string | null {
  const words = HENRRI_STEPS[step]
  if (!words || (kind !== "invoice" && kind !== "credit_note")) return null
  const name = kind === "invoice" ? "Facture" : "Avoir"
  const numbered = typeof number === "string" && number ? `${name} ${number}` : name
  return `${numbered} ${words[kind]}`
}

export function historyEventLabel(event: OrderHistoryEvent): string {
  const [scope = "", kind = "", step = ""] = event.action.split(".")
  if (scope === "order" && ORDER_STATUSES[kind] && step) {
    const status = ORDER_STATUSES[kind]
    return `${status.prefix} : ${status.label(step)}`
  }
  if (scope === "henrri") {
    const henrri = henrriLabel(kind, step, fieldOf(event.newValue, "number"))
    if (henrri) return henrri
  }
  const label = LABELS[event.action]
  if (!label) return event.action
  const amount = fieldOf(event.newValue, "amountTtc")
  return event.action.startsWith("payment.refund.") && amount != null
    ? `${label} — ${formatEuros(Number(amount))}`
    : label
}

const STRIPE_ERRORS: Record<string, string> = {
  card_declined: "carte refusée",
  insufficient_funds: "fonds insuffisants",
  expired_card: "carte expirée",
  incorrect_cvc: "cryptogramme incorrect",
  payment_failed: "paiement refusé",
  canceled: "paiement abandonné",
  amount_short: "montant encaissé inférieur au montant dû",
  refund_failed: "remboursement refusé",
  refund_cancelled: "remboursement annulé",
}

/** Henrri codes whose full explanation needs figures the history does not keep. */
const HENRRI_CODES_ONLY: Record<string, string> = {
  PaymentMismatch:
    "Facture émise, mais les règlements reçus ne couvrent pas la facture : règlement à enregistrer à la main dans Henrri.",
  TotalMismatch: "Le total calculé par Henrri diffère de celui de la commande : rien n'a été émis.",
  PaymentNotRecorded: "Facture émise, mais son règlement n'a pas pu être enregistré dans Henrri.",
}

/** Why an event failed, in plain French; the raw code when it is not one we know. */
export function historyErrorLabel(error: string | null): string {
  if (!error) return ""
  const [source, ...rest] = error.split(".")
  const code = rest.join(".")
  if (source === "stripe" && code) return `Stripe : ${STRIPE_ERRORS[code] ?? code}`
  if (source === "henrri" && code) return HENRRI_CODES_ONLY[code] ?? henrriBlockReason(code)
  return error
}

const ACTOR_KINDS: Record<HistoryActorKind, string> = {
  admin: "admin",
  customer: "client",
  vendor: "vendeur",
  system: "",
}

export function historyActorLabel(actor: OrderHistoryEvent["actor"]): string {
  if (actor.kind === "system") return "Automatique"
  const kind = ACTOR_KINDS[actor.kind]
  return actor.name ? `${actor.name} (${kind})` : kind
}
