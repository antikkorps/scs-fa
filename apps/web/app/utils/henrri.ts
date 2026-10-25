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

/** `held`: issued, but its payment needs a human (it stays issued). */
export function henrriDocumentStatus(value: string, held = false): StatusMeta {
  if (value === "finalized" && held) return { label: "Émise — à vérifier", severity: "warn" }
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
  UnpricedLine: "Une ligne du devis n'a pas de prix.",
  QuoteRequestNotFound: "La demande de devis est introuvable.",
  InternalError: "Erreur interne : voir les journaux du serveur.",
}

const AUTOMATIC_RETRY = " — nouvel essai automatique."

/** Incidents the queue retries on its own (stored as "CODE: message"). */
const PASSING: Record<string, string> = {
  QUOTA_EXCEEDED: "Henrri : crédits du mois épuisés (changer de pack ou attendre le mois prochain)",
  AuthenticationFailed: "Henrri refuse les identifiants de l'API (clé à vérifier)",
  Timeout: "Henrri ne répond pas assez vite",
  NetworkError: "Henrri injoignable",
  NumberPending: "Henrri n'a pas encore communiqué le numéro",
  Http429: "Henrri limite le nombre d'appels",
}

const TOTAL_MISMATCH = /^TotalMismatch: Henrri ([\d.]+), expected ([\d.]+)$/
const PAYMENT_MISMATCH = /^PaymentMismatch: received ([\d.]+), invoiced ([\d.]+)$/
const SERVER_ERROR = /^Http5\d\d$/

/** Why a document is blocked, or why the last attempt failed, in plain French. */
export function henrriBlockReason(lastError: string | null): string {
  if (!lastError) return ""
  const known = REASONS[lastError]
  if (known) return known
  const mismatch = TOTAL_MISMATCH.exec(lastError)
  if (mismatch) {
    return `Le total calculé par Henrri (${mismatch[1]} €) diffère de celui de la commande (${mismatch[2]} €) : rien n'a été émis.`
  }
  const payment = PAYMENT_MISMATCH.exec(lastError)
  if (payment) {
    return `Facture émise, mais les règlements reçus (${payment[1]} €) ne couvrent pas la facture (${payment[2]} €) : règlement à enregistrer à la main dans Henrri.`
  }
  const code = lastError.split(":")[0] ?? ""
  const passing = PASSING[code] ?? (SERVER_ERROR.test(code) ? "Henrri est momentanément indisponible" : null)
  if (passing) return `${passing}${AUTOMATIC_RETRY}`
  return `Refus de Henrri — ${lastError}`
}

/** Where a customer downloads an issued invoice or credit note (the BFF adds the session). */
export function invoiceDownloadUrl(orderId: string, documentId: string): string {
  return `/bff/api/orders/${encodeURIComponent(orderId)}/invoices/${encodeURIComponent(documentId)}/pdf`
}

/** Where a pro downloads their issued quote (story 12.8d; the BFF adds the session). */
export function quoteDownloadUrl(quoteRequestId: string): string {
  return `/bff/api/pro/quote-requests/${encodeURIComponent(quoteRequestId)}/quote.pdf`
}
