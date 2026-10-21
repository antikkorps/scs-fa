import type { OrganisationStatus, OrganisationType } from "@armurier/shared"
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
