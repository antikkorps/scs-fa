// Story 12.6 — the queue that turns paid orders into Henrri invoices and
// refunds into credit notes. A Henrri outage never blocks a sale: documents wait
// in `henrri_documents` and each pass picks up where the last one stopped.
//
// Idempotence rests on the Henrri draft id, stored as soon as the draft exists
// (the API has no external reference): a later pass reads it back first and
// either records a number Henrri already gave, finalizes a draft that is already
// right, or rebuilds it.
//
// Safety under concurrency (audit 2026-10-14): a pass claims a row with a token,
// and every write it makes checks that token — a pass whose claim was taken over
// (Henrri slow, process paused) can no longer overwrite anything. Each write also
// renews the claim. Henrri allows about 100 calls an hour, so a pass stops at the
// first sign of trouble instead of spending calls on a Henrri that cannot answer.

import { randomUUID } from "node:crypto"
import { orderReference } from "@armurier/shared"
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm"
import type { FastifyBaseLogger, FastifyInstance } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { henrriDocuments, orders, paymentCarte, paymentVirement, refunds, users } from "../db/schema.js"
import { sendInvoiceAvailableEmail } from "../email.js"
import { env } from "../env.js"
import { type HenrriBuyer, type HenrriClient, HenrriError, henrriClientFromConfig } from "./client.js"
import { creditNoteFor, type RefundRecord } from "./credit-notes.js"
import { buildInvoiceDraft, type DocumentDraft, type DraftResult } from "./documents.js"

type Logger = Pick<FastifyBaseLogger, "info" | "warn" | "error">
type HenrriDocumentRow = typeof henrriDocuments.$inferSelect

/** A claim not renewed for this long is considered abandoned (process killed mid-pass). */
const CLAIM_TIMEOUT_MINUTES = 10

/** Orders whose payment makes them invoiceable, refunded ones included: they were sold. */
const PAID_STATUSES = ["received", "reconciled", "partially_refunded", "refunded"] as const

export type ProcessOutcome = "finalized" | "held" | "waiting" | "blocked" | "retry" | "skipped"

/** The row was taken over by another pass: this one must stop writing at once. */
class ClaimLost extends Error {}

interface Claim {
  id: string
  token: string
}

/** Queue the invoice of an order that has just become fully paid. Idempotent. */
export async function enqueueInvoice(orderId: string): Promise<void> {
  const [order] = await db.select({ totalTtc: orders.totalTtc }).from(orders).where(eq(orders.id, orderId)).limit(1)
  if (!order) return
  await db
    .insert(henrriDocuments)
    .values({ orderId, kind: "invoice", expectedTotalTtc: order.totalTtc })
    .onConflictDoNothing()
}

/**
 * Queue the credit note of a refund that has just succeeded. Idempotent. An
 * order without an invoice yet gets none now: the catch-up of a later pass
 * queues it once the invoice exists.
 */
export async function enqueueCreditNote(refundId: string): Promise<void> {
  const [refund] = await db
    .select({ orderId: refunds.orderId, amountTtc: refunds.amountTtc, kind: refunds.kind })
    .from(refunds)
    .where(eq(refunds.id, refundId))
    .limit(1)
  // Money paid in excess going back does not reduce the sale: no credit note (decision 2026-10-14).
  if (!refund || refund.kind === "overpayment") return
  const [invoice] = await db
    .select({ id: henrriDocuments.id })
    .from(henrriDocuments)
    .where(and(eq(henrriDocuments.orderId, refund.orderId), eq(henrriDocuments.kind, "invoice")))
    .limit(1)
  if (!invoice) return
  await db
    .insert(henrriDocuments)
    .values({ orderId: refund.orderId, refundId, kind: "credit_note", expectedTotalTtc: refund.amountTtc })
    .onConflictDoNothing()
}

/**
 * Catch-up: queues what a trigger may have missed (a crash between an order
 * turning paid and its enqueue, a webhook replayed after the refund was marked
 * succeeded). Orders placed before the 12.6 snapshot are left out: they cannot
 * be invoiced automatically.
 */
