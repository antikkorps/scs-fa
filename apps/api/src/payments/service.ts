import { PAID_PAYMENT_STATUSES } from "@armurier/shared"
import { eq } from "drizzle-orm"
import type Stripe from "stripe"
import { db } from "../db/client.js"
import { auditLogs, orders, paymentCarte, paymentVirement } from "../db/schema.js"
import { recomputeOrderLegalStatus } from "../orders/legal-status.js"
import { recomputeVipStatus } from "../vip/service.js"
import { createPaymentIntent, retrievePaymentIntent } from "./stripe.js"

export class PaymentError extends Error {
  constructor(
    readonly statusCode: number,
    readonly errorCode: string,
    message: string,
  ) {
    super(message)
  }
}

// A PaymentIntent in one of these states is still usable: we can hand its
// existing client_secret back instead of creating a duplicate intent.
const REUSABLE_INTENT_STATUSES = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "processing",
])

export interface StripePaymentInit {
  clientSecret: string
  paymentIntentId: string
  amountTtc: string
  currency: string
  /** True when an existing pending intent was reused rather than created. */
  reused: boolean
}

/**
 * Create (or reuse) a Stripe PaymentIntent for the card-payable portion of an
 * order and return its client secret for the front to confirm.
 *
 * Ownership is enforced; an order the caller does not own is reported as 404 so
 * we never leak existence. Idempotent: calling twice on a still-pending order
 * returns the same intent rather than stacking duplicates.
 */
