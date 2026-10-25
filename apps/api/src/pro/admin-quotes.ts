import {
  adminQuoteRequestListQuerySchema,
  adminQuoteUpdateSchema,
  parisToday,
  type QuoteRequestStatus,
  uuidParamSchema,
} from "@armurier/shared"
import { and, count, desc, eq, type SQL, sql } from "drizzle-orm"
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { organisations, quoteRequestItems, quoteRequests, users } from "../db/schema.js"
import { enqueueQuotation, processHenrriDocument } from "../henrri/queue.js"
import { validationError } from "../http.js"
import { BILLING_ADDRESS_COLUMNS, completeBillingAddress } from "../organisations/service.js"
import {
  adminQuoteView,
  applyQuoteChanges,
  freezeQuoteTotal,
  isQuoteExpired,
  isQuoteSending,
  quoteTotalOf,
  startQuote,
  UnknownQuoteLine,
} from "./quotes.js"

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

/** A refusal the back-office explains to SCS, by its code. */
class QuoteRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function invalidStatus(status: QuoteRequestStatus, action: string) {
  return new QuoteRefusal("InvalidStatusTransition", `Cannot ${action} a request whose status is ${status}`)
}

/** The request, locked for the transaction, if SCS may still change its quote. */
async function lockQuoteInReview(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], id: string, action: string) {
  const [request] = await tx
    .select({ id: quoteRequests.id, status: quoteRequests.status, validUntil: quoteRequests.validUntil })
    .from(quoteRequests)
    .where(eq(quoteRequests.id, id))
    .for("update")
  if (!request) return null
  if (request.status !== "in_review") throw invalidStatus(request.status, action)
  if (await isQuoteSending(tx, id)) throw new QuoteRefusal("QuoteSending", "The quote is on its way to Henrri")
  return request
}

function auditContext(request: FastifyRequest) {
  return {
    userId: request.user.sub,
    userRole: "admin" as const,
    entityType: "quote_request",
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  }
}

async function replyWithQuote(reply: FastifyReply, id: string, statusCode = 200) {
  const view = await adminQuoteView(id)
  if (!view) return reply.code(404).send(NOT_FOUND)
  return reply.code(statusCode).send({ data: view })
}

/**
 * Quote requests in the back-office: SCS sees them and takes them in hand
 * (story 12.8c), then prices the quote and sends it through Henrri (12.8d).
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

  /** GET /:id — the request and its quote: lines, delivery, totals, validity, Henrri's progress. */
  fastify.get("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    return replyWithQuote(reply, params.data.id)
  })

  /**
   * POST /:id/review — SCS takes the request in hand: the pro can no longer
   * cancel it, and the quote starts from the organisation's discount and the grid.
   */
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
      const [organisation] = await tx
        .select({ discountPct: organisations.discountPct })
        .from(organisations)
        .innerJoin(quoteRequests, eq(quoteRequests.organisationId, organisations.id))
        .where(eq(quoteRequests.id, row.id))
      await startQuote(tx, row.id, Number(organisation?.discountPct ?? 0))
      await recordAuditEvent(
        {
          ...auditContext(request),
          entityId: row.id,
          action: "quote_request.in_review",
          oldValue: { status: "requested" },
          newValue: { status: "in_review" },
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

  /** PATCH /:id — SCS prices the lines, sets the delivery and the validity, judges the documents. */
  fastify.patch("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const parsed = adminQuoteUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const changes = parsed.data
    if (changes.validUntil !== undefined && changes.validUntil < parisToday()) {
      return reply
        .code(400)
        .send(validationError([{ path: ["validUntil"], message: "The validity cannot end in the past" }]))
    }

    try {
      const found = await db.transaction(async (tx) => {
        const locked = await lockQuoteInReview(tx, params.data.id, "change the quote of")
        if (!locked) return false
        await applyQuoteChanges(tx, locked.id, changes, request.user.sub)
        await recordAuditEvent(
          { ...auditContext(request), entityId: locked.id, action: "quote_request.updated", newValue: changes },
          tx,
        )
        return true
      })
      if (!found) return reply.code(404).send(NOT_FOUND)
    } catch (error) {
      if (error instanceof UnknownQuoteLine) {
        return reply
          .code(400)
          .send(validationError([{ path: ["items"], message: "A line does not belong to this request" }]))
      }
      if (error instanceof QuoteRefusal) return reply.code(409).send({ error: error.code, message: error.message })
      throw error
    }
    return replyWithQuote(reply, params.data.id)
  })

  /**
   * POST /:id/send — freezes the total and queues the Henrri quote; the request
   * turns `sent` once Henrri has issued it, and the pro is mailed then.
   */
  fastify.post("/:id/send", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    let documentId: string | null
    try {
      documentId = await db.transaction(async (tx) => {
        const locked = await lockQuoteInReview(tx, params.data.id, "send the quote of")
        if (!locked) return null
        if (isQuoteExpired(locked.validUntil)) {
          throw new QuoteRefusal("QuoteExpired", "The quote's validity has passed: set a new date first")
        }
        const [billing] = await tx
          .select(BILLING_ADDRESS_COLUMNS)
          .from(organisations)
          .innerJoin(quoteRequests, eq(quoteRequests.organisationId, organisations.id))
          .where(eq(quoteRequests.id, locked.id))
        if (!billing || !completeBillingAddress(billing)) {
          throw new QuoteRefusal("MissingBillingAddress", "Set the organisation's billing address first")
        }
        const totalTtc = await quoteTotalOf(tx, locked.id)
        if (totalTtc === null) throw new QuoteRefusal("UnpricedLine", "Every line needs a price")

        await freezeQuoteTotal(tx, locked.id, totalTtc)
        const queued = await enqueueQuotation(locked.id, tx)
        await recordAuditEvent(
          {
            ...auditContext(request),
            entityId: locked.id,
            action: "quote_request.send_requested",
            newValue: { totalTtc },
          },
          tx,
        )
        return queued
      })
    } catch (error) {
      if (error instanceof QuoteRefusal) return reply.code(409).send({ error: error.code, message: error.message })
      throw error
    }
    if (documentId === null) return reply.code(404).send(NOT_FOUND)

    // Henrri is asked at once rather than at the next pass; the queue owns any failure.
    const client = fastify.henrri
    if (client) {
      processHenrriDocument(client, documentId, request.log).catch((err) =>
        request.log.error({ err, documentId }, "Immediate Henrri quote pass failed"),
      )
    }
    return replyWithQuote(reply, params.data.id, 202)
  })
}
