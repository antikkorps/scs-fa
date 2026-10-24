import {
  type CreateRefundInput,
  PAID_PAYMENT_STATUSES,
  type RefundChannel,
  type RefundKindValue,
} from "@armurier/shared"
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import { recordAuditEvent, recordOrderStatusChange } from "../audit/record.js"
import { db } from "../db/client.js"
import { orders, paymentCarte, paymentVirement, refunds } from "../db/schema.js"
import {
  nearestExpressibleRefunds,
  type RefundRecord,
  refundedAmountOf,
  remainingToCredit,
} from "../henrri/credit-notes.js"
import { buildInvoiceDraft, type DraftRefusal } from "../henrri/documents.js"
import { enqueueCreditNote } from "../henrri/queue.js"
import { releaseOrderInventory } from "../orders/inventory.js"
import { settlePayoutsForOrder } from "../payouts/service.js"
import { recomputeVipStatus } from "../vip/service.js"
import { PaymentError } from "./service.js"
import { createRefund as stripeCreateRefund } from "./stripe.js"

// Refund rows that still hold money against a channel: a pending card refund
// counts so we never over-refund while Stripe is still settling it.
const OUTSTANDING_REFUND_STATUSES = ["pending", "succeeded"] as const

function toCents(amount: number | string): number {
  return Math.round(Number(amount) * 100)
}

interface ChannelState {
  paidTtc: number
  /** Already refunded (pending + succeeded) on this channel. */
  refundedTtc: number
  refundableTtc: number
}

/**
 * What an order has paid and had refunded on a given channel.
 *
 * Card is "paid" once its bucket reaches a settled status; bank transfer once it
 * is reconciled (using the actually-received amount). Throws a typed 400 when the
 * channel carries no settled payment — there is nothing to refund.
 */
async function channelState(orderId: string, channel: RefundChannel): Promise<ChannelState> {
  let paidTtc: number
  if (channel === "carte") {
    const [carte] = await db.select().from(paymentCarte).where(eq(paymentCarte.orderId, orderId)).limit(1)
    if (!carte || !PAID_PAYMENT_STATUSES.includes(carte.paymentStatus)) {
      throw new PaymentError(400, "ChannelNotPaid", "This order has no settled card payment to refund")
    }
    paidTtc = Number(carte.amountTtc)
  } else {
    const [virement] = await db.select().from(paymentVirement).where(eq(paymentVirement.orderId, orderId)).limit(1)
    if (!virement || !PAID_PAYMENT_STATUSES.includes(virement.paymentStatus)) {
      throw new PaymentError(400, "ChannelNotPaid", "This order has no settled bank transfer to refund")
    }
    paidTtc = Number(virement.amountReceivedTtc ?? virement.amountExpectedTtc)
  }

  const prior = await db
    .select({ amountTtc: refunds.amountTtc })
    .from(refunds)
    .where(
      and(
        eq(refunds.orderId, orderId),
        eq(refunds.channel, channel),
        inArray(refunds.status, OUTSTANDING_REFUND_STATUSES),
      ),
    )
  const refundedTtc = prior.reduce((sum, r) => sum + Number(r.amountTtc), 0)
  return { paidTtc, refundedTtc, refundableTtc: paidTtc - refundedTtc }
}

/** The order's earlier refunds that hold money (pending or succeeded), oldest first. */
async function earlierRefunds(orderId: string): Promise<RefundRecord[]> {
  const rows = await db
    .select({
      kind: refunds.kind,
      amountTtc: refunds.amountTtc,
      lines: refunds.lines,
      includesShipping: refunds.includesShipping,
    })
    .from(refunds)
    .where(and(eq(refunds.orderId, orderId), inArray(refunds.status, OUTSTANDING_REFUND_STATUSES)))
    .orderBy(asc(refunds.createdAt), asc(refunds.id))
  return rows.map((row) => ({ ...row, amountTtc: Number(row.amountTtc) }))
}

