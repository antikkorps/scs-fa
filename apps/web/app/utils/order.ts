// French labels for order statuses shown to the customer (mirror the API enums
// ORDER_PAYMENT_STATUSES / ORDER_LEGAL_STATUSES).

const PAYMENT_LABELS: Record<string, string> = {
  pending: "En attente",
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
  pending: "En attente",
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
