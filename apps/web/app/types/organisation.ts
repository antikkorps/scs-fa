import type { OrganisationStatus, OrganisationType } from "@armurier/shared"
import type { RegistryCheck } from "~/utils/organisation"
import type { BillingAddress } from "./quote"

// Story 12.8b — pro accounts, as the API returns them.

/** GET /organisations/lookup — what the registry says, to pre-fill the form. */
export type SiretLookup =
  | { status: "found"; legalName: string; suggestedType: OrganisationType | null; active: boolean }
  | { status: "not_found" | "unavailable" }

/** What a member sees of their organisation (GET /organisations/mine). */
export interface MemberOrganisation {
  id: string
  legalName: string
  siret: string
  type: OrganisationType
  status: OrganisationStatus
  reviewReason: string | null
  createdAt: string
}

export interface OrganisationMember {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
}

/** A row of the back-office list. */
export interface AdminOrganisationRow {
  id: string
  legalName: string
  siret: string
  type: OrganisationType
  status: OrganisationStatus
  registryCheck: RegistryCheck
  createdAt: string
  member: OrganisationMember | null
}

export interface RegistrySnapshot {
  legalName: string
  legalNature: string | null
  activityCode: string | null
  address: string | null
  active: boolean
}

export interface AdminOrganisationDetail extends AdminOrganisationRow {
  registrySnapshot: RegistrySnapshot | null
  registryCheckedAt: string
  reviewedAt: string | null
  reviewReason: string | null
  discountPct: number
  net30Allowed: boolean
  showPrices: boolean
  updatedAt: string
  /** Where quotes and invoices are made out to (story 12.8d); prefilled from the registry. */
  billingAddress: BillingAddress
  /** Other organisations claiming the same SIRET (story 12.9g), oldest first. */
  sameSiret: SameSiretOrganisation[]
}

export interface SameSiretOrganisation {
  id: string
  legalName: string
  status: OrganisationStatus
  createdAt: string
}