// Why the Henrri credit note of a refund cannot be issued, as the admin reads it.
const CREDIT_NOTE_REFUSALS: Partial<Record<DraftRefusal, { code: string; message: string }>> = {
  ReturnExceedsOrder: { code: "ReturnExceedsOrder", message: "More articles than bought, or than are left to return" },
  ShippingAlreadyRefunded: { code: "ShippingAlreadyRefunded", message: "The delivery has already been refunded" },
  NothingToCredit: { code: "NothingToReturn", message: "Pick at least one article, or the delivery" },
  InvalidRefundAmount: { code: "ExceedsInvoice", message: "Credit notes would exceed the invoice" },
  LegacySnapshot: {
    code: "ReturnNeedsSnapshot",
    message: "This order predates line-by-line invoicing: refund it as a goodwill gesture",
  },
}

export interface RefundPlan {
  record: RefundRecord
  amountTtc: number
  refundableTtc: number
  /** What credit notes may still take; null when the order is not invoiced through Henrri. */
  remainingToCreditTtc: number | null
}

/**
 * Works out a refund before any money moves (story 12.6, decisions 2026-10-14):
 * its amount (computed from the lines for a goods return), and every cap — the
 * channel, the overpayment excess, the invoice that credit notes may not exceed,
 * and the amounts Henrri can express (the closest ones are offered otherwise).
 * Orders not invoiced through Henrri (placed before the 12.6 snapshot) only take
 * goodwill and overpayment refunds, with the channel cap.
 */
