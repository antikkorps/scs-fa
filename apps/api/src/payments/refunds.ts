import {
  type CreateRefundInput,
  PAID_PAYMENT_STATUSES,
  type RefundChannel,
  type RefundKindValue,
} from "@armurier/shared"
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm"
import { db } from "../db/client.js"
import {
  artworkPrints,
  auditLogs,
  orders,
  paymentCarte,
  paymentVirement,
  productVariants,
  refunds,
} from "../db/schema.js"
import {
  nearestExpressibleRefunds,
  type RefundRecord,
  refundedAmountOf,
  remainingToCredit,
} from "../henrri/credit-notes.js"
import { buildInvoiceDraft, type DraftRefusal } from "../henrri/documents.js"
import { enqueueCreditNote } from "../henrri/queue.js"
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

/**
 * Issue a refund on a paid order, on the card (Stripe) or bank-transfer channel.
 *
 * Card refunds go through Stripe and may settle asynchronously (pending →
 * succeeded via webhook); bank-transfer refunds are recorded as already
 * succeeded — the actual wire-back happens out of band, the admin asserts it.
 * The amount is capped at what is still refundable on the channel. A refund that
 * settles immediately triggers the order-level effects (full → `refunded` with
 * stock/print restock + VIP recompute; partial → `partially_refunded`).
 */
export async function createOrderRefund(
  orderId: string,
  input: CreateRefundInput,
  adminId: string,
): Promise<RefundResult> {
  const plan = await planRefund(orderId, input)
  const [order] = await db
    .select({ paymentStatus: orders.paymentStatus })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)

  const amountTtc = plan.amountTtc.toFixed(2)
  let status: "pending" | "succeeded" | "failed" | "cancelled" = "succeeded"
  let stripeRefundId: string | null = null
  let failureReason: string | null = null

  if (input.channel === "carte") {
    const [carte] = await db
      .select({ intentId: paymentCarte.stripePaymentIntentId })
      .from(paymentCarte)
      .where(eq(paymentCarte.orderId, orderId))
      .limit(1)
    if (!carte?.intentId) {
      throw new PaymentError(409, "NoPaymentIntent", "Card payment has no Stripe PaymentIntent to refund")
    }
    const refund = await stripeCreateRefund({
      payment_intent: carte.intentId,
      amount: toCents(plan.amountTtc),
      metadata: { orderId, initiatedBy: adminId },
    })
    stripeRefundId = refund.id
    // Stripe statuses: succeeded | pending | failed | canceled | requires_action
    status = refund.status === "succeeded" ? "succeeded" : refund.status === "pending" ? "pending" : "failed"
    if (status === "failed") failureReason = refund.failure_reason ?? "Stripe refund did not succeed"
  }

  const settledNow = status === "succeeded"
  const [row] = await db
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
      initiatedBy: adminId,
      processedAt: settledNow ? new Date() : null,
    })
    .returning()

  await db.insert(auditLogs).values({
    userId: adminId,
    entityType: "refund",
    entityId: row.id,
    action: `payment.refund.${status}`,
    newValue: { orderId, channel: input.channel, amountTtc, stripeRefundId },
  })

  // A refund that is already settled moves the order and gets its credit note; a
  // pending card refund waits for the webhook before any of it.
  const orderPaymentStatus = settledNow ? await applyRefundEffects(orderId) : (order?.paymentStatus ?? "unknown")
  if (settledNow) await enqueueCreditNote(row.id)

  return {
    id: row.id,
    orderId,
    kind: input.kind,
    channel: input.channel,
    amountTtc,
    status,
    stripeRefundId,
    orderPaymentStatus,
  }
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
    .select({ userId: orders.userId, totalTtc: orders.totalTtc, itemsJson: orders.itemsJson })
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
    await db
      .update(orders)
      .set({ paymentStatus: "partially_refunded", updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), inArray(orders.paymentStatus, ["received", "reconciled"])))
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

    for (const item of order.itemsJson) {
      if (item.variantId) {
        await tx
          .update(productVariants)
          .set({ stockQty: sql`${productVariants.stockQty} + ${item.qty}`, updatedAt: new Date() })
          .where(eq(productVariants.id, item.variantId))
      }
      if (item.printId) {
        await tx
          .update(artworkPrints)
          .set({ status: "available", orderId: null, updatedAt: new Date() })
          .where(and(eq(artworkPrints.id, item.printId), eq(artworkPrints.orderId, orderId)))
      }
    }
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

/**
 * Finalise a Stripe refund from a webhook: flip a stored refund to its terminal
 * status and, when it succeeds, apply the order-level effects. Matched by Stripe
 * refund id, so an event for an unknown refund is a safe no-op. Idempotent.
 */
export async function settleStripeRefund(stripeRefundId: string, stripeStatus: string): Promise<void> {
  const [row] = await db.select().from(refunds).where(eq(refunds.stripeRefundId, stripeRefundId)).limit(1)
  if (!row) return

  if (stripeStatus === "succeeded") {
    if (row.status === "succeeded") return // already applied
    await db
      .update(refunds)
      .set({ status: "succeeded", processedAt: new Date(), failureReason: null, updatedAt: new Date() })
      .where(eq(refunds.id, row.id))
    await applyRefundEffects(row.orderId)
    await enqueueCreditNote(row.id)
    return
  }

  if (stripeStatus === "failed" || stripeStatus === "canceled") {
    await db
      .update(refunds)
      .set({
        status: stripeStatus === "failed" ? "failed" : "cancelled",
        failureReason: stripeStatus === "failed" ? "Stripe reported the refund failed" : null,
        updatedAt: new Date(),
      })
      .where(eq(refunds.id, row.id))
  }
}

/** All refund rows for an order, newest first (admin view). */
export async function listOrderRefunds(orderId: string) {
  return db.select().from(refunds).where(eq(refunds.orderId, orderId)).orderBy(sql`${refunds.createdAt} DESC`)
}
