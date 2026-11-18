// Story 12.8b — a pro sign-up: a new account and its organisation, together or not at all.
import { CURRENT_RGPD_CONSENT_VERSION, type ProSignupInput } from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { FastifyRequest } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { accountByEmail, warnIfTaken, warnTakenAddress } from "../auth/signup-address.js"
import { db } from "../db/client.js"
import { isUniqueViolation } from "../db/errors.js"
import { users } from "../db/schema.js"
import type { RegistryLookup } from "./registry.js"
import { announceOrganisationRequest, assertSiretFree, openOrganisation } from "./service.js"

const PRO_SIGNUP = { pro: true } as const

export interface ProAccountSecrets {
  /** Normalised (trimmed, lower-cased). */
  email: string
  passwordHash: string
}

/**
 * Opens the account and its request, or warns the owner of a taken address.
 * Throws `SiretHeldError` either way — the registry is public — or an
 * unexpected error, which the route must answer like a success.
 */
export async function signUpPro(
  input: ProSignupInput,
  secrets: ProAccountSecrets,
  lookup: RegistryLookup,
  request: FastifyRequest,
): Promise<void> {
  const owner = await accountByEmail(secrets.email)
  if (owner) {
    await assertSiretFree(db, input.siret)
    return warnTakenAddress(owner, secrets.email, request, PRO_SIGNUP)
  }
  try {
    const { user, organisation, registryVerified } = await createProAccount(input, secrets, lookup, request)
    announceOrganisationRequest(user, organisation, registryVerified, request.log).catch((err) => {
      request.log.error({ err }, "pro signup: announcing the request failed")
    })
  } catch (err) {
    // Lost the race to a concurrent sign-up with the same address.
    if (isUniqueViolation(err, "users_email_unique") && (await warnIfTaken(secrets.email, request, PRO_SIGNUP))) return
    throw err
  }
}

/** Throws a unique violation when the address is taken, `SiretHeldError` when the SIRET is. */
async function createProAccount(
  input: ProSignupInput,
  secrets: ProAccountSecrets,
  lookup: RegistryLookup,
  request: FastifyRequest,
) {
  const { email: _email, password: _password, firstName, lastName, phone, ...organisationInput } = input
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({
        ...secrets,
        firstname: firstName,
        lastname: lastName,
        phone: phone ?? null,
        role: "customer",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id, email: users.email })
    if (!created) throw new Error("user insert returned no row")

    const context = { userId: created.id, ipAddress: request.ip, userAgent: request.headers["user-agent"] ?? null }
    const opened = await openOrganisation(tx, organisationInput, lookup, context)
    await tx.update(users).set({ organisationId: opened.organisation.id }).where(eq(users.id, created.id))
    await recordAuditEvent(
      { ...context, userRole: "customer", entityType: "user", entityId: created.id, action: "user.registered" },
      tx,
    )
    return { user: created, ...opened }
  })
}
