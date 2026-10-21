import {
  CURRENT_RGPD_CONSENT_VERSION,
  organisationRequestSchema,
  proSignupSchema,
  siretSchema,
  suggestedOrganisationType,
} from "@armurier/shared"
import { and, eq, isNull, sql } from "drizzle-orm"
import type { FastifyPluginAsync, FastifyRequest } from "fastify"
import { z } from "zod"
import { recordAuditEvent } from "../audit/record.js"
import { authenticate } from "../auth/authenticate.js"
import { hashPassword } from "../auth/password.js"
import { requireRole } from "../auth/require-role.js"
import { CAPPED_SESSION_DAYS } from "../auth/tokens.js"
import { db } from "../db/client.js"
import { isUniqueViolation } from "../db/errors.js"
import { organisations, refreshTokens, users } from "../db/schema.js"
import { validationError } from "../http.js"
import { lookUpEstablishment } from "./registry.js"
import { announceOrganisationRequest, MEMBER_ORGANISATION_COLUMNS, openOrganisation } from "./service.js"

const EMAIL_TAKEN = { error: "EmailAlreadyRegistered", message: "An account with this email already exists" }
const SIRET_TAKEN = {
  error: "SiretAlreadyRegistered",
  message: "This SIRET already belongs to a pro account, or a request for it is under review",
}
const ALREADY_MEMBER = { error: "AlreadyInOrganisation", message: "This account already belongs to an organisation" }
const NO_ORGANISATION = { error: "NotFound", message: "This account belongs to no organisation" }

const lookupQuerySchema = z.object({ siret: siretSchema })

const requestContext = (request: FastifyRequest, userId: string) => ({
  userId,
  ipAddress: request.ip,
  userAgent: request.headers["user-agent"] ?? null,
})

/**
 * Pro accounts (story 12.8b): a gunsmith, a club, a security firm or an
 * administration files a request, checked against the State's registry and
 * approved by hand in the back-office (`./admin.ts`).
 */
export const organisationRoutes: FastifyPluginAsync = async (fastify) => {
  /** GET /lookup — pre-fills the signup form; public, so its rate limit is tight. */
  fastify.get("/lookup", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = lookupQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const lookup = await lookUpEstablishment(parsed.data.siret)
    if (lookup.status !== "found") return reply.send({ data: { status: lookup.status } })
    const { legalName, legalNature, active } = lookup.establishment
    return reply.send({
      data: { status: "found", legalName, suggestedType: suggestedOrganisationType(legalNature), active },
    })
  })

  /** POST /signup — a new account and its organisation, together or not at all. */
  fastify.post("/signup", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = proSignupSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const { email, password, firstName, lastName, phone, ...organisationInput } = parsed.data

    const lookup = await lookUpEstablishment(organisationInput.siret)
    const passwordHash = await hashPassword(password)

    try {
      const { user, organisation, registryVerified } = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(users)
          .values({
            email: email.trim().toLowerCase(),
            passwordHash,
            firstname: firstName,
            lastname: lastName,
            phone: phone ?? null,
            role: "customer",
            rgpdConsentAt: new Date(),
            rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
          })
          .returning({ id: users.id, email: users.email, firstName: users.firstname, lastName: users.lastname })
        if (!created) throw new Error("user insert returned no row")

        const opened = await openOrganisation(tx, organisationInput, lookup, requestContext(request, created.id))
        await tx.update(users).set({ organisationId: opened.organisation.id }).where(eq(users.id, created.id))
        await recordAuditEvent(
          {
            userId: created.id,
            userRole: "customer",
            entityType: "user",
            entityId: created.id,
            action: "user.registered",
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"] ?? null,
          },
          tx,
        )
        return { user: created, ...opened }
      })

      await announceOrganisationRequest(user, organisation, registryVerified, request.log)
      return reply.code(201).send({ data: { ...user, organisation } })
    } catch (err) {
      if (isUniqueViolation(err, "users_email_unique")) return reply.code(409).send(EMAIL_TAKEN)
      if (isUniqueViolation(err, "uq_organisations_siret_open")) return reply.code(409).send(SIRET_TAKEN)
      throw err
    }
  })

  /**
   * POST /request — a registered customer turns pro. Their history stays; the
   * sessions already open get the pro cap, so the next login asks for the code.
   */
  fastify.post(
    "/request",
    {
      preHandler: [authenticate, requireRole("customer")],
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const parsed = organisationRequestSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
      const userId = request.user.sub

      const [account] = await db
        .select({ id: users.id, email: users.email, organisationId: users.organisationId })
        .from(users)
        .where(eq(users.id, userId))
      if (!account) return reply.code(401).send({ error: "Unauthorized", message: "Unknown account" })
      if (account.organisationId) return reply.code(409).send(ALREADY_MEMBER)

      const lookup = await lookUpEstablishment(parsed.data.siret)
      try {
        const { organisation, registryVerified } = await db.transaction(async (tx) => {
          const opened = await openOrganisation(tx, parsed.data, lookup, requestContext(request, userId))
          // The IS NULL guard settles two requests racing for the same account.
          const attached = await tx
            .update(users)
            .set({ organisationId: opened.organisation.id, updatedAt: new Date() })
            .where(and(eq(users.id, userId), isNull(users.organisationId)))
            .returning({ id: users.id })
          if (attached.length === 0) throw new AlreadyMemberError()

          const cap = sql`now() + make_interval(days => ${CAPPED_SESSION_DAYS})`
          await tx
            .update(refreshTokens)
            .set({
              sessionExpiresAt: sql`least(coalesce(${refreshTokens.sessionExpiresAt}, ${cap}), ${cap})`,
              expiresAt: sql`least(${refreshTokens.expiresAt}, ${cap})`,
            })
            .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
          return opened
        })

        await announceOrganisationRequest(account, organisation, registryVerified, request.log)
        return reply.code(201).send({ data: organisation })
      } catch (err) {
        if (err instanceof AlreadyMemberError) return reply.code(409).send(ALREADY_MEMBER)
        if (isUniqueViolation(err, "uq_organisations_siret_open")) return reply.code(409).send(SIRET_TAKEN)
        throw err
      }
    },
  )

  /** GET /mine — the member's organisation and, once refused or suspended, why. */
  fastify.get("/mine", { preHandler: authenticate }, async (request, reply) => {
    const [row] = await db
      .select(MEMBER_ORGANISATION_COLUMNS)
      .from(users)
      .innerJoin(organisations, eq(organisations.id, users.organisationId))
      .where(eq(users.id, request.user.sub))
    if (!row) return reply.code(404).send(NO_ORGANISATION)
    return reply.send({ data: row })
  })
}

class AlreadyMemberError extends Error {}
