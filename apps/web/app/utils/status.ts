// Human labels (FR) and a coarse severity for order/document statuses, shared by
// the admin tables, badges and detail screens. Severity drives the colour of the
// status pill: "ok" (brass/green), "warn" (amber), "bad" (red), "muted" (grey).

export type Severity = "ok" | "warn" | "bad" | "muted"

interface StatusMeta {
  label: string
  severity: Severity
}

const PAYMENT: Record<string, StatusMeta> = {
  pending: { label: "En attente", severity: "warn" },
  awaiting_transfer: { label: "Virement attendu", severity: "warn" },
  transfer_claimed: { label: "Virement déclaré", severity: "warn" },
  received: { label: "Payé", severity: "ok" },
  reconciled: { label: "Rapproché", severity: "ok" },
  partially_refunded: { label: "Remboursé partiel", severity: "warn" },
  refunded: { label: "Remboursé", severity: "muted" },
  failed: { label: "Échoué", severity: "bad" },
  cancelled: { label: "Annulé", severity: "muted" },
}

const LEGAL: Record<string, StatusMeta> = {
  pending: { label: "Docs attendus", severity: "warn" },
  docs_verifying: { label: "Vérification", severity: "warn" },
  docs_verified: { label: "Docs validés", severity: "ok" },
  docs_rejected: { label: "Docs rejetés", severity: "bad" },
  payment_pending: { label: "Attente paiement", severity: "warn" },
  completed: { label: "Terminée", severity: "ok" },
}

const DOC_VERIFICATION: Record<string, StatusMeta> = {
  pending: { label: "À vérifier", severity: "warn" },
  approved: { label: "Approuvé", severity: "ok" },
  rejected: { label: "Rejeté", severity: "bad" },
  expired: { label: "Expiré", severity: "muted" },
}

const REFUND: Record<string, StatusMeta> = {
  pending: { label: "En cours", severity: "warn" },
  succeeded: { label: "Effectué", severity: "ok" },
  failed: { label: "Échoué", severity: "bad" },
  cancelled: { label: "Annulé", severity: "muted" },
}

const FALLBACK = (value: string): StatusMeta => ({ label: value, severity: "muted" })

export function paymentStatus(value: string): StatusMeta {
  return PAYMENT[value] ?? FALLBACK(value)
}
export function legalStatus(value: string): StatusMeta {
  return LEGAL[value] ?? FALLBACK(value)
}
export function docVerificationStatus(value: string): StatusMeta {
  return DOC_VERIFICATION[value] ?? FALLBACK(value)
}
export function refundStatus(value: string): StatusMeta {
  return REFUND[value] ?? FALLBACK(value)
}

// Filter dropdown options (value/label) for the order list screens.
export const PAYMENT_STATUS_OPTIONS = Object.entries(PAYMENT).map(([value, m]) => ({ value, label: m.label }))
export const LEGAL_STATUS_OPTIONS = Object.entries(LEGAL).map(([value, m]) => ({ value, label: m.label }))

const DOC_TYPE_LABELS: Record<string, string> = {
  cni: "CNI",
  permis_chasse: "Permis de chasse",
  autorisation_det: "Autorisation détention",
  sia: "SIA",
  expertise: "Expertise",
}
export function docTypeLabel(value: string): string {
  return DOC_TYPE_LABELS[value] ?? value
}

const REJECTION_LABELS: Record<string, string> = {
  document_expired: "Document expiré",
  document_illegible: "Document illisible",
  wrong_document_type: "Mauvais type de document",
  information_mismatch: "Informations non concordantes",
  document_incomplete: "Document incomplet",
  underage: "Personne mineure",
  suspected_fraud: "Fraude suspectée",
  other: "Autre",
}
export function rejectionLabel(value: string | null): string {
  return value ? (REJECTION_LABELS[value] ?? value) : ""
}

// Options for the rejection dropdown, sourced from the same enum the API validates.
export const REJECTION_REASON_OPTIONS = Object.entries(REJECTION_LABELS).map(([value, label]) => ({ value, label }))