export async function enqueueMissingDocuments(): Promise<void> {
  await db.execute(sql`
    INSERT INTO henrri_documents (order_id, kind, expected_total_ttc)
    SELECT o.id, 'invoice', o.total_ttc FROM orders o
    WHERE o.payment_status IN (${sql.join(
      PAID_STATUSES.map((status) => sql`${status}`),
      sql`, `,
    )})
      AND o.shipping_portions IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM henrri_documents d WHERE d.order_id = o.id AND d.kind = 'invoice')
    ON CONFLICT DO NOTHING`)
  await db.execute(sql`
    INSERT INTO henrri_documents (order_id, refund_id, kind, expected_total_ttc)
    SELECT r.order_id, r.id, 'credit_note', r.amount_ttc FROM refunds r
    WHERE r.status = 'succeeded'
      AND r.kind <> 'overpayment'
      AND EXISTS (SELECT 1 FROM henrri_documents d WHERE d.order_id = r.order_id AND d.kind = 'invoice')
      AND NOT EXISTS (SELECT 1 FROM henrri_documents d WHERE d.refund_id = r.id)
    ON CONFLICT DO NOTHING`)
}

/** A plain date in Paris, as Henrri expects for payments. */
function parisDate(at: Date | null): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(at ?? new Date())
}

function toCents(amount: number | string): number {
  return Math.round(Number(amount) * 100)
}

