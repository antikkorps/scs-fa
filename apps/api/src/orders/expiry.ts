import {
  type OrderPaymentStatus,
  orderPaymentDeadline,
  orderReference,
  PAID_PAYMENT_STATUSES,
  transferReminderDate,
  UNPAID_CARD_ORDER_MINUTES,
  UNPAID_TRANSFER_ORDER_DAYS,
} from "@armurier/shared"
import { and, eq, exists, inArray, isNull, lt, not, notExists, or, sql } from "drizzle-orm"
import type { FastifyBaseLogger, FastifyInstance } from "fastify"
import { releaseLapsedPrintHolds } from "../artworks/reservation.js"
import { recordAuditEvent, recordOrderStatusChange } from "../audit/record.js"
import { db } from "../db/client.js"
import { orders, paymentCarte, paymentVirement, users } from "../db/schema.js"
import { sendTransferReminderEmail, sendUnpaidOrderCancelledEmail } from "../email.js"
import { cancelPaymentIntent, retrievePaymentIntent } from "../payments/stripe.js"
import { settlePayoutsForOrder } from "../payouts/service.js"
import { startPeriodicJob } from "../periodic-job.js"
import { releaseOrderInventory } from "./inventory.js"

type Logger = Pick<FastifyBaseLogger, "warn" | "error">

const SILENT: Logger = { warn: () => undefined, error: () => undefined }

const PAID_STATES = PAID_PAYMENT_STATUSES as OrderPaymentStatus[]

const SWEEP_EVERY_MS = 5 * 60 * 1000

// A transfer bucket in these states means money is on its way or in: SCS decides
// what happens to the order, never the sweep (Franck, 2026-10-22).
const TRANSFER_MONEY_STATES: OrderPaymentStatus[] = ["transfer_claimed", ...PAID_STATES]
const CARD_PAID_STATES: OrderPaymentStatus[] = PAID_STATES

// Stripe is still settling, or has settled: the webhook decides, not the sweep.
const SETTLING_INTENT_STATES = new Set(["processing", "requires_capture", "succeeded"])

// Named in full: inside an UPDATE, Drizzle leaves the outer table's columns unqualified.
const OUTER_ORDER_ID = sql`"orders"."id"`

/** No money in, nor declared: the only orders the sweep may touch. Checked again at write time. */
const noMoneyIn = and(
  eq(orders.paymentStatus, "pending"),
  notExists(
    db
      .select({ id: paymentCarte.id })
      .from(paymentCarte)
      .where(and(eq(paymentCarte.orderId, OUTER_ORDER_ID), inArray(paymentCarte.paymentStatus, CARD_PAID_STATES))),
  ),
  notExists(
    db
      .select({ id: paymentVirement.id })
      .from(paymentVirement)
      .where(
        and(eq(paymentVirement.orderId, OUTER_ORDER_ID), inArray(paymentVirement.paymentStatus, TRANSFER_MONEY_STATES)),
      ),
  ),
)

const hasTransferBucket = exists(
  db.select({ id: paymentVirement.id }).from(paymentVirement).where(eq(paymentVirement.orderId, OUTER_ORDER_ID)),
)

/**
 * Unpaid orders past their payment deadline (story 12.9a). Those without money
 * in are cancelled by the sweep within minutes; what stays is for SCS — a
 * declared transfer, a card paid next to a missing transfer.
 */
export function paymentOverdue(now = new Date()) {
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000)
  return and(
    eq(orders.paymentStatus, "pending"),
    or(
      and(hasTransferBucket, lt(orders.createdAt, ago(UNPAID_TRANSFER_ORDER_DAYS * 24 * 60))),
      and(not(hasTransferBucket), lt(orders.createdAt, ago(UNPAID_CARD_ORDER_MINUTES))),
    ),
  )
}

type Candidate = Awaited<ReturnType<typeof loadCandidates>>[number]

/**
 * Unpaid orders old enough for the sweep to look at: a card order is due after
 * an hour, and nothing — reminder or cancellation — happens to any order sooner.
 */
