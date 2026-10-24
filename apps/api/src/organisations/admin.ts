import {
  adminOrganisationListQuerySchema,
  approveOrganisationSchema,
  type OrganisationStatus,
  organisationReviewReasonSchema,
  updateOrganisationTermsSchema,
  uuidParamSchema,
} from "@armurier/shared"
import { and, asc, count, desc, eq, ne, type SQL, sql } from "drizzle-orm"
import type { PgUpdateSetSource } from "drizzle-orm/pg-core"
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { isUniqueViolation } from "../db/errors.js"
import { organisations, users } from "../db/schema.js"
import {
  sendOrganisationApprovedEmail,
  sendOrganisationReinstatedEmail,
  sendOrganisationRejectedEmail,
  sendOrganisationSuspendedEmail,
} from "../email.js"
import { validationError } from "../http.js"
import { SIRET_HELD_INDEX } from "./service.js"

const NOT_FOUND = { error: "NotFound", message: "Organisation not found" }

const MEMBER_COLUMNS = {
  id: users.id,
  email: users.email,
  firstName: users.firstname,
  lastName: users.lastname,
} as const

const LIST_COLUMNS = {
  id: organisations.id,
  legalName: organisations.legalName,
  siret: organisations.siret,
  type: organisations.type,
  status: organisations.status,
  registryCheck: organisations.registryCheck,
  createdAt: organisations.createdAt,
} as const

const SIRET_HELD = {
  error: "SiretAlreadyApproved",
  message: "Another organisation with this SIRET is already validated",
}
const SIRET_CONFLICT: unique symbol = Symbol("siret conflict")

const DETAIL_COLUMNS = {
  ...LIST_COLUMNS,
  registrySnapshot: organisations.registrySnapshot,
  registryCheckedAt: organisations.registryCheckedAt,
  reviewedAt: organisations.reviewedAt,
  reviewReason: organisations.reviewReason,
  discountPct: organisations.discountPct,
  net30Allowed: organisations.net30Allowed,
  showPrices: organisations.showPrices,
  updatedAt: organisations.updatedAt,
} as const

type Member = { id: string; email: string }
type Reviewed = { legalName: string; reviewReason: string | null }

/** Each review moves one status to another, and tells the member. */
const REVIEWS = {
  approve: {
    action: "organisation.approved",
    from: "pending",
    to: "approved",
    notify: (member: Member, organisation: Reviewed) =>
      sendOrganisationApprovedEmail(member.email, { legalName: organisation.legalName }, { userId: member.id }),
  },
  reject: {
    action: "organisation.rejected",
    from: "pending",
    to: "rejected",
    notify: (member: Member, organisation: Reviewed) =>
      sendOrganisationRejectedEmail(
        member.email,
        { legalName: organisation.legalName, reason: organisation.reviewReason ?? "" },
        { userId: member.id },
      ),
  },
  suspend: {
    action: "organisation.suspended",
    from: "approved",
    to: "suspended",
    notify: (member: Member, organisation: Reviewed) =>
      sendOrganisationSuspendedEmail(
        member.email,
        { legalName: organisation.legalName, reason: organisation.reviewReason ?? "" },
        { userId: member.id },
      ),
  },
  reinstate: {
    action: "organisation.reinstated",
    from: "suspended",
    to: "approved",
    notify: (member: Member, organisation: Reviewed) =>
      sendOrganisationReinstatedEmail(member.email, { legalName: organisation.legalName }, { userId: member.id }),
  },
} as const satisfies Record<
  string,
  {
    action: string
    from: OrganisationStatus
    to: OrganisationStatus
    notify: (member: Member, organisation: Reviewed) => Promise<void>
  }
>

type Review = keyof typeof REVIEWS

function termsOf(row: { discountPct: string; net30Allowed: boolean; showPrices: boolean }) {
  return { discountPct: Number(row.discountPct), net30Allowed: row.net30Allowed, showPrices: row.showPrices }
}

/** The numeric column comes back as a string; the API speaks numbers. */
function withNumericDiscount<T extends { discountPct: string }>(row: T) {
  return { ...row, discountPct: Number(row.discountPct) }
}

async function memberOf(organisationId: string): Promise<Member | undefined> {
  const [member] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.organisationId, organisationId))
  return member
}

/**
 * Pro accounts in the back-office (story 12.8b): SCS approves, refuses,
 * suspends or reinstates by hand, and sets each organisation's terms.
 */
