import { adminOrderQuerySchema, uuidParamSchema } from "@armurier/shared"
import { and, count, desc, eq, ilike, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { orders, paymentCarte, paymentVirement, refunds, users } from "../db/schema.js"
import { validationError } from "../http.js"

// Row shape for the admin orders list: enough to triage without the full detail.
const LIST_FIELDS = {
  id: orders.id,
  createdAt: orders.createdAt,
  updatedAt: orders.updatedAt,
  legalVerificationStatus: orders.legalVerificationStatus,
  paymentStatus: orders.paymentStatus,
  totalTtc: orders.totalTtc,
  itemsJson: orders.itemsJson,
  user: {
    id: users.id,
    email: users.email,
    firstname: users.firstname,
    lastname: users.lastname,
  },
} as const

// Admin orders dashboard API. Mounted under /api/admin/orders.
export const adminOrderRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  // GET /api/admin/orders/summary — headline counts for the dashboard overview.
  // Declared before `/:id` so "summary" is never parsed as an order id.
  fastify.get("/summary", async (_request, reply) => {
    const [[{ total }], byPayment, byLegal] = await Promise.all([
      db.select({ total: count() }).from(orders),
      db.select({ status: orders.paymentStatus, n: count() }).from(orders).groupBy(orders.paymentStatus),
      db
        .select({ status: orders.legalVerificationStatus, n: count() })
        .from(orders)
        .groupBy(orders.legalVerificationStatus),
    ])

    const countWhere = (rows: Array<{ status: string; n: number }>, statuses: string[]) =>
      rows.filter((r) => statuses.includes(r.status)).reduce((sum, r) => sum + r.n, 0)

    return reply.code(200).send({
      data: {
        totalOrders: total,
        awaitingPayment: countWhere(byPayment, ["pending", "awaiting_transfer", "transfer_claimed"]),
        paid: countWhere(byPayment, ["received", "reconciled", "partially_refunded"]),
        refunded: countWhere(byPayment, ["refunded"]),
        docsToReview: countWhere(byLegal, ["pending", "docs_verifying"]),
        docsRejected: countWhere(byLegal, ["docs_rejected"]),
        byPaymentStatus: Object.fromEntries(byPayment.map((r) => [r.status, r.n])),
        byLegalStatus: Object.fromEntries(byLegal.map((r) => [r.status, r.n])),
      },
    })
  })

  // GET /api/admin/orders — all orders, newest first, filterable by status / customer email
  fastify.get("/", async (request, reply) => {
    const parsed = adminOrderQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues))
    }
    const { paymentStatus, legalStatus, search, page, limit } = parsed.data

    const conditions = [
      paymentStatus ? eq(orders.paymentStatus, paymentStatus) : undefined,
      legalStatus ? eq(orders.legalVerificationStatus, legalStatus) : undefined,
      search ? ilike(users.email, `%${search}%`) : undefined,
    ].filter(Boolean)
    const where = conditions.length ? and(...conditions) : undefined

    const [{ total }] = await db
      .select({ total: count() })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.userId))
      .where(where)

    const rows = await db
      .select(LIST_FIELDS)
      .from(orders)
      .innerJoin(users, eq(users.id, orders.userId))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset((page - 1) * limit)

    const data = rows.map(({ itemsJson, ...r }) => ({
      ...r,
      totalTtc: Number(r.totalTtc),
      itemCount: itemsJson.reduce((sum, i) => sum + i.qty, 0),
    }))

    return reply.code(200).send({
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page * limit < total },
    })
  })

  // GET /api/admin/orders/:id — full order detail with customer, payment buckets and refunds
  fastify.get("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }

    const [order] = await db
      .select({
        id: orders.id,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        legalVerificationStatus: orders.legalVerificationStatus,
        legalRejectionReason: orders.legalRejectionReason,
        paymentStatus: orders.paymentStatus,
        subtotalHt: orders.subtotalHt,
        vatAmount: orders.vatAmount,
        totalTtc: orders.totalTtc,
        vipDiscountAmount: orders.vipDiscountAmount,
        items: orders.itemsJson,
        shippingAddress: orders.shippingAddress,
        billingAddress: orders.billingAddress,
        user: { id: users.id, email: users.email, firstname: users.firstname, lastname: users.lastname },
      })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.userId))
      .where(eq(orders.id, params.data.id))
      .limit(1)
    if (!order) {
      return reply.code(404).send({ error: "NotFound", message: "Order not found" })
    }

    const [carte] = await db.select().from(paymentCarte).where(eq(paymentCarte.orderId, order.id)).limit(1)
    const [virement] = await db.select().from(paymentVirement).where(eq(paymentVirement.orderId, order.id)).limit(1)
    const orderRefunds = await db
      .select()
      .from(refunds)
      .where(eq(refunds.orderId, order.id))
      .orderBy(sql`${refunds.createdAt} DESC`)

    return reply.code(200).send({
      data: {
        ...order,
        subtotalHt: Number(order.subtotalHt),
        vatAmount: Number(order.vatAmount),
        totalTtc: Number(order.totalTtc),
        vipDiscountAmount: Number(order.vipDiscountAmount),
        payment: { carte: carte ?? null, virement: virement ?? null, refunds: orderRefunds },
      },
    })
  })
}
