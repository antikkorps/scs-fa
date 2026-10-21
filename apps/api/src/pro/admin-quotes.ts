import { adminQuoteRequestListQuerySchema, uuidParamSchema } from "@armurier/shared"
import { and, asc, count, desc, eq, type SQL, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { organisations, quoteRequestItems, quoteRequests, users } from "../db/schema.js"
import { validationError } from "../http.js"

const NOT_FOUND = { error: "NotFound", message: "Quote request not found" }

const REQUEST_COLUMNS = {
  id: quoteRequests.id,
  number: quoteRequests.number,
  status: quoteRequests.status,
  message: quoteRequests.message,
  validUntil: quoteRequests.validUntil,
  createdAt: quoteRequests.createdAt,
  updatedAt: quoteRequests.updatedAt,
} as const

// Built with the query builder, which qualifies the correlated `quote_requests.id`.
const LINE_COUNT = sql<number>`(${db
  .select({ count: sql`count(*)::int` })
  .from(quoteRequestItems)
  .where(eq(quoteRequestItems.quoteRequestId, quoteRequests.id))})`

const REQUESTER = { id: users.id, email: users.email, firstName: users.firstname, lastName: users.lastname } as const

/**
 * Quote requests in the back-office (story 12.8c): SCS sees them and takes
 * them in hand. Quoting them — prices, Henrri, the PDF — comes with 12.8d.
 */
export const adminQuoteRequestRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  fastify.get("/", async (request, reply) => {
    const parsed = adminQuoteRequestListQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const { page, limit, status } = parsed.data
    const where: SQL | undefined = status ? eq(quoteRequests.status, status) : undefined

    const [rows, [totals]] = await Promise.all([
      db
        .select({
          ...REQUEST_COLUMNS,
          lineCount: LINE_COUNT,
          organisation: { id: organisations.id, legalName: organisations.legalName, type: organisations.type },
          requester: REQUESTER,
        })
        .from(quoteRequests)
        .innerJoin(organisations, eq(organisations.id, quoteRequests.organisationId))
        .innerJoin(users, eq(users.id, quoteRequests.requestedBy))
        .where(where)
        .orderBy(desc(quoteRequests.createdAt), desc(quoteRequests.number))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ total: count() }).from(quoteRequests).where(where),
    ])
    const total = totals?.total ?? 0
    return reply.send({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page * limit < total },
    })
  })

  /** GET /:id — the lines as asked, with the public price each started from, and the organisation's terms. */
  fastify.get("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    const [row] = await db
      .select({
        ...REQUEST_COLUMNS,
        organisation: {
          id: organisations.id,
          legalName: organisations.legalName,
          siret: organisations.siret,
          type: organisations.type,
          status: organisations.status,
          discountPct: organisations.discountPct,
          net30Allowed: organisations.net30Allowed,
          showPrices: organisations.showPrices,
        },
        requester: REQUESTER,
      })
      .from(quoteRequests)
      .innerJoin(organisations, eq(organisations.id, quoteRequests.organisationId))
      .innerJoin(users, eq(users.id, quoteRequests.requestedBy))
      .where(eq(quoteRequests.id, params.data.id))
    if (!row) return reply.code(404).send(NOT_FOUND)

    const items = await db
      .select()
      .from(quoteRequestItems)
      .where(eq(quoteRequestItems.quoteRequestId, row.id))
      .orderBy(asc(quoteRequestItems.position))

    const amount = (value: string | null) => (value === null ? null : Number(value))
    return reply.send({
      data: {
        ...row,
        organisation: { ...row.organisation, discountPct: Number(row.organisation.discountPct) },
        items: items.map((item) => ({
          ...item,
          publicPriceHt: Number(item.publicPriceHt),
          vatPct: Number(item.vatPct),
          quotedPriceHt: amount(item.quotedPriceHt),
          lineDiscountPct: amount(item.lineDiscountPct),
        })),
      },
    })
  })

  /** POST /:id/review — SCS takes the request in hand: the pro can no longer cancel it. */
  fastify.post("/:id/review", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    const reviewed = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(quoteRequests)
        .set({ status: "in_review", updatedAt: new Date() })
        .where(and(eq(quoteRequests.id, params.data.id), eq(quoteRequests.status, "requested")))
        .returning(REQUEST_COLUMNS)
      if (!row) return null
      await recordAuditEvent(
        {
          userId: request.user.sub,
          userRole: "admin",
          entityType: "quote_request",
          entityId: row.id,
          action: "quote_request.in_review",
          oldValue: { status: "requested" },
          newValue: { status: "in_review" },
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        },
        tx,
      )
      return row
    })

    if (!reviewed) {
      const [current] = await db
        .select({ status: quoteRequests.status })
        .from(quoteRequests)
        .where(eq(quoteRequests.id, params.data.id))
      if (!current) return reply.code(404).send(NOT_FOUND)
      return reply.code(409).send({
        error: "InvalidStatusTransition",
        message: `Cannot take in hand a request whose status is ${current.status}`,
      })
    }
    return reply.send({ data: reviewed })
  })
}
