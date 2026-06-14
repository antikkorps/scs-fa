import {
  importBankStatementSchema,
  reconcileVirementSchema,
  uuidParamSchema,
  virementQueueQuerySchema,
} from "@armurier/shared"
import { asc, count, eq } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { orders, paymentVirement, users } from "../db/schema.js"
import { validationError } from "../http.js"
import { importBankStatement, PaymentError, reconcileVirementManually } from "./service.js"

// Reconciliation-facing columns of a bank-transfer bucket, joined to the order's
// owner so the admin sees who is waiting on the transfer.
const VIREMENT_FIELDS = {
  id: paymentVirement.id,
  orderId: paymentVirement.orderId,
  amountExpectedTtc: paymentVirement.amountExpectedTtc,
  amountReceivedTtc: paymentVirement.amountReceivedTtc,
  currency: paymentVirement.currency,
  paymentReference: paymentVirement.paymentReference,
  paymentStatus: paymentVirement.paymentStatus,
  clientReportedIban: paymentVirement.clientReportedIban,
  clientReportedDate: paymentVirement.clientReportedDate,
  clientReportedAmount: paymentVirement.clientReportedAmount,
  clientReportedRef: paymentVirement.clientReportedRef,
  clientNotes: paymentVirement.clientNotes,
  receivedAt: paymentVirement.receivedAt,
  receivedFromIban: paymentVirement.receivedFromIban,
  reconciledAt: paymentVirement.reconciledAt,
  reconciledBy: paymentVirement.reconciledBy,
  reconciliationNotes: paymentVirement.reconciliationNotes,
  createdAt: paymentVirement.createdAt,
  user: {
    id: users.id,
    email: users.email,
    firstname: users.firstname,
    lastname: users.lastname,
  },
} as const

// Admin bank-transfer reconciliation. Mounted under /api/admin/payments.
export const adminPaymentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  // GET /api/admin/payments/virements — reconciliation queue (oldest first)
  fastify.get("/virements", async (request, reply) => {
    const parsed = virementQueueQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues))
    }
    const { status, page, limit } = parsed.data
    const where = status === "all" ? undefined : eq(paymentVirement.paymentStatus, status)

    const [{ total }] = await db
      .select({ total: count() })
      .from(paymentVirement)
      .innerJoin(orders, eq(orders.id, paymentVirement.orderId))
      .innerJoin(users, eq(users.id, orders.userId))
      .where(where)

    const rows = await db
      .select(VIREMENT_FIELDS)
      .from(paymentVirement)
      .innerJoin(orders, eq(orders.id, paymentVirement.orderId))
      .innerJoin(users, eq(users.id, orders.userId))
      .where(where)
      // Oldest outstanding transfers first — they have been waiting longest.
      .orderBy(asc(paymentVirement.createdAt))
      .limit(limit)
      .offset((page - 1) * limit)

    return reply.code(200).send({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page * limit < total },
    })
  })

  // GET /api/admin/payments/virements/:id — full reconciliation detail
  fastify.get("/virements/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }

    const [row] = await db
      .select(VIREMENT_FIELDS)
      .from(paymentVirement)
      .innerJoin(orders, eq(orders.id, paymentVirement.orderId))
      .innerJoin(users, eq(users.id, orders.userId))
      .where(eq(paymentVirement.id, params.data.id))
      .limit(1)
    if (!row) {
      return reply.code(404).send({ error: "NotFound", message: "Bank-transfer record not found" })
    }
    return reply.code(200).send({ data: row })
  })

  // POST /api/admin/payments/virements/:id/reconcile — manual settlement
  fastify.post("/virements/:id/reconcile", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(validationError(params.error.issues))
    }
    const body = reconcileVirementSchema.safeParse(request.body ?? {})
    if (!body.success) {
      return reply.code(400).send(validationError(body.error.issues))
    }

    try {
      const result = await reconcileVirementManually(params.data.id, body.data, request.user.sub)
      return reply.code(200).send({ data: result })
    } catch (err) {
      if (err instanceof PaymentError) {
        return reply.code(err.statusCode).send({ error: err.errorCode, message: err.message })
      }
      throw err
    }
  })

  // POST /api/admin/payments/import — auto-reconcile from a bank statement CSV
  fastify.post("/import", async (request, reply) => {
    const body = importBankStatementSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send(validationError(body.error.issues))
    }

    try {
      const report = await importBankStatement(body.data.csv, request.user.sub)
      return reply.code(200).send({ data: report })
    } catch (err) {
      if (err instanceof PaymentError) {
        return reply.code(err.statusCode).send({ error: err.errorCode, message: err.message })
      }
      throw err
    }
  })
}
