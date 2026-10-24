import type { OrganisationStatus, OrganisationType, QuoteRequestStatus } from "@armurier/shared"
import type { Severity } from "~/utils/status"

// Story 12.8b — French labels for pro accounts, shared by the signup form, the
// customer's account and the back-office.

interface StatusMeta {
  label: string
  severity: Severity
}

const TYPE_LABELS: Record<OrganisationType, string> = {
  armurier: "Armurier",
  club: "Club de tir",
  securite_privee: "Sécurité privée",
  administration: "Administration",
}

const STATUSES: Record<OrganisationStatus, StatusMeta> = {
  pending: { label: "En attente", severity: "warn" },
  approved: { label: "Validé", severity: "ok" },
  rejected: { label: "Refusé", severity: "muted" },
  suspended: { label: "Suspendu", severity: "bad" },
}

/**
 * A new request for a SIRET that a validated pro account already holds (story
 * 12.9g: requests under review may share one; SCS validates a single one).
 */
export const SIRET_TAKEN_MESSAGE = "Ce SIRET appartient déjà à un compte professionnel validé."

export type RegistryCheck = "verified" | "inactive" | "not_found" | "unavailable"

const REGISTRY_CHECKS: Record<RegistryCheck, StatusMeta> = {
  verified: { label: "Établissement actif", severity: "ok" },
  inactive: { label: "Établissement fermé", severity: "bad" },
  not_found: { label: "SIRET inconnu du registre", severity: "bad" },
  unavailable: { label: "Registre injoignable, non vérifié", severity: "warn" },
}

export const ORGANISATION_TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({
  value: value as OrganisationType,
  label,
}))

export function organisationTypeLabel(type: OrganisationType): string {
  return TYPE_LABELS[type]
}

export function organisationStatus(status: OrganisationStatus): StatusMeta {
  return STATUSES[status]
}

export function registryCheckLabel(check: RegistryCheck): StatusMeta {
  return REGISTRY_CHECKS[check]
}

// Story 12.8c — quote requests.

const QUOTE_REQUEST_STATUS: Record<QuoteRequestStatus, StatusMeta> = {
  requested: { label: "Envoyée", severity: "warn" },
  in_review: { label: "En cours d'étude", severity: "warn" },
  sent: { label: "Devis envoyé", severity: "ok" },
  accepted: { label: "Acceptée", severity: "ok" },
  declined: { label: "Déclinée", severity: "muted" },
  expired: { label: "Expirée", severity: "muted" },
  converted: { label: "Commandée", severity: "ok" },
  cancelled: { label: "Annulée", severity: "muted" },
}

export function quoteRequestStatus(status: QuoteRequestStatus): StatusMeta {
  return QUOTE_REQUEST_STATUS[status]
}