export async function initStripePayment(orderId: string, userId: string): Promise<StripePaymentInit> {
  const [order] = await db
    .select({ id: orders.id, userId: orders.userId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)
  if (!order || order.userId !== userId) {
    throw new PaymentError(404, "NotFound", "Order not found")
  }

  const [carte] = await db.select().from(paymentCarte).where(eq(paymentCarte.orderId, orderId)).limit(1)
  if (!carte) {
    throw new PaymentError(400, "NoCardPayment", "This order has no card-payable amount")
  }
  if (PAID_PAYMENT_STATUSES.includes(carte.paymentStatus)) {
    throw new PaymentError(409, "AlreadyPaid", "This order's card payment is already settled")
  }

  const currency = carte.currency ?? "EUR"
  const amountCents = Math.round(Number(carte.amountTtc) * 100)

  // Idempotency: reuse a still-pending intent rather than creating a duplicate.
  if (carte.stripePaymentIntentId) {
    const existing = await retrievePaymentIntent(carte.stripePaymentIntentId)
    if (existing.status === "succeeded") {
      throw new PaymentError(409, "AlreadyPaid", "This order's card payment is already settled")
    }
    if (REUSABLE_INTENT_STATUSES.has(existing.status) && existing.client_secret) {
      return {
        clientSecret: existing.client_secret,
        paymentIntentId: existing.id,
        amountTtc: carte.amountTtc,
        currency,
        reused: true,
      }
    }
  }

  const intent = await createPaymentIntent({
    amount: amountCents,
    currency: currency.toLowerCase(),
    metadata: { orderId, userId },
    automatic_payment_methods: { enabled: true },
  })

  if (!intent.client_secret) {
    throw new PaymentError(502, "StripeError", "Stripe did not return a client secret")
  }

  await db
    .update(paymentCarte)
    .set({ stripePaymentIntentId: intent.id, updatedAt: new Date() })
    .where(eq(paymentCarte.id, carte.id))

  await db.insert(auditLogs).values({
    userId,
    entityType: "payment_carte",
    entityId: carte.id,
    action: "payment.stripe.init",
    newValue: { orderId, paymentIntentId: intent.id, amountTtc: carte.amountTtc },
  })

  return {
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    amountTtc: carte.amountTtc,
    currency,
    reused: false,
  }
}

export interface VirementInstructions {
  reference: string
  amountTtc: string
  currency: string
  iban: string
  bic: string | null
  bankName: string | null
  accountHolder: string | null
  paymentStatus: string
}

/**
 * Return the bank-transfer (RIB) instructions for an order: the SCS receiving
 * account snapshotted at creation plus the order's unique payment reference and
 * expected amount.
 *
 * Ownership is enforced and reported as 404 so we never leak existence. An order
 * with no bank-transfer bucket (card-only) is a 400 — there is nothing to wire.
 */
export async function getVirementInstructions(orderId: string, userId: string): Promise<VirementInstructions> {
  const [order] = await db
    .select({ id: orders.id, userId: orders.userId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)
  if (!order || order.userId !== userId) {
    throw new PaymentError(404, "NotFound", "Order not found")
  }

  const [virement] = await db.select().from(paymentVirement).where(eq(paymentVirement.orderId, orderId)).limit(1)
  if (!virement) {
    throw new PaymentError(400, "NoBankTransfer", "This order has no bank-transfer amount")
  }

  return {
    reference: virement.paymentReference ?? "",
    amountTtc: virement.amountExpectedTtc,
    currency: virement.currency ?? "EUR",
    iban: virement.ibanRecipient,
    bic: virement.bicRecipient,
    bankName: virement.bankName,
    accountHolder: virement.accountHolderName,
    paymentStatus: virement.paymentStatus,
  }
}

/** Pull last4/brand from a PaymentIntent's card details, best-effort. */
function cardDetails(intent: Stripe.PaymentIntent): { last4: string | null; brand: string | null } {
  // Depending on the API version, the charge may be inlined under `charges`.
  const charge = (
    intent as unknown as {
      charges?: { data?: Array<{ payment_method_details?: { card?: { last4?: string; brand?: string } } }> }
    }
  ).charges?.data?.[0]
  const card = charge?.payment_method_details?.card
  return { last4: card?.last4 ?? null, brand: card?.brand ?? null }
}

/**
 * Apply a verified Stripe webhook event to our payment state.
 *
 * Only the event types we care about mutate state; anything else is a no-op so
 * Stripe still receives a 200 and stops retrying. Matching is by stored
 * PaymentIntent id, so a webhook for a superseded intent is safely ignored.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "payment_intent.succeeded": {
      const intent = event.data.object as Stripe.PaymentIntent
      const { last4, brand } = cardDetails(intent)
      await settleCartePayment(intent.id, {
        paymentStatus: "received",
        processedAt: new Date(),
        last4,
        brand,
        failureReason: null,
      })
      return
    }
    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent
      await settleCartePayment(intent.id, {
        paymentStatus: "failed",
        failureReason: intent.last_payment_error?.message ?? "Card payment failed",
      })
      return
    }
    case "payment_intent.canceled": {
      const intent = event.data.object as Stripe.PaymentIntent
      await settleCartePayment(intent.id, { paymentStatus: "cancelled" })
      return
    }
    default:
      return
  }
}

type CarteUpdate = Partial<typeof paymentCarte.$inferInsert>

async function settleCartePayment(paymentIntentId: string, update: CarteUpdate): Promise<void> {
  const [carte] = await db
    .select({ id: paymentCarte.id, orderId: paymentCarte.orderId })
    .from(paymentCarte)
    .where(eq(paymentCarte.stripePaymentIntentId, paymentIntentId))
    .limit(1)
  if (!carte) return // unknown / superseded intent — nothing to do

  await db
    .update(paymentCarte)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(paymentCarte.id, carte.id))

  await db.insert(auditLogs).values({
    entityType: "payment_carte",
    entityId: carte.id,
    action: `payment.stripe.${update.paymentStatus}`,
    newValue: { orderId: carte.orderId, paymentIntentId },
  })

  await recomputeOrderPaymentStatus(carte.orderId)
}

/**
 * Recompute an order's overall payment status from its payment rows.
 *
 * An order is `received` only once every due bucket is settled: the card bucket
 * (a `payment_carte` row, Story 6.1) and — when the order contains regulated
 * firearms — the bank-transfer bucket (a `payment_virement` row, Story 6.2).
 * Until both are in, the order keeps its current status. Idempotent.
 *
 * Flipping to `received` is the trigger that activates VIP eligibility and
 * advances the legal workflow.
 */
export async function recomputeOrderPaymentStatus(orderId: string): Promise<void> {
  const [order] = await db
    .select({ userId: orders.userId, paymentStatus: orders.paymentStatus, itemsJson: orders.itemsJson })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)
  if (!order) return
  if (PAID_PAYMENT_STATUSES.includes(order.paymentStatus)) return // already settled

  const [carte] = await db
    .select({ paymentStatus: paymentCarte.paymentStatus })
    .from(paymentCarte)
    .where(eq(paymentCarte.orderId, orderId))
    .limit(1)
  const [virement] = await db
    .select({ paymentStatus: paymentVirement.paymentStatus })
    .from(paymentVirement)
    .where(eq(paymentVirement.orderId, orderId))
    .limit(1)

  const carteSatisfied = !carte || PAID_PAYMENT_STATUSES.includes(carte.paymentStatus)
  const virementDue = order.itemsJson.some((i) => i.requiresPaymentVirement)
  const virementSatisfied = !virementDue || (!!virement && PAID_PAYMENT_STATUSES.includes(virement.paymentStatus))

  if (!carteSatisfied || !virementSatisfied) return

  await db.update(orders).set({ paymentStatus: "received", updatedAt: new Date() }).where(eq(orders.id, orderId))

  // Paid order → may unlock VIP and advance the legal workflow.
  await recomputeVipStatus(order.userId)
  await recomputeOrderLegalStatus(order.userId)
}
