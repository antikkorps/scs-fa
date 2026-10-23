// French labels and helpers for the customer legal-document workflow in the
// account area. Doc-type and rejection-reason labels are reused from
// `~/utils/status` (single source of truth) — here we only add the customer
// checklist statuses (ORDER_REQUIRED_DOC_STATUS) and small UI helpers.

import { MAX_LEGAL_DOC_SIZE_BYTES } from "@armurier/shared"
import { apiErrorCode, authErrorStatus } from "./formErrors"

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

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
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
