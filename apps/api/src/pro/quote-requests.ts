import {
  acceptQuoteSchema,
  CANCELLABLE_QUOTE_STATUSES,
  quoteRequestSubmitSchema,
  uuidParamSchema,
} from "@armurier/shared"
import { and, asc, count, desc, eq, gt, inArray, sql } from "drizzle-orm"
import type { FastifyPluginAsync, FastifyRequest } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { products, quoteBasketItems, quoteRequestItems, quoteRequests, users } from "../db/schema.js"
import { sendQuoteRequestAlertEmail, sendQuoteRequestReceivedEmail } from "../email.js"
import { HenrriError } from "../henrri/client.js"
import { validationError } from "../http.js"
import { sendOrderConfirmation } from "../orders/confirmation.js"
import { OrderError } from "../orders/placement.js"
import { proOrganisationOf } from "./access.js"
import { acceptQuote } from "./quote-acceptance.js"
import { loadBasket } from "./quote-basket.js"
import { issuedQuotation, memberQuoteView, validityDay } from "./quotes.js"

const NOT_FOUND = { error: "NotFound", message: "Quote request not found" }

/**
 * Story 12.9g — each request mails every admin, so an organisation may send so
 * many in a rolling hour; past that, the basket waits. Generous for a real
 * buyer, and it bounds what one account can make SCS's inbox receive.
 */
export const QUOTE_REQUESTS_PER_HOUR = 20

/** DR-<year>-<n>: the sequence never resets, the year only reads better. */
const NEXT_NUMBER = sql<string>`'DR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('quote_request_number_seq')::text, 4, '0')`

/** What a pro sees of a request: no public price, and the quote's figures only once it is issued. */
const MEMBER_REQUEST_COLUMNS = {
  id: quoteRequests.id,
  number: quoteRequests.number,
  status: quoteRequests.status,
  message: quoteRequests.message,
  validUntil: quoteRequests.validUntil,
  createdAt: quoteRequests.createdAt,
  updatedAt: quoteRequests.updatedAt,
} as const

const MEMBER_ITEM_COLUMNS = {
  id: quoteRequestItems.id,
  position: quoteRequestItems.position,
  productId: quoteRequestItems.productId,
  productSlug: products.slug,
  productName: quoteRequestItems.productName,
  productSku: quoteRequestItems.productSku,
  variantSku: quoteRequestItems.variantSku,
  variantLabel: quoteRequestItems.variantLabel,
  legalCategory: quoteRequestItems.legalCategory,
  qty: quoteRequestItems.qty,
} as const

// Built with the query builder: it qualifies the correlated `quote_requests.id`,
// which a hand-written subquery would leave to resolve against the items' own `id`.
const LINE_COUNT = sql<number>`(${db
  .select({ count: sql`count(*)::int` })
  .from(quoteRequestItems)
  .where(eq(quoteRequestItems.quoteRequestId, quoteRequests.id))})`

class SubmitRefusal extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.message))
  }
}

/** The validity as a calendar day, as the pro reads it. */
function withValidityDay<T extends { validUntil: Date | null }>(row: T) {
  return { ...row, validUntil: validityDay(row.validUntil) }
}

async function memberRequest(id: string, organisationId: string) {
  const [request] = await db
    .select({
      ...MEMBER_REQUEST_COLUMNS,
      shippingPortions: quoteRequests.shippingPortions,
      documentsSufficientAt: quoteRequests.documentsSufficientAt,
      organisationId: quoteRequests.organisationId,
    })
    .from(quoteRequests)
    .where(and(eq(quoteRequests.id, id), eq(quoteRequests.organisationId, organisationId)))
  if (!request) return null
  const [items, quote] = await Promise.all([
    db
      .select(MEMBER_ITEM_COLUMNS)
      .from(quoteRequestItems)
      .leftJoin(products, eq(products.id, quoteRequestItems.productId))
      .where(eq(quoteRequestItems.quoteRequestId, id))
      .orderBy(asc(quoteRequestItems.position)),
    memberQuoteView(request),
  ])
  const {
    shippingPortions: _shippingPortions,
    documentsSufficientAt: _documentsSufficientAt,
    organisationId: _organisationId,
    ...visible
  } = request
  return { ...withValidityDay(visible), items, quote }
}