function loadCandidates(now: Date) {
  const oldestDeadline = new Date(now.getTime() - UNPAID_CARD_ORDER_MINUTES * 60 * 1000)
  return db
    .select({
      id: orders.id,
      createdAt: orders.createdAt,
      itemsJson: orders.itemsJson,
      reminderSentAt: orders.paymentReminderSentAt,
      email: users.email,
      firstname: users.firstname,
      carteStatus: paymentCarte.paymentStatus,
      intentId: paymentCarte.stripePaymentIntentId,
      transferStatus: paymentVirement.paymentStatus,
      transferTtc: paymentVirement.amountExpectedTtc,
      transferReference: paymentVirement.paymentReference,
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .leftJoin(paymentCarte, eq(paymentCarte.orderId, orders.id))
    .leftJoin(paymentVirement, eq(paymentVirement.orderId, orders.id))
    .where(and(eq(orders.paymentStatus, "pending"), lt(orders.createdAt, oldestDeadline)))
}

function hasMoneyIn(order: Candidate): boolean {
  const cardPaid = order.carteStatus !== null && CARD_PAID_STATES.includes(order.carteStatus)
  const transferIn = order.transferStatus !== null && TRANSFER_MONEY_STATES.includes(order.transferStatus)
  return cardPaid || transferIn
}

/**
 * Story 12.9a — unpaid orders stop holding the catalogue. Card-only orders are
 * cancelled after an hour; orders with a bank transfer get a reminder on day 4
 * and are cancelled after a week. An order with money in or declared is left
 * to SCS. Safe to run concurrently: every write is a compare-and-set.
 */
export async function sweepUnpaidOrders(
  now = new Date(),
  log: Logger = SILENT,
): Promise<{ cancelled: number; reminded: number }> {
  let cancelled = 0
  let reminded = 0
  for (const order of await loadCandidates(now)) {
    if (hasMoneyIn(order) || !order.createdAt) continue
    const hasTransfer = order.transferStatus !== null
    if (now >= orderPaymentDeadline(order.createdAt, { hasTransfer })) {
      if (await cancelUnpaidOrder(order, log)) cancelled++
    } else if (hasTransfer && now >= transferReminderDate(order.createdAt)) {
      if (await remindTransfer(order, log)) reminded++
    }
  }
  return { cancelled, reminded }
}

async function remindTransfer(order: Candidate, log: Logger): Promise<boolean> {
  if (order.reminderSentAt || order.transferStatus !== "awaiting_transfer" || !order.createdAt) return false
  // Claimed before sending, released if the provider fails: one reminder, ever.
  const [claimed] = await db
    .update(orders)
    .set({ paymentReminderSentAt: new Date() })
    .where(and(eq(orders.id, order.id), isNull(orders.paymentReminderSentAt)))
    .returning({ id: orders.id })
  if (!claimed) return false
  try {
    await sendTransferReminderEmail(order.email, {
      orderId: order.id,
      orderRef: orderReference(order.id),
      firstname: order.firstname,
      amountTtc: Number(order.transferTtc),
      reference: order.transferReference,
      deadline: orderPaymentDeadline(order.createdAt, { hasTransfer: true }),
    })
    return true
  } catch (err) {
    await db.update(orders).set({ paymentReminderSentAt: null }).where(eq(orders.id, order.id))
    log.warn({ err, orderId: order.id }, "Transfer reminder e-mail failed — retried on the next sweep")
    return false
  }
}

/**
 * Stop Stripe from taking a payment for an order about to be cancelled. False
 * when the payment is going through (or Stripe refuses): the order then stays.
 */
async function closeCardPayment(order: Candidate, log: Logger): Promise<boolean> {
  if (!order.intentId) return true
  try {
    const intent = await retrievePaymentIntent(order.intentId)
    if (SETTLING_INTENT_STATES.has(intent.status)) return false
    if (intent.status !== "canceled") await cancelPaymentIntent(order.intentId)
    return true
  } catch (err) {
    log.warn({ err, orderId: order.id }, "Stripe payment of an expired order not cancelled — order kept")
    return false
  }
}

async function cancelUnpaidOrder(order: Candidate, log: Logger): Promise<boolean> {
  if (!(await closeCardPayment(order, log))) return false

  const cancelled = await db.transaction(async (tx) => {
    // The guard re-checks, at write time, that no money came in since the read.
    const [row] = await tx
      .update(orders)
      .set({ paymentStatus: "cancelled", updatedAt: new Date() })
      .where(and(eq(orders.id, order.id), noMoneyIn))
      .returning({ id: orders.id })
    if (!row) return false

    await tx
      .update(paymentCarte)
      .set({ paymentStatus: "cancelled", updatedAt: new Date() })
      .where(eq(paymentCarte.orderId, order.id))
    await tx
      .update(paymentVirement)
      .set({ paymentStatus: "cancelled", updatedAt: new Date() })
      .where(eq(paymentVirement.orderId, order.id))
    await releaseOrderInventory(tx, order.id, order.itemsJson)
    await recordOrderStatusChange(order.id, "payment", { from: "pending", to: "cancelled" }, tx)
    await recordAuditEvent(
      {
        userRole: "system",
        entityType: "order",
        entityId: order.id,
        orderId: order.id,
        action: "order.expired",
        newValue: { hasTransfer: order.transferStatus !== null },
      },
      tx,
    )
    return true
  })
  if (!cancelled) return false

  // Nothing was sold: what was frozen for the beneficiaries is voided (story 11.10).
  await settlePayoutsForOrder(order.id)
  try {
    await sendUnpaidOrderCancelledEmail(order.email, {
      orderId: order.id,
      orderRef: orderReference(order.id),
      firstname: order.firstname,
    })
  } catch (err) {
    log.warn({ err, orderId: order.id }, "Cancellation e-mail of an unpaid order failed")
  }
  return true
}

const PRINT_HOLD_SWEEP_EVERY_MS = 60 * 1000

/**
 * In-process sweeps (story 12.9a): unpaid orders every five minutes, lapsed
 * Gun Art print holds every minute — the cart already hides them at once.
 */
export function startUnpaidOrderSweep(app: FastifyInstance): void {
  startPeriodicJob(app, "unpaid order sweep", SWEEP_EVERY_MS, () => sweepUnpaidOrders(new Date(), app.log))
  startPeriodicJob(app, "print hold sweep", PRINT_HOLD_SWEEP_EVERY_MS, async () => ({
    printsReleased: await releaseLapsedPrintHolds(),
  }))
}
