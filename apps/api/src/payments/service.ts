import {
  amountsMatchToCent,
  type ClaimVirementInput,
  extractTransferReference,
  PAID_PAYMENT_STATUSES,
  parseBankStatementCsv,
  type ReconcileVirementInput,
} from "@armurier/shared"
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import type Stripe from "stripe"
import { recordAuditEvent, recordOrderStatusChange } from "../audit/record.js"
import { db } from "../db/client.js"
import { orders, paymentCarte, paymentVirement } from "../db/schema.js"
import { enqueueInvoice } from "../henrri/queue.js"
import { recomputeOrderLegalStatus } from "../orders/legal-status.js"
import { settlePayoutsForOrder } from "../payouts/service.js"
import { settleStripeRefund } from "./refunds.js"
import { createPaymentIntent, retrieveCharge, retrievePaymentIntent } from "./stripe.js"

// Bank-transfer bucket states an admin (or CSV import) may still act on: the
// money has not been confirmed yet. A bucket already in PAID_PAYMENT_STATUSES is
// settled and must not be reconciled twice.
const RECONCILABLE_VIREMENT_STATUSES = ["awaiting_transfer", "transfer_claimed"] as const

/** Parse a bank-supplied date string, returning undefined for anything invalid. */
function safeDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d
}

export class PaymentError extends Error {
  constructor(
    readonly statusCode: number,
    readonly errorCode: string,
    message: string,
    /** Extra fields sent alongside the error, for the client to act on. */
    readonly details: Record<string, unknown> = {},
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
    .select({ id: orders.id, userId: orders.userId, paymentStatus: orders.paymentStatus })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)
  if (!order || order.userId !== userId) {
    throw new PaymentError(404, "NotFound", "Order not found")
  }
  if (order.paymentStatus === "cancelled") {
    throw new PaymentError(409, "OrderCancelled", "This order was cancelled")
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

  // Story 12.9g — concurrent initialisations (double click, two tabs) must end
  // on one intent. They share this idempotency key, so Stripe hands them all
  // the same intent; the key moves on once the stored intent is spent.
  const previousIntentId = carte.stripePaymentIntentId
  const intent = await createPaymentIntent(
    {
      amount: amountCents,
      currency: currency.toLowerCase(),
      metadata: { orderId, userId },
      automatic_payment_methods: { enabled: true },
    },
    { idempotencyKey: `payment-intent:${carte.id}:${previousIntentId ?? "first"}:${amountCents}` },
  )

  if (!intent.client_secret) {
    throw new PaymentError(502, "StripeError", "Stripe did not return a client secret")
  }

  // Compare-and-set: the first of them stores the intent, the others find it there.
  const [stored] = await db
    .update(paymentCarte)
    .set({ stripePaymentIntentId: intent.id, updatedAt: new Date() })
    .where(
      and(
        eq(paymentCarte.id, carte.id),
        previousIntentId
          ? eq(paymentCarte.stripePaymentIntentId, previousIntentId)
          : isNull(paymentCarte.stripePaymentIntentId),
      ),
    )
    .returning({ id: paymentCarte.id })
  if (!stored) {
    const [current] = await db
      .select({ intentId: paymentCarte.stripePaymentIntentId })
      .from(paymentCarte)
      .where(eq(paymentCarte.id, carte.id))
    if (current?.intentId !== intent.id) {
      throw new PaymentError(409, "PaymentInitConflict", "Another payment attempt started meanwhile; try again")
    }
    return {
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      amountTtc: carte.amountTtc,
      currency,
      reused: true,
    }
  }

  await recordAuditEvent({
    userId,
    entityType: "payment_carte",
    entityId: carte.id,
    orderId,
    action: "payment.stripe.init",
    newValue: { paymentIntentId: intent.id, amountTtc: carte.amountTtc },
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

/**
 * Record a customer's "I have sent the bank transfer" declaration on their
 * order's virement bucket.
 *
 * Ownership is enforced and reported as 404 so we never leak existence. The
 * declaration is advisory — it flips the bucket to `transfer_claimed` to help
 * the admin prioritise, but the authoritative settlement still comes from the
 * bank statement during reconciliation. A bucket that is already settled
 * (received/reconciled) is a 409; a card-only order is a 400.
 */
export async function claimVirementTransfer(orderId: string, userId: string, input: ClaimVirementInput) {
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
  if (PAID_PAYMENT_STATUSES.includes(virement.paymentStatus)) {
    throw new PaymentError(409, "AlreadyReconciled", "This bank transfer is already reconciled")
  }
  if (virement.paymentStatus === "failed" || virement.paymentStatus === "cancelled") {
    throw new PaymentError(409, "NotClaimable", `This bank transfer is ${virement.paymentStatus}`)
  }

  const [updated] = await db
    .update(paymentVirement)
    .set({
      paymentStatus: "transfer_claimed",
      clientReportedIban: input.reportedIban ?? null,
      clientReportedDate: input.reportedDate ?? null,
      clientReportedAmount: input.reportedAmount?.toFixed(2) ?? null,
      clientReportedRef: virement.paymentReference,
      clientNotes: input.notes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(paymentVirement.id, virement.id))
    .returning()

  await recordAuditEvent({
    userId,
    entityType: "payment_virement",
    entityId: virement.id,
    orderId: virement.orderId,
    action: "payment.virement.claimed",
    oldValue: { paymentStatus: virement.paymentStatus },
    newValue: { paymentStatus: "transfer_claimed", reportedAmount: input.reportedAmount ?? null },
  })

  return {
    reference: updated.paymentReference ?? "",
    amountTtc: updated.amountExpectedTtc,
    paymentStatus: updated.paymentStatus,
  }
}

export interface ReconcileResult {
  id: string
  orderId: string
  paymentStatus: string
  amountReceivedTtc: string | null
  amountMatched: boolean
}

/**
 * Settle a bank-transfer bucket: record the received amount/date/source IBAN and
 * flip it to `reconciled`, then recompute the order's overall payment status.
 *
 * Reusable core shared by the manual admin route and the CSV importer. The
 * status guard is repeated in the WHERE clause so two concurrent reconciliations
 * cannot both settle the same bucket. Returns whether the received amount
 * matched the expected amount to the cent — the caller decides what to surface;
 * the settlement happens regardless (the admin owns the decision to accept).
 */
export async function reconcileVirementBucket(
  virementId: string,
  input: { amountReceivedTtc: string; receivedFromIban?: string | null; receivedAt?: Date; notes?: string | null },
  adminId: string,
): Promise<ReconcileResult> {
  const [virement] = await db.select().from(paymentVirement).where(eq(paymentVirement.id, virementId)).limit(1)
  if (!virement) {
    throw new PaymentError(404, "NotFound", "Bank-transfer record not found")
  }
  if (PAID_PAYMENT_STATUSES.includes(virement.paymentStatus)) {
    throw new PaymentError(409, "AlreadyReconciled", "This bank transfer is already reconciled")
  }

  const now = new Date()
  const [updated] = await db
    .update(paymentVirement)
    .set({
      paymentStatus: "reconciled",
      amountReceivedTtc: input.amountReceivedTtc,
      receivedAt: input.receivedAt ?? now,
      receivedFromIban: input.receivedFromIban ?? null,
      reconciledAt: now,
      reconciledBy: adminId,
      reconciliationNotes: input.notes ?? null,
      updatedAt: now,
    })
    // Repeat the guard so a concurrent reconcile cannot double-settle.
    .where(
      and(eq(paymentVirement.id, virement.id), inArray(paymentVirement.paymentStatus, RECONCILABLE_VIREMENT_STATUSES)),
    )
    .returning()
  if (!updated) {
    throw new PaymentError(409, "AlreadyReconciled", "This bank transfer was reconciled concurrently")
  }

  const amountMatched = amountsMatchToCent(Number(input.amountReceivedTtc), Number(virement.amountExpectedTtc))

  await recordAuditEvent({
    userId: adminId,
    userRole: "admin",
    entityType: "payment_virement",
    entityId: virement.id,
    orderId: virement.orderId,
    action: "payment.virement.reconciled",
    oldValue: { paymentStatus: virement.paymentStatus },
    newValue: {
      paymentStatus: "reconciled",
      amountReceivedTtc: input.amountReceivedTtc,
      amountExpectedTtc: virement.amountExpectedTtc,
      amountMatched,
    },
  })

  // Settled bucket → may flip the order to received (then VIP + legal workflow).
  await recomputeOrderPaymentStatus(virement.orderId)

  return {
    id: updated.id,
    orderId: updated.orderId,
    paymentStatus: updated.paymentStatus,
    amountReceivedTtc: updated.amountReceivedTtc,
    amountMatched,
  }
}

/** Adapt the admin manual-reconcile request body into the core reconcile call. */
export async function reconcileVirementManually(
  virementId: string,
  input: ReconcileVirementInput,
  adminId: string,
): Promise<ReconcileResult> {
  return reconcileVirementBucket(
    virementId,
    {
      amountReceivedTtc: input.amountReceived.toFixed(2),
      receivedFromIban: input.receivedFromIban ?? null,
      receivedAt: safeDate(input.receivedAt),
      notes: input.notes ?? null,
    },
    adminId,
  )
}

export type BankImportOutcome = "reconciled" | "amount_mismatch" | "unknown_reference" | "no_reference" | "not_a_credit"

export interface BankImportLine {
  label: string
  amount: number
  reference: string | null
  outcome: BankImportOutcome
  orderId?: string
  virementId?: string
  amountExpectedTtc?: string
}

export interface BankImportReport {
  total: number
  reconciled: number
  needsReview: number
  lines: BankImportLine[]
}

/**
 * Import a bank statement CSV and auto-reconcile incoming credits that match an
 * outstanding bank-transfer reference by amount.
 *
 * Conservative by design: a row is only auto-settled when (a) its label carries
 * one of our references, (b) that reference maps to a bucket still awaiting
 * payment, and (c) the credited amount matches the expected amount to the cent.
 * Anything else — no reference, unknown reference, debit, or amount mismatch —
 * is reported for manual review and never silently settled. Idempotent: a
 * statement re-imported after settlement reports the buckets as already paid
 * (unknown to the awaiting-set) rather than double-counting.
 */
export async function importBankStatement(csv: string, adminId: string): Promise<BankImportReport> {
  let transactions: ReturnType<typeof parseBankStatementCsv>
  try {
    transactions = parseBankStatementCsv(csv)
  } catch (err) {
    throw new PaymentError(400, "InvalidStatement", err instanceof Error ? err.message : "Unparseable bank statement")
  }

  const lines: BankImportLine[] = []
  let reconciled = 0

  for (const tx of transactions) {
    const reference = extractTransferReference(tx.label)
    const base: BankImportLine = { label: tx.label, amount: tx.amount, reference, outcome: "no_reference" }

    if (!reference) {
      lines.push(base)
      continue
    }
    if (tx.amount <= 0) {
      lines.push({ ...base, outcome: "not_a_credit" })
      continue
    }

    // Only an outstanding bucket can be reconciled — settled refs are not re-matched.
    const [virement] = await db
      .select()
      .from(paymentVirement)
      .where(
        and(
          eq(paymentVirement.paymentReference, reference),
          inArray(paymentVirement.paymentStatus, RECONCILABLE_VIREMENT_STATUSES),
        ),
      )
      .limit(1)
    if (!virement) {
      lines.push({ ...base, outcome: "unknown_reference" })
      continue
    }

    const expected = virement.amountExpectedTtc
    if (!amountsMatchToCent(tx.amount, Number(expected))) {
      lines.push({
        ...base,
        outcome: "amount_mismatch",
        orderId: virement.orderId,
        virementId: virement.id,
        amountExpectedTtc: expected,
      })
      continue
    }

    await reconcileVirementBucket(
      virement.id,
      {
        amountReceivedTtc: tx.amount.toFixed(2),
        receivedFromIban: tx.counterpartyIban,
        receivedAt: safeDate(tx.date),
        notes: "Auto-reconciled from bank statement import",
      },
      adminId,
    )
    reconciled++
    lines.push({
      ...base,
      outcome: "reconciled",
      orderId: virement.orderId,
      virementId: virement.id,
      amountExpectedTtc: expected,
    })
  }

  return { total: lines.length, reconciled, needsReview: lines.length - reconciled, lines }
}

type Logger = Pick<FastifyBaseLogger, "info" | "warn" | "error">

type CardDetails = { last4: string | null; brand: string | null }

const NO_CARD_DETAILS: CardDetails = { last4: null, brand: null }

/**
 * Pull last4/brand from the PaymentIntent's charge, best-effort. Webhook
 * payloads only carry `latest_charge` as an id, so the charge is fetched; a
 * failed lookup must never block settling a payment Stripe already collected.
 */
async function cardDetails(intent: Stripe.PaymentIntent, log: Logger): Promise<CardDetails> {
  const latestCharge = intent.latest_charge
  if (!latestCharge) return NO_CARD_DETAILS

  try {
    const charge = typeof latestCharge === "string" ? await retrieveCharge(latestCharge) : latestCharge
    const card = charge.payment_method_details?.card
    return { last4: card?.last4 ?? null, brand: card?.brand ?? null }
  } catch (err) {
    log.warn({ err, paymentIntentId: intent.id }, "Stripe charge lookup failed — card details left empty")
    return NO_CARD_DETAILS
  }
}

/**
 * Apply a verified Stripe webhook event to our payment state.
 *
 * Only the event types we care about mutate state; anything else is a no-op so
 * Stripe still receives a 200 and stops retrying. Matching is by stored
 * PaymentIntent id, so a webhook for a superseded intent is safely ignored.
 */
export async function handleStripeEvent(event: Stripe.Event, log: Logger): Promise<void> {
  log.info({ eventId: event.id, type: event.type }, "Stripe webhook received")
  switch (event.type) {
    case "payment_intent.succeeded": {
      const intent = event.data.object as Stripe.PaymentIntent
      const { last4, brand } = await cardDetails(intent, log)
      await settleCartePayment(
        log,
        intent.id,
        {
          paymentStatus: "received",
          processedAt: new Date(),
          last4,
          brand,
          failureReason: null,
        },
        // Defence-in-depth: assert Stripe actually collected at least the amount
        // due before marking the order paid (the intent is created server-side,
        // but never trust the webhook's effect without checking the figure).
        { paidAmountCents: intent.amount_received },
      )
      return
    }
    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent
      await settleCartePayment(
        log,
        intent.id,
        { paymentStatus: "failed", failureReason: intent.last_payment_error?.message ?? "Card payment failed" },
        { errorCode: declineCode(intent.last_payment_error) },
      )
      return
    }
    case "payment_intent.canceled": {
      const intent = event.data.object as Stripe.PaymentIntent
      await settleCartePayment(log, intent.id, { paymentStatus: "cancelled" }, { errorCode: "stripe.canceled" })
      return
    }
    // `charge.refunded` is deliberately not handled: its charge no longer
    // inlines `refunds`, and every status change already arrives as a refund event.
    case "refund.updated":
    case "refund.created": {
      const refund = event.data.object as Stripe.Refund
      await settleStripeRefund(refund.id, refund.status ?? "", log)
      return
    }
    default:
      return
  }
}

type CarteUpdate = Partial<typeof paymentCarte.$inferInsert>

/** PAID_PAYMENT_STATUSES, typed as the card bucket's own statuses for queries. */
const SETTLED_CARTE_STATUSES = paymentCarte.paymentStatus.enumValues.filter((status) =>
  PAID_PAYMENT_STATUSES.includes(status),
)

interface CarteSettlement {
  /** What Stripe reports as collected, checked against what is due. */
  paidAmountCents?: number
  /** Set when the payment did not go through: the event is then a failure. */
  errorCode?: string
}

/**
 * Stripe's most precise code for a refused card (`insufficient_funds` before
 * `card_declined`). Its message is never kept in the history: it is free text.
 */
function declineCode(error: Stripe.PaymentIntent.LastPaymentError | null | undefined): string {
  return `stripe.${error?.decline_code ?? error?.code ?? "payment_failed"}`
}

async function settleCartePayment(
  log: Logger,
  paymentIntentId: string,
  update: CarteUpdate,
  settlement: CarteSettlement = {},
): Promise<void> {
  const { paidAmountCents } = settlement
  const [carte] = await db
    .select({ id: paymentCarte.id, orderId: paymentCarte.orderId, amountTtc: paymentCarte.amountTtc })
    .from(paymentCarte)
    .where(eq(paymentCarte.stripePaymentIntentId, paymentIntentId))
    .limit(1)
  if (!carte) {
    log.warn({ paymentIntentId }, "Stripe event for an unknown PaymentIntent — ignored")
    return
  }

  // Guard against settling an order for less than its due amount. If the figure
  // Stripe reports as collected falls short, do NOT mark the order paid: record
  // the discrepancy for an operator and leave the bucket untouched (no retry
  // storm — the amount won't change on a webhook redelivery).
  if (update.paymentStatus === "received" && paidAmountCents !== undefined) {
    const expectedCents = Math.round(Number(carte.amountTtc) * 100)
    if (paidAmountCents < expectedCents) {
      log.error(
        { orderId: carte.orderId, paymentIntentId, expectedCents, paidAmountCents },
        "Stripe collected less than the order total — not marked paid",
      )
      await recordAuditEvent({
        userRole: "system",
        entityType: "payment_carte",
        entityId: carte.id,
        orderId: carte.orderId,
        action: "payment.stripe.amount_mismatch",
        result: "failure",
        error: "stripe.amount_short",
        newValue: { paymentIntentId, expectedCents, paidAmountCents },
      })
      return
    }
  }

  // Story 12.9g — Stripe does not promise delivery order: a failure or a
  // cancellation that lands after the success must not undo a settled payment.
  const settles = update.paymentStatus !== undefined && PAID_PAYMENT_STATUSES.includes(update.paymentStatus)
  const [applied] = await db
    .update(paymentCarte)
    .set({ ...update, updatedAt: new Date() })
    .where(
      and(
        eq(paymentCarte.id, carte.id),
        settles ? undefined : notInArray(paymentCarte.paymentStatus, SETTLED_CARTE_STATUSES),
      ),
    )
    .returning({ id: paymentCarte.id })
  if (!applied) {
    log.warn(
      { orderId: carte.orderId, paymentIntentId, status: update.paymentStatus },
      "Stripe event arrived after the card payment settled — ignored",
    )
    return
  }

  await recordAuditEvent({
    userRole: "system",
    entityType: "payment_carte",
    entityId: carte.id,
    orderId: carte.orderId,
    action: `payment.stripe.${update.paymentStatus}`,
    result: settlement.errorCode ? "failure" : "success",
    error: settlement.errorCode ?? null,
    newValue: { paymentIntentId },
  })
  log.info({ orderId: carte.orderId, paymentIntentId, status: update.paymentStatus }, "Stripe card payment updated")

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

  // Cancelled for lack of payment (story 12.9a), its stock back on sale: money
  // landing now must not revive it. SCS sees it in the history and refunds.
  if (order.paymentStatus === "cancelled") {
    const paidBucket = [carte, virement].some(
      (bucket) => bucket && PAID_PAYMENT_STATUSES.includes(bucket.paymentStatus),
    )
    if (paidBucket) {
      await recordAuditEvent({
        userRole: "system",
        entityType: "order",
        entityId: orderId,
        orderId,
        action: "payment.received_after_cancellation",
        result: "failure",
        error: "order.cancelled",
      })
    }
    return
  }

  const carteSatisfied = !carte || PAID_PAYMENT_STATUSES.includes(carte.paymentStatus)
  const virementDue = order.itemsJson.some((i) => i.requiresPaymentVirement)
  const virementSatisfied = !virementDue || (!!virement && PAID_PAYMENT_STATUSES.includes(virement.paymentStatus))

  if (!carteSatisfied || !virementSatisfied) return

  // Compare-and-set: of two webhooks settling the last bucket at once, one moves the order.
  const [flipped] = await db
    .update(orders)
    .set({ paymentStatus: "received", updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.paymentStatus, order.paymentStatus)))
    .returning({ id: orders.id })
  if (!flipped) return
  await recordOrderStatusChange(orderId, "payment", { from: order.paymentStatus, to: "received" })

  // The money landed: what was owed becomes due (story 11.10).
  await settlePayoutsForOrder(orderId)

  // Fully paid: one invoice, issued in Henrri by the queue (story 12.6).
  await enqueueInvoice(orderId)

  // Paid order → advances the legal workflow, which grants VIP once the order
  // is complete (paid AND documents validated, story 12.9e).
  await recomputeOrderLegalStatus(order.userId)
}