/** Best-effort once committed: the pro's receipt and SCS's alert. */
async function announce(
  request: FastifyRequest,
  submitted: { number: string; lineCount: number },
  applicant: { id: string; email: string },
  legalName: string,
) {
  const admins = await db.select({ email: users.email }).from(users).where(eq(users.role, "admin"))
  await Promise.all([
    sendQuoteRequestReceivedEmail(applicant.email, submitted, { userId: applicant.id }).catch((err) =>
      request.log.error({ err, number: submitted.number }, "quote request receipt failed"),
    ),
    sendQuoteRequestAlertEmail(
      admins.map((admin) => admin.email),
      { ...submitted, legalName },
    ).catch((err) => request.log.error({ err, number: submitted.number }, "quote request alert failed")),
  ])
}

/** A pro's quote requests (story 12.8c): sent from the basket, followed, cancelled while untouched. */
export const quoteRequestRoutes: FastifyPluginAsync = async (fastify) => {
  /** POST / — the basket becomes a numbered request, all at once or not at all. */
  fastify.post("/", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = quoteRequestSubmitSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const organisation = proOrganisationOf(request)
    const userId = request.user.sub

    let submitted: { id: string; number: string; lineCount: number; email: string }
    try {
      submitted = await db.transaction(async (tx) => {
        // Serialised with the basket's own changes: what is frozen is what was there.
        const [applicant] = await tx
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, userId))
          .for("update")
        const [recent] = await tx
          .select({ total: count() })
          .from(quoteRequests)
          .where(
            and(
              eq(quoteRequests.organisationId, organisation.id),
              gt(quoteRequests.createdAt, sql`now() - interval '1 hour'`),
            ),
          )
        if ((recent?.total ?? 0) >= QUOTE_REQUESTS_PER_HOUR) {
          throw new SubmitRefusal(429, {
            error: "TooManyQuoteRequests",
            message: "Too many quote requests in the last hour; the basket is kept",
          })
        }
        const lines = await loadBasket(userId, tx)
        if (lines.length === 0) {
          throw new SubmitRefusal(400, { error: "EmptyBasket", message: "The quote basket is empty" })
        }
        const unavailable = lines.filter((line) => !line.available)
        if (unavailable.length > 0) {
          throw new SubmitRefusal(409, {
            error: "UnavailableItems",
            message: "Some items can no longer be asked for a quote",
            items: unavailable.map((line) => line.name),
          })
        }

        const [created] = await tx
          .insert(quoteRequests)
          .values({
            number: NEXT_NUMBER,
            organisationId: organisation.id,
            requestedBy: userId,
            message: parsed.data.message || null,
          })
          .returning({ id: quoteRequests.id, number: quoteRequests.number })
        if (!created) throw new Error("quote request insert returned no row")

        await tx.insert(quoteRequestItems).values(
          lines.map((line, index) => ({
            quoteRequestId: created.id,
            position: index + 1,
            productId: line.productId,
            variantId: line.variantId,
            productName: line.name,
            productSku: line.sku,
            variantSku: line.skuVariant,
            variantLabel: line.variantLabel,
            legalCategory: line.legalCategory,
            qty: line.qty,
            publicPriceHt: line.publicPriceHt.toFixed(2),
            vatPct: line.vatPct.toFixed(2),
          })),
        )
        await tx.delete(quoteBasketItems).where(eq(quoteBasketItems.userId, userId))
        await recordAuditEvent(
          {
            userId,
            userRole: "customer",
            entityType: "quote_request",
            entityId: created.id,
            action: "quote_request.submitted",
            newValue: { number: created.number, organisationId: organisation.id, lineCount: lines.length },
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"] ?? null,
          },
          tx,
        )
        return { ...created, lineCount: lines.length, email: applicant?.email ?? "" }
      })
    } catch (err) {
      if (err instanceof SubmitRefusal) return reply.code(err.status).send(err.body)
      throw err
    }

    await announce(
      request,
      { number: submitted.number, lineCount: submitted.lineCount },
      { id: userId, email: submitted.email },
      organisation.legalName,
    )
    return reply.code(201).send({ data: await memberRequest(submitted.id, organisation.id) })
  })

  /** GET / — the organisation's requests, newest first. */
  fastify.get("/", async (request, reply) => {
    const organisation = proOrganisationOf(request)
    const rows = await db
      .select({ ...MEMBER_REQUEST_COLUMNS, lineCount: LINE_COUNT })
      .from(quoteRequests)
      .where(eq(quoteRequests.organisationId, organisation.id))
      .orderBy(desc(quoteRequests.createdAt), desc(quoteRequests.number))
    return reply.send({ data: rows.map(withValidityDay) })
  })

  fastify.get("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const found = await memberRequest(params.data.id, proOrganisationOf(request).id)
    if (!found) return reply.code(404).send(NOT_FOUND)
    return reply.send({ data: found })
  })

  /** GET /:id/quote.pdf — the issued quote, as Henrri made it (story 12.8d). */
  fastify.get("/:id/quote.pdf", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const found = await memberRequest(params.data.id, proOrganisationOf(request).id)
    const quotation = found?.quote ? await issuedQuotation(found.id) : null
    if (!quotation) return reply.code(404).send({ error: "NotFound", message: "Quote not found" })

    const unavailable = () =>
      reply.code(503).send({ error: "QuoteUnavailable", message: "The quote cannot be fetched right now" })
    if (!fastify.henrri) return unavailable()
    let pdf: Uint8Array
    try {
      pdf = await fastify.henrri.pdf(quotation.henrriDocumentId)
    } catch (err) {
      if (!(err instanceof HenrriError)) throw err
      request.log.warn({ err, quoteRequestId: params.data.id }, "Quote PDF unavailable from Henrri")
      return unavailable()
    }
    return reply
      .code(200)
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="Devis-${quotation.number.replace(/[^\w.-]/g, "_")}.pdf"`)
      .header("cache-control", "private, no-store")
      .send(Buffer.from(pdf))
  })

  /**
   * POST /:id/accept — the pro accepts the quote (story 12.8d-2): its order is
   * placed at the quote's prices, the stock taken, the request converted.
   */
  fastify.post(
    "/:id/accept",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const params = uuidParamSchema.safeParse(request.params)
      if (!params.success) return reply.code(400).send(validationError(params.error.issues))
      const parsed = acceptQuoteSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

      let placed: { orderId: string; totalTtc: number }
      try {
        placed = await acceptQuote({
          quoteRequestId: params.data.id,
          organisationId: proOrganisationOf(request).id,
          userId: request.user.sub,
          ipAddress: request.ip,
          input: parsed.data,
        })
      } catch (err) {
        if (err instanceof OrderError)
          return reply.code(err.statusCode).send({ error: err.errorCode, message: err.message })
        throw err
      }

      // Confirmation on a durable medium (story 12.1); never throws, retried later on failure.
      void sendOrderConfirmation(placed.orderId, request.log)
      return reply.code(201).send({ data: { id: placed.orderId, totalTtc: placed.totalTtc } })
    },
  )

  /** POST /:id/cancel — only while SCS has not started on it. */
  fastify.post("/:id/cancel", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const organisation = proOrganisationOf(request)

    const cancelled = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(quoteRequests)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(quoteRequests.id, params.data.id),
            eq(quoteRequests.organisationId, organisation.id),
            inArray(quoteRequests.status, [...CANCELLABLE_QUOTE_STATUSES]),
          ),
        )
        .returning({ id: quoteRequests.id, number: quoteRequests.number })
      if (!row) return null
      await recordAuditEvent(
        {
          userId: request.user.sub,
          userRole: "customer",
          entityType: "quote_request",
          entityId: row.id,
          action: "quote_request.cancelled",
          newValue: { number: row.number },
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        },
        tx,
      )
      return row
    })

    if (!cancelled) {
      const exists = await memberRequest(params.data.id, organisation.id)
      if (!exists) return reply.code(404).send(NOT_FOUND)
      return reply.code(409).send({
        error: "NotCancellable",
        message: "SCS has already started on this request",
      })
    }
    return reply.send({ data: await memberRequest(cancelled.id, organisation.id) })
  })
}
