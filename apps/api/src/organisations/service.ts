// Story 12.8b — opening a pro request, whether from the signup form or from a
// customer's account: one organisation, pending, with what the registry said.
import type { OrganisationRequestInput } from "@armurier/shared"
import { and, eq, inArray } from "drizzle-orm"
import type { DbExecutor } from "../artworks/reservation.js"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { organisations, users } from "../db/schema.js"
import { sendOrganisationRequestAlertEmail, sendOrganisationRequestReceivedEmail } from "../email.js"
import type { RegistryLookup } from "./registry.js"

/** The organisation's billing columns (story 12.8d). */
export const BILLING_ADDRESS_COLUMNS = {
  billingLine1: organisations.billingLine1,
  billingLine2: organisations.billingLine2,
  billingPostal: organisations.billingPostal,
  billingCity: organisations.billingCity,
  billingCountry: organisations.billingCountry,
} as const

type BillingColumns = { [K in keyof typeof BILLING_ADDRESS_COLUMNS]: (typeof organisations.$inferSelect)[K] }

/** The billing columns as one address, every field null-able until SCS has filled it in. */
export function billingAddressOf(row: BillingColumns) {
  return {
    line1: row.billingLine1,
    line2: row.billingLine2,
    postal: row.billingPostal,
    city: row.billingCity,
    country: row.billingCountry,
  }
}

/** The address, or null while a field Henrri needs is still missing. */
export function completeBillingAddress(row: BillingColumns) {
  const address = billingAddressOf(row)
  const { line1, postal, city } = address
  if (!line1 || !postal || !city) return null
  return { ...address, line1, postal, city }
}

/** Replaces the billing columns of a row by its `billingAddress`. */
export function withBillingAddress<T extends BillingColumns>(row: T) {
  const { billingLine1, billingLine2, billingPostal, billingCity, billingCountry, ...rest } = row
  return { ...rest, billingAddress: billingAddressOf(row) }
}

/** The registry's verdict as stored on the organisation, with its answer when it gave one. */
export function registryVerdict(lookup: RegistryLookup) {
  if (lookup.status !== "found") return { registryCheck: lookup.status, registrySnapshot: null }
  const { billingAddress } = lookup.establishment
  return {
    registryCheck: lookup.establishment.active ? ("verified" as const) : ("inactive" as const),
    registrySnapshot: lookup.establishment,
    // Story 12.8d — a starting point SCS corrects on the organisation's page.
    ...(billingAddress && {
      billingLine1: billingAddress.line1,
      billingPostal: billingAddress.postal,
      billingCity: billingAddress.city,
    }),
  }
}

/**
 * Story 12.9g — only a validated organisation (approved, or suspended) holds
 * its SIRET: requests under review may share one, so a first claimant cannot
 * lock the real company out. The unique index enforces it on approval.
 */
export const SIRET_HELD_INDEX = "uq_organisations_siret_validated"
const SIRET_HOLDING_STATUSES = ["approved", "suspended"] as const

/** A new request for a SIRET a validated organisation already holds. */
export class SiretHeldError extends Error {
  constructor() {
    super("This SIRET already belongs to a validated organisation")
  }
}

/** What a member sees of their organisation: never the registry snapshot nor who reviewed it. */
export const MEMBER_ORGANISATION_COLUMNS = {
  id: organisations.id,
  legalName: organisations.legalName,
  siret: organisations.siret,
  type: organisations.type,
  status: organisations.status,
  reviewReason: organisations.reviewReason,
  createdAt: organisations.createdAt,
} as const

export interface RequestContext {
  userId: string
  ipAddress: string
  userAgent: string | null
}

/** Insert the pending organisation and journal it; the caller attaches it to the account in the same transaction. */
export async function openOrganisation(
  tx: DbExecutor,
  input: OrganisationRequestInput,
  lookup: RegistryLookup,
  context: RequestContext,
) {
  const [holder] = await tx
    .select({ id: organisations.id })
    .from(organisations)
    .where(and(eq(organisations.siret, input.siret), inArray(organisations.status, SIRET_HOLDING_STATUSES)))
    .limit(1)
  if (holder) throw new SiretHeldError()

  const verdict = registryVerdict(lookup)
  const [organisation] = await tx
    .insert(organisations)
    .values({ legalName: input.legalName, siret: input.siret, type: input.organisationType, ...verdict })
    .returning(MEMBER_ORGANISATION_COLUMNS)
  if (!organisation) throw new Error("organisation insert returned no row")

  await recordAuditEvent(
    {
      userId: context.userId,
      userRole: "customer",
      entityType: "organisation",
      entityId: organisation.id,
      action: "organisation.requested",
      newValue: { siret: input.siret, type: input.organisationType, registryCheck: verdict.registryCheck },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    },
    tx,
  )
  return { organisation, registryVerified: verdict.registryCheck === "verified" }
}

/** Best-effort once the request is committed: the applicant's receipt and SCS's alert. */
export async function announceOrganisationRequest(
  applicant: { id: string; email: string },
  request: { legalName: string; siret: string; type: OrganisationRequestInput["organisationType"] },
  registryVerified: boolean,
  log: { error: (details: object, message: string) => void },
): Promise<void> {
  const admins = await db.select({ email: users.email }).from(users).where(eq(users.role, "admin"))
  await Promise.all([
    sendOrganisationRequestReceivedEmail(
      applicant.email,
      { legalName: request.legalName },
      { userId: applicant.id },
    ).catch((err) => log.error({ err, userId: applicant.id }, "organisation request receipt failed")),
    sendOrganisationRequestAlertEmail(
      admins.map((admin) => admin.email),
      { ...request, registryVerified },
    ).catch((err) => log.error({ err, userId: applicant.id }, "organisation request alert failed")),
  ])
}