export async function planRefund(orderId: string, input: CreateRefundInput): Promise<RefundPlan> {
  const [order] = await db
    .select({
      paymentStatus: orders.paymentStatus,
      itemsJson: orders.itemsJson,
      shippingPortions: orders.shippingPortions,
      totalTtc: orders.totalTtc,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)
  if (!order) throw new PaymentError(404, "NotFound", "Order not found")
  if (!PAID_PAYMENT_STATUSES.includes(order.paymentStatus)) {
    throw new PaymentError(400, "NotRefundable", "Only a paid order can be refunded")
  }

  const state = await channelState(orderId, input.channel)
  if (state.refundableTtc <= 0) {
    throw new PaymentError(409, "FullyRefunded", "This channel has already been fully refunded")
  }

  const source = {
    itemsJson: order.itemsJson,
    shippingPortions: order.shippingPortions,
    totalTtc: Number(order.totalTtc),
  }
  const previous = await earlierRefunds(orderId)
  const record: RefundRecord =
    input.kind === "goods_return"
      ? { kind: input.kind, amountTtc: 0, lines: input.lines, includesShipping: input.includesShipping }
      : { kind: input.kind, amountTtc: input.amount, lines: null, includesShipping: false }

  const invoiced = buildInvoiceDraft(source).ok
  const remaining = invoiced ? remainingToCredit(source, previous) : null
  const remainingToCreditTtc = remaining?.ok ? remaining.amountTtc : null

  let amountTtc = record.amountTtc
  if (input.kind === "overpayment") {
    await assertWithinOverpayment(orderId, record.amountTtc)
  } else if (invoiced || input.kind === "goods_return") {
    const amount = refundedAmountOf(source, record, previous)
    if (!amount.ok) {
      if (amount.reason === "InexpressibleAmount") {
        throw new PaymentError(
          400,
          "InexpressibleRefundAmount",
          `No credit note can add up to ${record.amountTtc.toFixed(2)} €: Henrri rounds HT and VAT apart`,
          { suggestions: nearestExpressibleRefunds(source, record.amountTtc, previous, state.refundableTtc) },
        )
      }
      const refusal = CREDIT_NOTE_REFUSALS[amount.reason] ?? { code: amount.reason, message: "Refund refused" }
      throw new PaymentError(400, refusal.code, refusal.message)
    }
    amountTtc = amount.amountTtc
  }

  if (toCents(amountTtc) > toCents(state.refundableTtc)) {
    throw new PaymentError(
      400,
      "AmountExceedsRefundable",
      `Refundable amount on this channel is ${state.refundableTtc.toFixed(2)}`,
    )
  }
  return { record: { ...record, amountTtc }, amountTtc, refundableTtc: state.refundableTtc, remainingToCreditTtc }
}

/** An overpayment refund returns at most what the transfer brought in beyond what was due. */
async function assertWithinOverpayment(orderId: string, amountTtc: number) {
  const [virement] = await db
    .select({ expected: paymentVirement.amountExpectedTtc, received: paymentVirement.amountReceivedTtc })
    .from(paymentVirement)
    .where(eq(paymentVirement.orderId, orderId))
    .limit(1)
  const earlier = await db
    .select({ amountTtc: refunds.amountTtc })
    .from(refunds)
    .where(
      and(
        eq(refunds.orderId, orderId),
        eq(refunds.kind, "overpayment"),
        inArray(refunds.status, OUTSTANDING_REFUND_STATUSES),
      ),
    )
  const excessCents =
    toCents(virement?.received ?? 0) -
    toCents(virement?.expected ?? 0) -
    earlier.reduce((sum, row) => sum + toCents(row.amountTtc), 0)
  if (toCents(amountTtc) > excessCents) {
    throw new PaymentError(
      400,
      "ExceedsOverpayment",
      `Paid in excess and not yet returned: ${(Math.max(excessCents, 0) / 100).toFixed(2)}`,
    )
  }
}

export interface RefundResult {
  id: string
  orderId: string
  kind: RefundKindValue
  channel: RefundChannel
  amountTtc: string
  status: string
  stripeRefundId: string | null
  orderPaymentStatus: string
}

/** A refund issued, or found already issued under the same idempotency key. */
export interface RefundOutcome {
  refund: RefundResult
  replayed: boolean
}

function refundResult(row: typeof refunds.$inferSelect, orderPaymentStatus: string): RefundResult {
  return {
    id: row.id,
    orderId: row.orderId,
    kind: row.kind,
    channel: row.channel,
    amountTtc: row.amountTtc,
    status: row.status,
    stripeRefundId: row.stripeRefundId,
    orderPaymentStatus,
  }
}

/**
 * Issue a refund on a paid order, on the card (Stripe) or bank-transfer channel.
 *
 * Card refunds go through Stripe and may settle asynchronously (pending →
 * succeeded via webhook); bank-transfer refunds are recorded as already
 * succeeded — the actual wire-back happens out of band, the admin asserts it.
 * The amount is capped at what is still refundable on the channel. A refund that
 * settles immediately triggers the order-level effects (full → `refunded` with
 * stock/print restock + VIP recompute; partial → `partially_refunded`).
 *
 * Story 12.9g — refunds of one order are issued one at a time (the order row
 * is locked until the refund is recorded), so two at once can never together
 * exceed what is refundable. And `idempotencyKey`, chosen by the admin form for
 * one refund, makes a repeated request (double click, retry) answer with the
 * refund already made; Stripe gets the same key.
 */
export async function createOrderRefund(
  orderId: string,
  input: CreateRefundInput,
  adminId: string,
  idempotencyKey: string,
): Promise<RefundOutcome> {
  const issued = await db.transaction(async (tx) => {
    const [order] = await tx
      .select({ paymentStatus: orders.paymentStatus })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update")
    if (!order) throw new PaymentError(404, "NotFound", "Order not found")

    const [earlier] = await tx.select().from(refunds).where(eq(refunds.idempotencyKey, idempotencyKey))
    if (earlier) {
      if (earlier.orderId !== orderId) {
        throw new PaymentError(409, "IdempotencyKeyReused", "This idempotency key belongs to another order's refund")
      }
      return { row: earlier, orderPaymentStatus: order.paymentStatus, replayed: true }
    }

    // Planned once the lock is held: it sees every refund recorded before this one.
    const plan = await planRefund(orderId, input)
    const amountTtc = plan.amountTtc.toFixed(2)
    let status: "pending" | "succeeded" | "failed" | "cancelled" = "succeeded"
    let stripeRefundId: string | null = null
    let failureReason: string | null = null

    if (input.channel === "carte") {
      const [carte] = await tx
        .select({ intentId: paymentCarte.stripePaymentIntentId })
        .from(paymentCarte)
        .where(eq(paymentCarte.orderId, orderId))
        .limit(1)
      if (!carte?.intentId) {
        throw new PaymentError(409, "NoPaymentIntent", "Card payment has no Stripe PaymentIntent to refund")
      }
      const refund = await stripeCreateRefund(
        {
          payment_intent: carte.intentId,
          amount: toCents(plan.amountTtc),
          metadata: { orderId, initiatedBy: adminId },
        },
        { idempotencyKey: `refund:${idempotencyKey}` },
      )
      stripeRefundId = refund.id
      // Stripe statuses: succeeded | pending | failed | canceled | requires_action
      status = refund.status === "succeeded" ? "succeeded" : refund.status === "pending" ? "pending" : "failed"
      if (status === "failed") failureReason = refund.failure_reason ?? "Stripe refund did not succeed"
    }
    const failed = status === "failed"

    const [row] = await tx
      .insert(refunds)
      .values({
        orderId,
        channel: input.channel,
        kind: input.kind,
        lines: plan.record.lines,
        includesShipping: plan.record.includesShipping,
        amountTtc,
        currency: "EUR",
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        status,
        stripeRefundId,
        failureReason,
        idempotencyKey,
        initiatedBy: adminId,
        processedAt: status === "succeeded" ? new Date() : null,
      })
      .returning()
    if (!row) throw new Error("refund insert returned no row")

    await recordAuditEvent(
      {
        userId: adminId,
        userRole: "admin",
        entityType: "refund",
        entityId: row.id,
        orderId,
        action: `payment.refund.${status}`,
        result: failed ? "failure" : "success",
        error: failed ? stripeRefundError(failureReason) : null,
        newValue: { channel: input.channel, amountTtc, stripeRefundId },
      },
      tx,
    )
    return { row, orderPaymentStatus: order.paymentStatus, replayed: false }
  })

  if (issued.replayed) {
    return { refund: refundResult(issued.row, issued.orderPaymentStatus), replayed: true }
  }

  // A refund that is already settled moves the order and gets its credit note; a
  // pending card refund waits for the webhook before any of it.
  const settledNow = issued.row.status === "succeeded"
  const orderPaymentStatus = settledNow ? await applyRefundEffects(orderId) : issued.orderPaymentStatus
  if (settledNow) await enqueueCreditNote(issued.row.id)

  return { refund: refundResult(issued.row, orderPaymentStatus), replayed: false }
}

/**
 * Re-derive an order's payment status from its **succeeded** refunds and apply
 * the side effects of a full refund.
 *
 * Full (cumulative succeeded refunds ≥ order total) flips the order to
 * `refunded` and — only on that single transition — restocks variants, releases
 * reserved prints and recomputes VIP (which may now be revoked). Partial marks
 * the order `partially_refunded` (still a completed purchase). Idempotent: the
 * status flip is a compare-and-set, so a replayed webhook never restocks twice.
 * Returns the resulting order payment status.
 */
export async function applyRefundEffects(orderId: string): Promise<string> {
  const [order] = await db
    .select({
      userId: orders.userId,
      totalTtc: orders.totalTtc,
      itemsJson: orders.itemsJson,
      paymentStatus: orders.paymentStatus,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)
  if (!order) return "unknown"

  const settled = await db
    .select({ amountTtc: refunds.amountTtc })
    .from(refunds)
    .where(and(eq(refunds.orderId, orderId), eq(refunds.status, "succeeded")))
  const refundedCents = settled.reduce((sum, r) => sum + toCents(r.amountTtc), 0)
  if (refundedCents <= 0) return await currentStatus(orderId)

  const isFull = refundedCents >= toCents(order.totalTtc)

  if (!isFull) {
    // Partial: keep the order paid, just flag it. Never downgrade a full refund.
    const [flagged] = await db
      .update(orders)
      .set({ paymentStatus: "partially_refunded", updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), inArray(orders.paymentStatus, ["received", "reconciled"])))
      .returning({ id: orders.id })
    if (flagged) {
      await recordOrderStatusChange(orderId, "payment", { from: order.paymentStatus, to: "partially_refunded" })
    }
    await recomputeVipStatus(order.userId)
    // A refund reduces what is owed to the beneficiaries in proportion — they
    // are not paid on money that went back to the customer (story 11.10).
    await settlePayoutsForOrder(orderId)
    return await currentStatus(orderId)
  }

  // Full refund: flip to `refunded` exactly once, then reverse the inventory.
  const flipped = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(orders)
      .set({ paymentStatus: "refunded", updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), ne(orders.paymentStatus, "refunded")))
      .returning({ id: orders.id })
    if (!row) return false // already refunded — idempotent no-op
    await recordOrderStatusChange(orderId, "payment", { from: order.paymentStatus, to: "refunded" }, tx)

    await releaseOrderInventory(tx, orderId, order.itemsJson)
    return true
  })

  if (flipped) await recomputeVipStatus(order.userId)
  // Fully refunded: the beneficiaries are owed nothing on this sale. Payouts an
  // admin has already settled are left alone — money out is a fact, not a
  // projection (story 11.10).
  await settlePayoutsForOrder(orderId)
  return "refunded"
}

