import { organisationRequestSchema, proSignupSchema, siretSchema, suggestedOrganisationType } from "@armurier/shared"
import { and, eq, isNull, sql } from "drizzle-orm"
import type { FastifyPluginAsync, FastifyRequest } from "fastify"
import { z } from "zod"
import { authenticate } from "../auth/authenticate.js"
import { hashPassword } from "../auth/password.js"
import { requireRole } from "../auth/require-role.js"
import { accountByEmail, CHECK_INBOX, warnIfTaken, warnTakenAddress } from "../auth/signup-address.js"
import { CAPPED_SESSION_DAYS } from "../auth/tokens.js"
import { db } from "../db/client.js"
import { isUniqueViolation } from "../db/errors.js"
import { organisations, refreshTokens, users } from "../db/schema.js"
import { validationError } from "../http.js"
import { requireShopOpen } from "../shop-settings/require-shop-open.js"
import { lookUpEstablishment } from "./registry.js"
import {
  announceOrganisationRequest,
  assertSiretFree,
  MEMBER_ORGANISATION_COLUMNS,
  openOrganisation,
  SiretHeldError,
} from "./service.js"
import { createProAccount } from "./signup.js"

const SIRET_TAKEN = {
  error: "SiretAlreadyRegistered",
  message: "This SIRET already belongs to a validated pro account",
}
const ALREADY_MEMBER = { error: "AlreadyInOrganisation", message: "This account already belongs to an organisation" }
const NO_ORGANISATION = { error: "NotFound", message: "This account belongs to no organisation" }

const PRO_SIGNUP = { pro: true } as const

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

  /**
   * POST /signup — answers the same whether the address is free or not (no
   * enumeration, see `auth/signup-address.ts`); a held SIRET is still told, the
   * registry being public.
   */
  fastify.post(
    "/signup",
    { preHandler: requireShopOpen, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = proSignupSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
      const email = parsed.data.email.trim().toLowerCase()

      const lookup = await lookUpEstablishment(parsed.data.siret)
      // Hashed even for a taken address: the answer must cost the same either way.
      const passwordHash = await hashPassword(parsed.data.password)
      const owner = await accountByEmail(email)
      try {
        if (owner) {
          await assertSiretFree(db, parsed.data.siret)
          warnTakenAddress(owner, email, request, PRO_SIGNUP)
          return reply.code(202).send(CHECK_INBOX)
        }
        const { user, organisation, registryVerified } = await createProAccount(
          parsed.data,
          { email, passwordHash },
          lookup,
          request,
        )
        announceOrganisationRequest(user, organisation, registryVerified, request.log).catch((err) => {
          request.log.error({ err }, "pro signup: announcing the request failed")
        })
        return reply.code(202).send(CHECK_INBOX)
      } catch (err) {
        if (err instanceof SiretHeldError) return reply.code(409).send(SIRET_TAKEN)
        if (isUniqueViolation(err, "users_email_unique") && (await warnIfTaken(email, request, PRO_SIGNUP))) {
          return reply.code(202).send(CHECK_INBOX)
        }
        throw err
      }
    },
  )

  /**
   * POST /request — a registered customer turns pro. Their history stays; the
   * sessions already open get the pro cap, so the next login asks for the code.
   */
  fastify.post(
    "/request",
    {
      preHandler: [authenticate, requireRole("customer"), requireShopOpen],
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const parsed = organisationRequestSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
      const userId = request.user.sub

      const [account] = await db
        .select({
          id: users.id,
          email: users.email,
          organisationId: users.organisationId,
          status: organisations.status,
        })
        .from(users)
        .leftJoin(organisations, eq(organisations.id, users.organisationId))
        .where(eq(users.id, userId))
      if (!account) return reply.code(401).send({ error: "Unauthorized", message: "Unknown account" })
      // A refused request may be replaced by a new one, as its e-mail offers.
      if (account.organisationId && account.status !== "rejected") return reply.code(409).send(ALREADY_MEMBER)

      const lookup = await lookUpEstablishment(parsed.data.siret)
      try {
        const { organisation, registryVerified } = await db.transaction(async (tx) => {
          const opened = await openOrganisation(tx, parsed.data, lookup, requestContext(request, userId))
          // Guarded on the organisation read above: two requests racing for the same account cannot both attach.
          const stillUnchanged = account.organisationId
            ? eq(users.organisationId, account.organisationId)
            : isNull(users.organisationId)
          const attached = await tx
            .update(users)
            .set({ organisationId: opened.organisation.id, updatedAt: new Date() })
            .where(and(eq(users.id, userId), stillUnchanged))
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
        if (err instanceof SiretHeldError) return reply.code(409).send(SIRET_TAKEN)
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
