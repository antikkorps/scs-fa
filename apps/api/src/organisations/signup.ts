// Story 12.8b — a pro sign-up: a new account and its organisation, together or not at all.
import { CURRENT_RGPD_CONSENT_VERSION, type ProSignupInput } from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { FastifyRequest } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"
import type { RegistryLookup } from "./registry.js"
import { openOrganisation } from "./service.js"

export interface ProAccountSecrets {
  /** Normalised (trimmed, lower-cased). */
  email: string
  passwordHash: string
}

/** Throws a unique violation when the address is taken, `SiretHeldError` when the SIRET is. */
export async function createProAccount(
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
