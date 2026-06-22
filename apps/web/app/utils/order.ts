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

export function paymentStatusLabel(status: string | null | undefined): string {
  return (status && PAYMENT_LABELS[status]) || "—"
}

export function legalStatusLabel(status: string | null | undefined): string {
  return (status && LEGAL_LABELS[status]) || "—"
}

/** Visual tone for a status chip: positive (settled), negative (failed), or neutral. */
export function statusTone(status: string | null | undefined): "positive" | "negative" | "neutral" {
  if (status === "received" || status === "reconciled" || status === "completed" || status === "docs_verified") {
    return "positive"
  }
  if (status === "failed" || status === "cancelled" || status === "docs_rejected" || status === "refunded") {
    return "negative"
  }
  return "neutral"
}