function euros(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** The rows a pass works on: unfinished documents, unrecorded payments, untold buyers. */
function workToDo() {
  return or(
    inArray(henrriDocuments.status, ["pending", "draft"]),
    and(
      eq(henrriDocuments.status, "finalized"),
      eq(henrriDocuments.kind, "invoice"),
      isNull(henrriDocuments.paymentRecordedAt),
      isNull(henrriDocuments.heldAt),
    ),
    and(eq(henrriDocuments.status, "finalized"), isNull(henrriDocuments.customerNotifiedAt)),
  )
}

function claimIsFree() {
  return or(
    isNull(henrriDocuments.claimedAt),
    lt(henrriDocuments.claimedAt, sql`now() - make_interval(mins => ${CLAIM_TIMEOUT_MINUTES})`),
  )
}

async function claim(documentId: string): Promise<{ claim: Claim; row: HenrriDocumentRow } | null> {
  const token = randomUUID()
  const [row] = await db
    .update(henrriDocuments)
    .set({
      claimToken: token,
      // Written by Postgres, compared with Postgres' now(): no clock or zone skew.
      claimedAt: sql`now()`,
      attempts: sql`${henrriDocuments.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(henrriDocuments.id, documentId), workToDo(), claimIsFree()))
    .returning()
  return row ? { claim: { id: row.id, token }, row } : null
}

/** Writes on a claimed row, renewing the claim — or throws ClaimLost if it was taken over. */
async function write(claimed: Claim, values: Partial<HenrriDocumentRow>) {
  const [row] = await db
    .update(henrriDocuments)
    .set({ ...values, claimedAt: sql`now()`, updatedAt: new Date() })
    .where(and(eq(henrriDocuments.id, claimed.id), eq(henrriDocuments.claimToken, claimed.token)))
    .returning({ id: henrriDocuments.id })
  if (!row) throw new ClaimLost()
}

/** Last write of a pass on a row: hands it back to the queue. */
async function release(claimed: Claim, values: Partial<HenrriDocumentRow>) {
  await write(claimed, values)
  await db
    .update(henrriDocuments)
    .set({ claimedAt: null, claimToken: null })
    .where(and(eq(henrriDocuments.id, claimed.id), eq(henrriDocuments.claimToken, claimed.token)))
}

async function block(claimed: Claim, reason: string): Promise<ProcessOutcome> {
  await release(claimed, { status: "blocked", lastError: reason })
  await recordDocumentStep(claimed.id, "blocked", { reason })
  return "blocked"
}

/** An issued document that needs a human: it stays issued, the queue leaves it alone. */
async function hold(claimed: Claim, reason: string): Promise<ProcessOutcome> {
  await release(claimed, { heldAt: new Date(), lastError: reason })
  await recordDocumentStep(claimed.id, "held", { reason })
  return "held"
}

/**
 * A step worth an admin's attention, in the order's history (story 12.7b): issued,
 * or stopped for a human. A deferral is not one — the next pass tries again. The
 * reason keeps only its code: Henrri's message is free text.
 */
async function recordDocumentStep(
  documentId: string,
  step: "issued" | "blocked" | "held",
  detail: { number?: string; reason?: string },
) {
  const [document] = await db
    .select({ orderId: henrriDocuments.orderId, kind: henrriDocuments.kind })
    .from(henrriDocuments)
    .where(eq(henrriDocuments.id, documentId))
  if (!document) return
  const code = detail.reason?.split(":")[0].trim()
  await recordAuditEvent({
    userRole: "system",
    entityType: "henrri_document",
    entityId: documentId,
    orderId: document.orderId,
    action: `henrri.${document.kind}.${step}`,
    result: step === "issued" ? "success" : "failure",
    error: code ? `henrri.${code}` : null,
    newValue: detail.number ? { number: detail.number } : undefined,
  })
}

interface Payment {
  cents: number
  date: string
}

interface OrderContext {
  orderId: string
  userId: string
  email: string
  henrriCustomerId: number | null
  henrriCustomerFingerprint: string | null
  buyer: HenrriBuyer | null
  source: Parameters<typeof buildInvoiceDraft>[0]
  card: Payment
  transfer: Payment
}

async function loadOrder(orderId: string): Promise<OrderContext | null> {
  const [row] = await db
    .select({
      order: orders,
      email: users.email,
      henrriCustomerId: users.henrriCustomerId,
      henrriCustomerFingerprint: users.henrriCustomerFingerprint,
      cardTtc: paymentCarte.amountTtc,
      cardPaidAt: paymentCarte.processedAt,
      transferExpectedTtc: paymentVirement.amountExpectedTtc,
      transferReceivedTtc: paymentVirement.amountReceivedTtc,
      transferReceivedAt: paymentVirement.receivedAt,
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .leftJoin(paymentCarte, eq(paymentCarte.orderId, orders.id))
    .leftJoin(paymentVirement, eq(paymentVirement.orderId, orders.id))
    .where(eq(orders.id, orderId))
    .limit(1)
  if (!row) return null
  const { order } = row
  const address = order.billingAddress ?? order.shippingAddress
  return {
    orderId,
    userId: order.userId,
    email: row.email,
    henrriCustomerId: row.henrriCustomerId,
    henrriCustomerFingerprint: row.henrriCustomerFingerprint,
    buyer: address
      ? {
          firstName: address.firstName,
          lastName: address.lastName,
          address: {
            line1: address.line1,
            line2: address.line2,
            postal: address.postal,
            city: address.city,
            country: address.country,
          },
        }
      : null,
    source: { itemsJson: order.itemsJson, shippingPortions: order.shippingPortions, totalTtc: Number(order.totalTtc) },
    card: { cents: toCents(row.cardTtc ?? 0), date: parisDate(row.cardPaidAt) },
    transfer: {
      cents: toCents(row.transferReceivedTtc ?? row.transferExpectedTtc ?? 0),
      date: parisDate(row.transferReceivedAt),
    },
  }
}

/**
 * The buyer's Henrri customer: created once, then rewritten only when the name
 * or billing address changed (each call counts against Henrri's hourly limit),
 * and created again if Henrri no longer knows it.
 */
async function ensureCustomer(client: HenrriClient, context: OrderContext, buyer: HenrriBuyer): Promise<number> {
  const fingerprint = JSON.stringify(buyer)
  let customerId = context.henrriCustomerId
  if (customerId !== null && fingerprint === context.henrriCustomerFingerprint) return customerId

  if (customerId !== null) {
    try {
      await client.updateCustomer(customerId, buyer)
    } catch (error) {
      if (!(error instanceof HenrriError) || error.status !== 404) throw error
      customerId = null
    }
  }
  customerId ??= await client.createCustomer(buyer)
  await db
    .update(users)
    .set({ henrriCustomerId: customerId, henrriCustomerFingerprint: fingerprint })
    .where(eq(users.id, context.userId))
  return customerId
}

function numberOf(document: { number: string | null }): string {
  // Henrri finalized it but did not say the number: a later pass reads it back.
  if (!document.number) throw new HenrriError("NumberPending", null, "Henrri finalized the document without its number")
  return document.number
}

/**
 * A draft left by an earlier pass: its number if Henrri had finalized it, or the
 * draft finalized as is when its total is already right (no call wasted on a
 * rebuild); otherwise it is deleted — its lines may be incomplete — and null
 * tells the caller to build it again.
 */
async function recoverDraft(
  client: HenrriClient,
  claimed: Claim,
  document: HenrriDocumentRow,
  draft: DocumentDraft,
): Promise<string | null> {
  if (document.henrriDocumentId === null) return null
  const existing = await client.getDocument(document.henrriDocumentId)
  if (existing?.finalized) return numberOf(existing)
  if (existing && toCents(existing.totalTtc) === toCents(draft.expectedTotalTtc)) {
    return numberOf(await client.finalizeDocument(existing.id))
  }
  if (existing) await client.deleteDocument(existing.id)
  await write(claimed, { henrriDocumentId: null, status: "pending" })
  return null
}

async function issue(
  client: HenrriClient,
  claimed: Claim,
  document: HenrriDocumentRow,
  customerId: number,
  title: string,
  draft: DocumentDraft,
): Promise<{ number: string } | { blocked: true }> {
  const kind = document.kind === "invoice" ? "invoice" : "creditNote"
  const henrriDocumentId = await client.createDocument({
    documentTypeId: await client.documentTypeId(kind),
    customerId,
    title,
  })
  // Saved before anything else: from now on a retry finds this draft.
  await write(claimed, { henrriDocumentId, status: "draft" })
  for (const line of draft.lines) await client.addLine(henrriDocumentId, line)

  const built = await client.getDocument(henrriDocumentId)
  const henrriTotalCents = toCents(built?.totalTtc ?? 0)
  if (henrriTotalCents !== toCents(draft.expectedTotalTtc)) {
    await block(
      claimed,
      `TotalMismatch: Henrri ${euros(henrriTotalCents)}, expected ${draft.expectedTotalTtc.toFixed(2)}`,
    )
    return { blocked: true }
  }
  await write(claimed, {})
  return { number: numberOf(await client.finalizeDocument(henrriDocumentId)) }
}

/**
 * Records what the customer paid against the invoice, each share dated the day
 * the money came in: the card share first, carrying the rest over, then the
 * transfer. Reads Henrri's milestones first, so a pass that stopped halfway
 * never pays twice. Returns why the payments do not settle the invoice, if so —
 * an accepted short transfer is flagged, never absorbed.
 */
async function recordPayment(client: HenrriClient, henrriDocumentId: number, context: OrderContext) {
  const shares = [
    { type: "bankCard" as const, ...context.card },
    { type: "transfer" as const, ...context.transfer },
  ].filter((share) => share.cents > 0)
  const invoicedCents = toCents(context.source.totalTtc)
  const receivedCents = shares.reduce((sum, share) => sum + share.cents, 0)
  const paidCents = (milestones: Awaited<ReturnType<HenrriClient["paymentMilestones"]>>) =>
    milestones.filter((milestone) => milestone.paid).reduce((sum, milestone) => sum + toCents(milestone.amount), 0)

  let milestones = await client.paymentMilestones(henrriDocumentId)
  let alreadyPaidCents = paidCents(milestones)
  for (const share of shares) {
    if (alreadyPaidCents >= share.cents) {
      alreadyPaidCents -= share.cents
      continue
    }
    const unpaid = milestones.find((milestone) => !milestone.paid)
    if (!unpaid) break
    // A share that covers the milestone settles it (an overpayment is refunded
    // apart, decision 2026-10-14); a smaller one carries the rest over.
    const settles = share.cents >= toCents(unpaid.amount)
    await client.payMilestone(unpaid.id, {
      paymentModeId: await client.paymentModeId(share.type),
      date: share.date,
      ...(settles ? {} : { amount: share.cents / 100 }),
    })
    milestones = await client.paymentMilestones(henrriDocumentId)
  }

  if (paidCents(milestones) >= invoicedCents) return null
  return `PaymentMismatch: received ${euros(receivedCents)}, invoiced ${euros(invoicedCents)}`
}

/** Refunds that hold money count for the credit notes after them (as when they were planned). */
const CREDITED_REFUND_STATUSES = ["pending", "succeeded"] as const

/** The credit note of the document's refund, built on the order's earlier refunds. */
async function creditNoteDraft(document: HenrriDocumentRow, context: OrderContext): Promise<DraftResult> {
  const rows = await db
    .select({
      id: refunds.id,
      kind: refunds.kind,
      amountTtc: refunds.amountTtc,
      lines: refunds.lines,
      includesShipping: refunds.includesShipping,
    })
    .from(refunds)
    .where(and(eq(refunds.orderId, context.orderId), inArray(refunds.status, CREDITED_REFUND_STATUSES)))
    .orderBy(asc(refunds.createdAt), asc(refunds.id))
  const records: RefundRecord[] = rows.map(({ id: _id, ...row }) => ({ ...row, amountTtc: Number(row.amountTtc) }))
  const index = rows.findIndex((row) => row.id === document.refundId)
  if (index < 0) return { ok: false, reason: "NothingToCredit" }
  return creditNoteFor(context.source, records[index], records.slice(0, index), orderReference(context.orderId))
}

async function draftFor(document: HenrriDocumentRow, context: OrderContext): Promise<DraftResult> {
  if (document.kind === "invoice") return buildInvoiceDraft(context.source)
  return creditNoteDraft(document, context)
}

/** Whether a credit note can go: its order's invoice must be out first. */
async function invoiceGate(orderId: string): Promise<"ready" | "waiting" | "blocked"> {
  const [invoice] = await db
    .select({ status: henrriDocuments.status })
    .from(henrriDocuments)
    .where(and(eq(henrriDocuments.orderId, orderId), eq(henrriDocuments.kind, "invoice")))
    .limit(1)
  if (!invoice || invoice.status === "blocked") return "blocked"
  return invoice.status === "finalized" ? "ready" : "waiting"
}

async function issueDocument(
  client: HenrriClient,
  claimed: Claim,
  document: HenrriDocumentRow,
  context: OrderContext,
  log: Logger,
): Promise<"issued" | "blocked"> {
  const draft = await draftFor(document, context)
  if (!draft.ok) {
    await block(claimed, draft.reason)
    return "blocked"
  }
  if (!context.buyer) {
    await block(claimed, "MissingBillingAddress")
    return "blocked"
  }

  let number = await recoverDraft(client, claimed, document, draft.draft)
  if (number === null) {
    const customerId = await ensureCustomer(client, context, context.buyer)
    const ref = orderReference(context.orderId)
    const title = document.kind === "invoice" ? `Commande ${ref}` : `Avoir — commande ${ref}`
    const issued = await issue(client, claimed, document, customerId, title, draft.draft)
    if ("blocked" in issued) return "blocked"
    number = issued.number
  }
  await write(claimed, { status: "finalized", henrriNumber: number, finalizedAt: new Date(), lastError: null })
  await recordDocumentStep(document.id, "issued", { number })
  log.info(
    { documentId: document.id, orderId: document.orderId, kind: document.kind, number },
    "Henrri document issued",
  )
  return "issued"
}

async function runSteps(
  client: HenrriClient,
  claimed: Claim,
  document: HenrriDocumentRow,
  log: Logger,
): Promise<ProcessOutcome> {
  const context = await loadOrder(document.orderId)
  if (!context) return block(claimed, "OrderNotFound")

  if (document.status !== "finalized" && (await issueDocument(client, claimed, document, context, log)) === "blocked") {
    return "blocked"
  }

  const [issued] = await db.select().from(henrriDocuments).where(eq(henrriDocuments.id, document.id))
  // The buyer hears of the document as soon as it exists, whatever happens to its payment.
  if (issued.customerNotifiedAt === null && issued.henrriNumber) await notifyBuyer(claimed, issued, context, log)

  if (issued.kind === "invoice" && issued.paymentRecordedAt === null && issued.heldAt === null) {
    if (issued.henrriDocumentId === null) return hold(claimed, "PaymentNotRecorded: no Henrri document")
    const mismatch = await recordPayment(client, issued.henrriDocumentId, context)
    if (mismatch) return hold(claimed, mismatch)
    await write(claimed, { paymentRecordedAt: new Date() })
  }
  await release(claimed, { lastError: null })
  return "finalized"
}

/**
 * "Your invoice / credit note is available". A mail failure is no Henrri
 * failure: the document stays issued and the next pass tries the mail again.
 */
async function notifyBuyer(claimed: Claim, document: HenrriDocumentRow, context: OrderContext, log: Logger) {
  try {
    await sendInvoiceAvailableEmail(context.email, {
      orderId: context.orderId,
      orderRef: orderReference(context.orderId),
      kind: document.kind,
      number: document.henrriNumber ?? "",
      amountTtc: Number(document.expectedTotalTtc),
    })
  } catch (err) {
    log.warn({ err, documentId: document.id }, "Invoice e-mail failed — retried on the next pass")
    return
  }
  await write(claimed, { customerNotifiedAt: new Date() })
}

async function recordFailure(claimed: Claim, documentId: string, error: unknown, log: Logger): Promise<ProcessOutcome> {
  const henrriError = error instanceof HenrriError ? error : null
  // Raw internal errors may carry query values: the row keeps a code, the log the detail.
  const reason = henrriError ? `${henrriError.code}: ${henrriError.message}` : "InternalError"
  if (!henrriError) log.error({ err: error, documentId }, "Henrri document failed unexpectedly")

  if (henrriError && !henrriError.retryable) {
    const [current] = await db
      .select({ status: henrriDocuments.status })
      .from(henrriDocuments)
      .where(eq(henrriDocuments.id, documentId))
    // An issued document never goes back to blocked: it stays issued, held.
    return current?.status === "finalized" ? hold(claimed, reason) : block(claimed, reason)
  }
  await release(claimed, { lastError: reason })
  return "retry"
}

const OUTCOME_WARNINGS: Partial<Record<ProcessOutcome, string>> = {
  blocked: "Henrri document blocked — waiting for an admin",
  held: "Henrri document held — waiting for an admin",
  retry: "Henrri document deferred to the next pass",
}

/** A document that stopped short says why, with its order, in one line. */
async function logStop(documentId: string, outcome: ProcessOutcome, log: Logger) {
  const message = OUTCOME_WARNINGS[outcome]
  if (!message) return
  const [row] = await db
    .select({ orderId: henrriDocuments.orderId, kind: henrriDocuments.kind, reason: henrriDocuments.lastError })
    .from(henrriDocuments)
    .where(eq(henrriDocuments.id, documentId))
  if (row) log.warn({ documentId, ...row }, message)
}

/** One document, as far as it can go. Never throws: failures are recorded on the row. */
export async function processHenrriDocument(
  client: HenrriClient,
  documentId: string,
  log: Logger,
): Promise<ProcessOutcome> {
  const outcome = await processDocument(client, documentId, log)
  await logStop(documentId, outcome, log)
  return outcome
}

async function processDocument(client: HenrriClient, documentId: string, log: Logger): Promise<ProcessOutcome> {
  const [queued] = await db.select().from(henrriDocuments).where(eq(henrriDocuments.id, documentId)).limit(1)
  if (!queued) return "skipped"
  if (queued.kind === "credit_note" && queued.status !== "finalized") {
    const gate = await invoiceGate(queued.orderId)
    if (gate === "waiting") return "waiting"
    if (gate === "blocked") {
      const claimedForBlock = await claim(documentId)
      return claimedForBlock ? block(claimedForBlock.claim, "InvoiceBlocked") : "skipped"
    }
  }

  const claimed = await claim(documentId)
  if (!claimed) return "skipped"
  try {
    return await runSteps(client, claimed.claim, claimed.row, log)
  } catch (error) {
    try {
      if (error instanceof ClaimLost) throw error
      return await recordFailure(claimed.claim, documentId, error, log)
    } catch (failure) {
      if (!(failure instanceof ClaimLost)) throw failure
      log.warn({ documentId }, "Henrri document taken over by another pass — this one stops")
      return "skipped"
    }
  }
}

/**
 * One pass over the queue, oldest first and invoices before credit notes, so
 * Henrri's numbering follows the order of the sales. Stops at the first
 * retryable failure: Henrri is down, slow, rate-limited or out of credits, and
 * every further call would be spent for nothing.
 */
export async function processPendingHenrriDocuments(client: HenrriClient, log: Logger) {
  await enqueueMissingDocuments()
  const queued = await db
    .select({ id: henrriDocuments.id })
    .from(henrriDocuments)
    .where(and(workToDo(), claimIsFree()))
    .orderBy(sql`${henrriDocuments.kind} = 'credit_note'`, asc(henrriDocuments.createdAt))

  const outcomes: Record<ProcessOutcome, number> = {
    finalized: 0,
    held: 0,
    waiting: 0,
    blocked: 0,
    retry: 0,
    skipped: 0,
  }
  let halted = false
  for (const { id } of queued) {
    const outcome = await processHenrriDocument(client, id, log)
    outcomes[outcome] += 1
    if (outcome === "retry") {
      halted = true
      break
    }
  }
  return { queued: queued.length, ...outcomes, halted }
}

/**
 * The configured client, or null while Henrri is not set up — and always null
 * under test: apps/api/.env may hold real sandbox credentials, and no test may
 * ever reach Henrri (tests use the in-memory fake).
 */
export function henrriClientFromEnv(): HenrriClient | null {
  if (env.NODE_ENV === "test") return null
  return henrriClientFromConfig({
    baseUrl: env.HENRRI_BASE_URL,
    clientId: env.HENRRI_CLIENT_ID,
    clientSecret: env.HENRRI_CLIENT_SECRET,
  })
}

/**
 * In-process pass every HENRRI_SYNC_INTERVAL_MINUTES. A pass still running when
 * the next tick comes is not doubled (claims make overlapping passes safe, this
 * makes them rare).
 */
export function startHenrriScheduler(app: FastifyInstance): void {
  const minutes = env.HENRRI_SYNC_INTERVAL_MINUTES
  if (env.NODE_ENV === "test" || minutes <= 0) return
  const client = app.henrri
  if (!client) {
    app.log.info("Henrri not configured — invoices wait in the queue")
    return
  }

  let running = false
  const timer = setInterval(
    () => {
      if (running) return
      running = true
      processPendingHenrriDocuments(client, app.log)
        .then((result) => {
          if (result.queued > 0) app.log.info(result, "Henrri sync pass")
        })
        .catch((err) => app.log.error({ err }, "Henrri sync pass failed"))
        .finally(() => {
          running = false
        })
    },
    minutes * 60 * 1000,
  )
  timer.unref?.()
  app.addHook("onClose", async () => clearInterval(timer))
  app.log.info({ minutes }, "Henrri sync scheduler started")
}
