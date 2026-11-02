// French labels and helpers for the customer legal-document workflow in the
// account area. Doc-type and rejection-reason labels are reused from
// `~/utils/status` (single source of truth) — here we only add the customer
// checklist statuses (ORDER_REQUIRED_DOC_STATUS) and small UI helpers.

import { type AnyLegalDocType, LEGAL_DOC_HELP, LEGAL_DOC_LABELS, MAX_LEGAL_DOC_SIZE_BYTES } from "@armurier/shared"
import { apiErrorCode, authErrorStatus } from "./formErrors"
import { docTypeLabel } from "./status"

/** A document's name, in full, as the customer reads it. */
export function legalDocLabel(code: string): string {
  return isLegalDocCode(code) ? LEGAL_DOC_LABELS[code] : docTypeLabel(code)
}

/** What the document is or what to send, when its name is not enough; null otherwise. */
export function legalDocHelp(code: string): string | null {
  return (isLegalDocCode(code) && LEGAL_DOC_HELP[code]) || null
}

const isLegalDocCode = (code: string): code is AnyLegalDocType => Object.hasOwn(LEGAL_DOC_LABELS, code)

const REQUIRED_DOC_STATUS_LABELS: Record<string, string> = {
  missing: "À fournir",
  pending_scan: "Analyse antivirus en cours",
  infected: "Fichier rejeté (sécurité)",
  pending_review: "En cours de vérification",
  approved: "Validé",
  rejected: "Refusé — à renvoyer",
}

export function requiredDocStatusLabel(status: string | null | undefined): string {
  return (status ? REQUIRED_DOC_STATUS_LABELS[status] : undefined) ?? "—"
}

/** Visual tone for a required-doc status chip. */
export function requiredDocTone(status: string | null | undefined): "positive" | "negative" | "neutral" {
  if (status === "approved") return "positive"
  if (status === "rejected" || status === "infected") return "negative"
  return "neutral"
}

/** Whether a required doc still needs an upload from the customer. */
export function needsUpload(status: string | null | undefined): boolean {
  return status === "missing" || status === "rejected" || status === "infected"
}

const MEGABYTES = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 })

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${MEGABYTES.format(bytes / (1024 * 1024))} Mo`
}

// Maps the API's upload refusal to French copy for the customer.
export function legalDocUploadMessage(err: unknown): string {
  const status = authErrorStatus(err)
  const code = apiErrorCode(err)
  if (status === 413) return `Fichier trop volumineux (max ${formatFileSize(MAX_LEGAL_DOC_SIZE_BYTES)}).`
  if (code === "UnsupportedMediaType") return "Format de fichier non accepté ou contenu non conforme."
  if (code === "DocumentExpired") return "Ce document est déjà expiré. Envoyez une pièce en cours de validité."
  if (status === 400) return "Document invalide. Vérifiez le fichier et les informations saisies."
  return "L'envoi a échoué. Veuillez réessayer."
}
