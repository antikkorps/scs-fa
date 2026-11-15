import { formatDate, formatDateTime } from "./format"

// French labels for order statuses shown to the customer (mirror the API enums
// ORDER_PAYMENT_STATUSES / ORDER_LEGAL_STATUSES).

// "En attente" read as if the shop had to act, when it is the customer's turn
// (UX audit 2026-11-01, I2).
const PAYMENT_LABELS: Record<string, string> = {
  pending: "À régler",
  awaiting_transfer: "En attente du virement",
  transfer_claimed: "Virement déclaré",
  received: "Payée",
  reconciled: "Virement rapproché",
  failed: "Échec du paiement",
  cancelled: "Annulée",
  partially_refunded: "Partiellement remboursée",
  refunded: "Remboursée",
}

const LEGAL_LABELS: Record<string, string> = {
  pending: "Documents à fournir",
  docs_verifying: "Documents en vérification",
  docs_verified: "Documents validés",
  docs_rejected: "Documents refusés",
  payment_pending: "En attente de paiement",
  completed: "Conforme",
  none: "Non applicable",
}

// Story 11.9 — the order as a whole, then each parcel.
const SHIPPING_LABELS: Record<string, string> = {
  unshipped: "Pas encore expédiée",
  partially_shipped: "Partiellement expédiée",
  shipped: "Expédiée",
  delivered: "Livrée",
}

const SHIPMENT_LABELS: Record<string, string> = {
  preparing: "En préparation",
  shipped: "En route",
  delivered: "Livré",
}

export function shippingStatusLabel(status: string | null | undefined): string {
  return (status && SHIPPING_LABELS[status]) || "—"
}

export function shipmentStatusLabel(status: string | null | undefined): string {
  return (status && SHIPMENT_LABELS[status]) || "—"
}

/** "Carabine × 2 (partie 1/2)" — what a parcel holds of one order line. */
export function parcelItemLabel(item: { label: string; qty: number; part: number; parts: number }): string {
  const qty = item.qty > 1 ? ` × ${item.qty}` : ""
  const part = item.parts > 1 ? ` (partie ${item.part}/${item.parts})` : ""
  return `${item.label}${qty}${part}`
}

export function paymentStatusLabel(status: string | null | undefined): string {
  return (status && PAYMENT_LABELS[status]) || "—"
}

export function legalStatusLabel(status: string | null | undefined): string {
  return (status && LEGAL_LABELS[status]) || "—"
}

/** Visual tone for a status chip: positive (settled), negative (failed), or neutral. */
export function statusTone(status: string | null | undefined): "positive" | "negative" | "neutral" {
  if (
    status === "received" ||
    status === "reconciled" ||
    status === "completed" ||
    status === "docs_verified" ||
    status === "shipped" ||
    status === "delivered"
  ) {
    return "positive"
  }
  if (status === "failed" || status === "cancelled" || status === "docs_rejected" || status === "refunded") {
    return "negative"
  }
  return "neutral"
}

/** Until when an unpaid order can be paid (story 12.9a); empty once there is no deadline. */
export function paymentDeadlineNote(paymentDueAt: string | null | undefined, paymentTerms?: string): string {
  // Story 12.8d — on invoice: due 30 days after the invoice, issued at dispatch; never cancelled.
  if (paymentTerms === "net30") {
    return paymentDueAt
      ? `Facture à régler par virement avant le ${formatDate(paymentDueAt)}.`
      : "Paiement à 30 jours : la facture vous est envoyée à l'expédition, à régler par virement dans les 30 jours."
  }
  if (!paymentDueAt) return ""
  return `À régler avant le ${formatDateTime(paymentDueAt)}. Passé ce délai, la commande est annulée et les articles remis en vente.`
}

// Delivery: metropolitan France, Corsica included (story 12.3). The API refuses
// anything else; saying so in the page spares the customer a failed order.
export const UNDELIVERABLE_MESSAGE = "Nous livrons uniquement en France métropolitaine, Corse comprise."

// The shop may open before its bank details are set: the API then refuses any
// order that must be paid by transfer (regulated firearms, pro "on invoice").
export const BANK_TRANSFER_UNAVAILABLE_MESSAGE =
  "Le paiement par virement n'est pas encore ouvert : une commande à régler par virement ne peut pas être passée pour le moment. Contactez-nous pour en savoir plus."

const PLACE_ORDER_MESSAGES: Record<string, string> = {
  TermsOutdated:
    "Nos conditions générales de vente ont changé depuis l'ouverture de cette page. Rechargez la page pour lire la nouvelle version.",
  UndeliverableAddress: UNDELIVERABLE_MESSAGE,
  BankTransferUnavailable: BANK_TRANSFER_UNAVAILABLE_MESSAGE,
}

/**
 * Story 12.13c (Franck and Fred, 2026-11-15): the API asks the customer to
 * certify they are of age before articles reserved to adults; null for any
 * other refusal.
 */
export function ageRequirementMessage(code: string | null | undefined, requiredAge = 18): string | null {
  if (code !== "AdultDeclarationRequired") return null
  return `Votre panier contient des articles réservés aux personnes de ${requiredAge} ans et plus : cochez la déclaration ci-dessous pour confirmer la commande.`
}

/** Why the checkout could not place the order, from the API's status and error code. */
export function placeOrderErrorMessage(status: number | null | undefined, code: string | null | undefined): string {
  const known = code ? PLACE_ORDER_MESSAGES[code] : undefined
  if (known) return known
  if (status === 400) return "Votre panier est vide ou invalide."
  return "Impossible de créer la commande."
}

/** One address of the book on one line: "Jeanne Armand — 3 quai du Stand, 69002 Lyon". */
export function addressLine(a: {
  firstName: string
  lastName: string
  line1: string
  line2: string | null
  postal: string
  city: string
}): string {
  return `${a.firstName} ${a.lastName} — ${a.line1}${a.line2 ? `, ${a.line2}` : ""}, ${a.postal} ${a.city}`
}