async function currentStatus(orderId: string): Promise<string> {
  const [o] = await db
    .select({ paymentStatus: orders.paymentStatus })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)
  return o?.paymentStatus ?? "unknown"
}

/** Stripe's failure reason is a code (`lost_or_stolen_card`); anything else is not kept. */
function stripeRefundError(failureReason: string | null): string {
  return failureReason && /^[a-z_]+$/.test(failureReason) ? `stripe.${failureReason}` : "stripe.refund_failed"
}

/**
 * Finalise a Stripe refund from a webhook: flip a stored refund to its terminal
 * status and, when it succeeds, apply the order-level effects. Matched by Stripe
 * refund id, so an event for an unknown refund is a safe no-op. Idempotent.
 */
export async function settleStripeRefund(
  stripeRefundId: string,
  stripeStatus: string,
  log: Pick<FastifyBaseLogger, "info" | "warn">,
): Promise<void> {
  const [row] = await db.select().from(refunds).where(eq(refunds.stripeRefundId, stripeRefundId)).limit(1)
  if (!row) {
    log.warn({ stripeRefundId }, "Stripe event for an unknown refund — ignored")
    return
  }
  const logUpdate = () =>
    log.info({ orderId: row.orderId, stripeRefundId, status: stripeStatus }, "Stripe refund updated")

  // Stripe confirms what an admin asked for: nobody clicked this time.
  const recordSettlement = (status: "succeeded" | "failed" | "cancelled") =>
    recordAuditEvent({
      userRole: "system",
      entityType: "refund",
      entityId: row.id,
      orderId: row.orderId,
      action: `payment.refund.${status}`,
      result: status === "succeeded" ? "success" : "failure",
      error: status === "succeeded" ? null : `stripe.refund_${status}`,
      newValue: { stripeRefundId, amountTtc: row.amountTtc },
    })

  if (stripeStatus === "succeeded") {
    if (row.status === "succeeded") return // already applied
    await db
      .update(refunds)
      .set({ status: "succeeded", processedAt: new Date(), failureReason: null, updatedAt: new Date() })
      .where(eq(refunds.id, row.id))
    await recordSettlement("succeeded")
    await applyRefundEffects(row.orderId)
    await enqueueCreditNote(row.id)
    logUpdate()
    return
  }

  if (stripeStatus === "failed" || stripeStatus === "canceled") {
    const status = stripeStatus === "failed" ? "failed" : "cancelled"
    if (row.status === status) return // already recorded
    await db
      .update(refunds)
      .set({
        status,
        failureReason: stripeStatus === "failed" ? "Stripe reported the refund failed" : null,
        updatedAt: new Date(),
      })
      .where(eq(refunds.id, row.id))
    await recordSettlement(status)
    logUpdate()
  }
}

/** All refund rows for an order, newest first (admin view). */
export async function listOrderRefunds(orderId: string) {
  return db.select().from(refunds).where(eq(refunds.orderId, orderId)).orderBy(sql`${refunds.createdAt} DESC`)
}
