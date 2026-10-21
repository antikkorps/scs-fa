// Story 12.8b — opening a pro request, whether from the signup form or from a
// customer's account: one organisation, pending, with what the registry said.
import type { OrganisationRequestInput } from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { DbExecutor } from "../artworks/reservation.js"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { organisations, users } from "../db/schema.js"
import { sendOrganisationRequestAlertEmail, sendOrganisationRequestReceivedEmail } from "../email.js"
import type { RegistryLookup } from "./registry.js"

/** The registry's verdict as stored on the organisation, with its answer when it gave one. */
export function registryVerdict(lookup: RegistryLookup) {
  if (lookup.status !== "found") return { registryCheck: lookup.status, registrySnapshot: null }
  return {
    registryCheck: lookup.establishment.active ? ("verified" as const) : ("inactive" as const),
    registrySnapshot: lookup.establishment,
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
