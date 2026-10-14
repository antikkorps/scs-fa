// How the back-office shows Henrri invoices and credit notes (story 12.6).

import type { Severity } from "./status"

interface StatusMeta {
  label: string
  severity: Severity
}

const STATUS: Record<string, StatusMeta> = {
  pending: { label: "En file", severity: "warn" },
  draft: { label: "En cours", severity: "warn" },
  finalized: { label: "Émise", severity: "ok" },
  blocked: { label: "Bloquée", severity: "bad" },
}

export function henrriDocumentStatus(value: string): StatusMeta {
  return STATUS[value] ?? { label: value, severity: "muted" }
}

export function henrriDocumentLabel(document: { kind: string; number: string | null }): string {
  const name = document.kind === "invoice" ? "Facture" : "Avoir"
  return document.number ? `${name} ${document.number}` : name
}

const REASONS: Record<string, string> = {
  LegacySnapshot: "Commande antérieure à la facturation automatique : à facturer à la main dans Henrri.",
  SnapshotMismatch: "Les lignes de la commande ne retombent pas sur son total : à vérifier avant d'émettre.",
  InvoiceBlocked: "La facture de la commande est bloquée : la débloquer d'abord.",
  InexpressibleAmount: "Henrri ne peut pas émettre d'avoir de ce montant exact (arrondi de la TVA).",
  InvalidRefundAmount: "Le montant du remboursement dépasse celui de la commande.",
  MissingBillingAddress: "La commande n'a pas d'adresse de facturation.",
  OrderNotFound: "La commande est introuvable.",
}

const TOTAL_MISMATCH = /^TotalMismatch: Henrri ([\d.]+), expected ([\d.]+)$/

/** Why a document is blocked, or why the last attempt failed, in plain French. */
export function henrriBlockReason(lastError: string | null): string {
  if (!lastError) return ""
  const known = REASONS[lastError]
  if (known) return known
  const mismatch = TOTAL_MISMATCH.exec(lastError)
  if (mismatch) {
    return `Le total calculé par Henrri (${mismatch[1]} €) diffère de celui de la commande (${mismatch[2]} €) : rien n'a été émis.`
  }
  return `Refus de Henrri — ${lastError}`
}

/** Where a customer downloads an issued invoice or credit note (the BFF adds the session). */
export function invoiceDownloadUrl(orderId: string, documentId: string): string {
  return `/bff/api/orders/${encodeURIComponent(orderId)}/invoices/${encodeURIComponent(documentId)}/pdf`
}
