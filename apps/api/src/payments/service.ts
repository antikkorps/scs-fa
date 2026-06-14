import {
  amountsMatchToCent,
  type ClaimVirementInput,
  extractTransferReference,
  PAID_PAYMENT_STATUSES,
  parseBankStatementCsv,
  type ReconcileVirementInput,
} from "@armurier/shared"
import { and, eq, inArray } from "drizzle-orm"
import type Stripe from "stripe"
import { db } from "../db/client.js"
import { auditLogs, orders, paymentCarte, paymentVirement } from "../db/schema.js"
import { recomputeOrderLegalStatus } from "../orders/legal-status.js"
import { recomputeVipStatus } from "../vip/service.js"
import { settleStripeRefund } from "./refunds.js"
import { createPaymentIntent, retrievePaymentIntent } from "./stripe.js"

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

  await db.insert(auditLogs).values({
    userId,
    entityType: "payment_virement",
    entityId: virement.id,
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

  await db.insert(auditLogs).values({
    userId: adminId,
    entityType: "payment_virement",
    entityId: virement.id,
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
    case "refund.updated":
    case "refund.created": {
      const refund = event.data.object as Stripe.Refund
      await settleStripeRefund(refund.id, refund.status ?? "")
      return
    }
    case "charge.refunded": {
      // The charge carries its refunds inline; settle each one we know about.
      const charge = event.data.object as Stripe.Charge
      for (const refund of charge.refunds?.data ?? []) {
        await settleStripeRefund(refund.id, refund.status ?? "")
      }
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