export const adminOrganisationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  /** GET / — requests and accounts, newest first, filtered by status. */
  fastify.get("/", async (request, reply) => {
    const parsed = adminOrganisationListQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const { page, limit, status } = parsed.data
    const where: SQL | undefined = status ? eq(organisations.status, status) : undefined

    const [rows, [totals]] = await Promise.all([
      db
        .select({ ...LIST_COLUMNS, member: MEMBER_COLUMNS })
        .from(organisations)
        .leftJoin(users, eq(users.organisationId, organisations.id))
        .where(where)
        .orderBy(desc(organisations.createdAt), desc(organisations.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ total: count() }).from(organisations).where(where),
    ])
    const total = totals?.total ?? 0
    return reply.send({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page * limit < total },
    })
  })

  /** GET /:id — one organisation, with the registry's answer at signup and its terms. */
  fastify.get("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    const [row] = await db
      .select({ ...DETAIL_COLUMNS, member: MEMBER_COLUMNS })
      .from(organisations)
      .leftJoin(users, eq(users.organisationId, organisations.id))
      .where(eq(organisations.id, params.data.id))
    if (!row) return reply.code(404).send(NOT_FOUND)

    // Story 12.9g — requests may share a SIRET until SCS validates one: show the others.
    const sameSiret = await db
      .select({
        id: organisations.id,
        legalName: organisations.legalName,
        status: organisations.status,
        createdAt: organisations.createdAt,
      })
      .from(organisations)
      .where(and(eq(organisations.siret, row.siret), ne(organisations.id, row.id)))
      .orderBy(asc(organisations.createdAt))
    return reply.send({ data: { ...withNumericDiscount(row), sameSiret } })
  })

  /**
   * Move an organisation from the status a review expects to the next one, in
   * one guarded update: two admins clicking at once cannot both succeed.
   */
  async function review(
    request: FastifyRequest,
    reply: FastifyReply,
    kind: Review,
    changes: PgUpdateSetSource<typeof organisations> = {},
  ) {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const { action, from, to, notify } = REVIEWS[kind]
    const adminId = request.user.sub

    const updated = await db
      .transaction(async (tx) => {
        const [row] = await tx
          .update(organisations)
          .set({
            reviewReason: null,
            ...changes,
            status: to,
            reviewedBy: adminId,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(organisations.id, params.data.id), eq(organisations.status, from)))
          .returning(DETAIL_COLUMNS)
        if (!row) return null
        await recordAuditEvent(
          {
            userId: adminId,
            userRole: "admin",
            entityType: "organisation",
            entityId: row.id,
            action,
            oldValue: { status: from },
            newValue: kind === "approve" ? { status: to, ...termsOf(row) } : { status: to },
            reason: row.reviewReason,
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"] ?? null,
          },
          tx,
        )
        return row
      })
      .catch((err): typeof SIRET_CONFLICT => {
        // Story 12.9g — another organisation with this SIRET is validated already.
        if (isUniqueViolation(err, SIRET_HELD_INDEX)) return SIRET_CONFLICT
        throw err
      })
    if (updated === SIRET_CONFLICT) return reply.code(409).send(SIRET_HELD)

    if (!updated) {
      const [current] = await db
        .select({ status: organisations.status })
        .from(organisations)
        .where(eq(organisations.id, params.data.id))
      if (!current) return reply.code(404).send(NOT_FOUND)
      return reply.code(409).send({
        error: "InvalidStatusTransition",
        message: `Cannot ${kind} an organisation whose status is ${current.status}`,
      })
    }

    // Best-effort: the decision is committed whatever the mail does.
    const member = await memberOf(updated.id)
    if (member) {
      notify(member, updated).catch((err) =>
        request.log.error({ err, organisationId: updated.id }, `organisation ${kind} e-mail failed`),
      )
    }
    return reply.send({ data: withNumericDiscount(updated) })
  }

  /** POST /:id/approve — terms may be set at once; administrations get the 30-day payment by default. */
  fastify.post("/:id/approve", async (request, reply) => {
    const parsed = approveOrganisationSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const { discountPct, net30Allowed, showPrices } = parsed.data
    return review(request, reply, "approve", {
      net30Allowed: net30Allowed ?? sql`${organisations.type} = 'administration'`,
      ...(showPrices === undefined ? {} : { showPrices }),
      ...(discountPct === undefined ? {} : { discountPct: String(discountPct) }),
    })
  })

  fastify.post("/:id/reject", async (request, reply) => {
    const parsed = organisationReviewReasonSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    return review(request, reply, "reject", { reviewReason: parsed.data.reason })
  })

  fastify.post("/:id/suspend", async (request, reply) => {
    const parsed = organisationReviewReasonSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    return review(request, reply, "suspend", { reviewReason: parsed.data.reason })
  })

  fastify.post("/:id/reinstate", async (request, reply) => review(request, reply, "reinstate"))

  /** PATCH /:id — the commercial terms only; the status moves through the reviews above. */
  fastify.patch("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const parsed = updateOrganisationTermsSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const { discountPct, ...flags } = parsed.data

    const updated = await db.transaction(async (tx) => {
      const [before] = await tx
        .select({
          discountPct: organisations.discountPct,
          net30Allowed: organisations.net30Allowed,
          showPrices: organisations.showPrices,
        })
        .from(organisations)
        .where(eq(organisations.id, params.data.id))
        .for("update")
      if (!before) return null

      const [row] = await tx
        .update(organisations)
        .set({
          ...flags,
          ...(discountPct === undefined ? {} : { discountPct: String(discountPct) }),
          updatedAt: new Date(),
        })
        .where(eq(organisations.id, params.data.id))
        .returning(DETAIL_COLUMNS)
      if (!row) return null

      const changedKeys = Object.keys(parsed.data) as (keyof typeof parsed.data)[]
      const previous = withNumericDiscount(before)
      await recordAuditEvent(
        {
          userId: request.user.sub,
          userRole: "admin",
          entityType: "organisation",
          entityId: row.id,
          action: "organisation.terms_updated",
          oldValue: Object.fromEntries(changedKeys.map((key) => [key, previous[key]])),
          newValue: parsed.data,
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        },
        tx,
      )
      return row
    })

    if (!updated) return reply.code(404).send(NOT_FOUND)
    return reply.send({ data: withNumericDiscount(updated) })
  })
}
