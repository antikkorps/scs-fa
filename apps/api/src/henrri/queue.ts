// Story 12.6 — the queue that turns paid orders into Henrri invoices and
// refunds into credit notes. A Henrri outage never blocks a sale: documents wait
// in `henrri_documents` and each pass picks up where the last one stopped.
//
// Idempotence rests on the Henrri draft id, stored as soon as the draft exists
// (the API has no external reference): a later pass reads it back first — free —
// and either records a number Henrri already gave, or rebuilds the draft.

import { orderReference } from "@armurier/shared"
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm"
import type { FastifyBaseLogger, FastifyInstance } from "fastify"
import { db } from "../db/client.js"
import { henrriDocuments, orders, paymentCarte, paymentVirement, refunds, users } from "../db/schema.js"
import { env } from "../env.js"
import { type HenrriBuyer, type HenrriClient, HenrriError, henrriClientFromConfig } from "./client.js"
import { buildCreditNoteDraft, buildInvoiceDraft, type DocumentDraft, type DraftResult } from "./documents.js"

type Logger = Pick<FastifyBaseLogger, "info" | "warn" | "error">
type HenrriDocumentRow = typeof henrriDocuments.$inferSelect

/** A claim older than this is considered abandoned (process killed mid-pass). */
const CLAIM_TIMEOUT_MINUTES = 10

export type ProcessOutcome = "finalized" | "waiting" | "blocked" | "retry" | "skipped"

/** Queue the invoice of an order that has just become fully paid. Idempotent. */
export async function enqueueInvoice(orderId: string): Promise<void> {
  const [order] = await db.select({ totalTtc: orders.totalTtc }).from(orders).where(eq(orders.id, orderId)).limit(1)
  if (!order) return
  await db
    .insert(henrriDocuments)
    .values({ orderId, kind: "invoice", expectedTotalTtc: order.totalTtc })
    .onConflictDoNothing()
}

/** Queue the credit note of a refund that has just succeeded. Idempotent. */
export async function enqueueCreditNote(refundId: string): Promise<void> {
  const [refund] = await db
    .select({ orderId: refunds.orderId, amountTtc: refunds.amountTtc })
    .from(refunds)
    .where(eq(refunds.id, refundId))
    .limit(1)
  if (!refund) return
  await db
    .insert(henrriDocuments)
    .values({ orderId: refund.orderId, refundId, kind: "credit_note", expectedTotalTtc: refund.amountTtc })
    .onConflictDoNothing()
}

/** Henrri expects plain dates for payments: today in Paris. */
function todayInParis(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date())
}

function toCents(amount: number | string): number {
  return Math.round(Number(amount) * 100)
}

/** The rows a pass works on: never-finished documents and unrecorded payments. */
function workToDo() {
  return or(
    inArray(henrriDocuments.status, ["pending", "draft"]),
    and(
      eq(henrriDocuments.status, "finalized"),
      eq(henrriDocuments.kind, "invoice"),
      isNull(henrriDocuments.paymentRecordedAt),
    ),
  )
}

function claimIsFree() {
  return or(
    isNull(henrriDocuments.claimedAt),
    lt(henrriDocuments.claimedAt, sql`now() - make_interval(mins => ${CLAIM_TIMEOUT_MINUTES})`),
  )
}

async function claim(documentId: string): Promise<HenrriDocumentRow | null> {
  const [claimed] = await db
    .update(henrriDocuments)
    .set({ claimedAt: new Date(), attempts: sql`${henrriDocuments.attempts} + 1`, updatedAt: new Date() })
    .where(and(eq(henrriDocuments.id, documentId), workToDo(), claimIsFree()))
    .returning()
  return claimed ?? null
}

async function update(documentId: string, values: Partial<HenrriDocumentRow>) {
  await db
    .update(henrriDocuments)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(henrriDocuments.id, documentId))
}

async function block(documentId: string, reason: string): Promise<ProcessOutcome> {
  await update(documentId, { status: "blocked", lastError: reason, claimedAt: null })
  return "blocked"
}

interface OrderContext {
  orderId: string
  userId: string
  email: string
  henrriCustomerId: number | null
  buyer: HenrriBuyer | null
  source: Parameters<typeof buildInvoiceDraft>[0]
  cardTtc: number
  transferTtc: number
}

async function loadOrder(orderId: string): Promise<OrderContext | null> {
  const [row] = await db
    .select({
      order: orders,
      email: users.email,
      henrriCustomerId: users.henrriCustomerId,
      cardTtc: paymentCarte.amountTtc,
      transferExpectedTtc: paymentVirement.amountExpectedTtc,
      transferReceivedTtc: paymentVirement.amountReceivedTtc,
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
    buyer: address
      ? {
          firstName: address.firstName,
          lastName: address.lastName,
          email: row.email,
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
    cardTtc: Number(row.cardTtc ?? 0),
    transferTtc: Number(row.transferReceivedTtc ?? row.transferExpectedTtc ?? 0),
  }
}

/** The buyer's Henrri customer: created once, its billing address kept current. */
async function ensureCustomer(client: HenrriClient, context: OrderContext, buyer: HenrriBuyer): Promise<number> {
  if (context.henrriCustomerId !== null) {
    await client.updateCustomer(context.henrriCustomerId, buyer)
    return context.henrriCustomerId
  }
  const customerId = await client.createCustomer(buyer)
  await db.update(users).set({ henrriCustomerId: customerId }).where(eq(users.id, context.userId))
  return customerId
}

/**
 * Looks at a draft left by an earlier pass. Returns the number when Henrri had
 * already finalized it (the pass died before saving it), otherwise deletes the
 * draft — its lines may be incomplete — so it is rebuilt from scratch.
 */
async function recoverDraft(client: HenrriClient, document: HenrriDocumentRow): Promise<string | null> {
  if (document.henrriDocumentId === null) return null
  const existing = await client.getDocument(document.henrriDocumentId)
  if (existing?.finalized && existing.number) return existing.number
  if (existing) await client.deleteDocument(existing.id)
  await update(document.id, { henrriDocumentId: null, status: "pending" })
  return null
}

async function issue(
  client: HenrriClient,
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
  await update(document.id, { henrriDocumentId, status: "draft" })
  for (const line of draft.lines) await client.addLine(henrriDocumentId, line)

  const built = await client.getDocument(henrriDocumentId)
  const henrriTotalCents = toCents(built?.totalTtc ?? 0)
  if (henrriTotalCents !== toCents(draft.expectedTotalTtc)) {
    const henrriTotal = (henrriTotalCents / 100).toFixed(2)
    await block(document.id, `TotalMismatch: Henrri ${henrriTotal}, expected ${draft.expectedTotalTtc.toFixed(2)}`)
    return { blocked: true }
  }
  const finalized = await client.finalizeDocument(henrriDocumentId)
  return { number: finalized.number ?? "" }
}

/**
 * Records what the customer paid against the invoice: the card share first,
 * carrying the rest over, then the transfer for whatever remains. Reads Henrri's
 * milestones first, so a pass that stopped halfway never pays twice.
 */
async function recordPayment(client: HenrriClient, henrriDocumentId: number, context: OrderContext) {
  const shares = [
    { type: "bankCard" as const, cents: toCents(context.cardTtc) },
    { type: "transfer" as const, cents: toCents(context.transferTtc) },
  ].filter((share) => share.cents > 0)

  let milestones = await client.paymentMilestones(henrriDocumentId)
  let alreadyPaidCents = milestones.filter((m) => m.paid).reduce((sum, m) => sum + toCents(m.amount), 0)
  for (const [index, share] of shares.entries()) {
    if (alreadyPaidCents >= share.cents) {
      alreadyPaidCents -= share.cents
      continue
    }
    const unpaid = milestones.find((milestone) => !milestone.paid)
    if (!unpaid) return
    const isLast = index === shares.length - 1
    await client.payMilestone(unpaid.id, {
      paymentModeId: await client.paymentModeId(share.type),
      date: todayInParis(),
      // The last share settles whatever is left; earlier ones carry the rest over.
      ...(isLast ? {} : { amount: share.cents / 100 }),
    })
    milestones = await client.paymentMilestones(henrriDocumentId)
  }
}

async function draftFor(document: HenrriDocumentRow, context: OrderContext): Promise<DraftResult> {
  if (document.kind === "invoice") return buildInvoiceDraft(context.source)
  return buildCreditNoteDraft(context.source, Number(document.expectedTotalTtc), orderReference(context.orderId))
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

async function runSteps(client: HenrriClient, document: HenrriDocumentRow): Promise<ProcessOutcome> {
  const context = await loadOrder(document.orderId)
  if (!context) return block(document.id, "OrderNotFound")

  if (document.status !== "finalized") {
    const draft = await draftFor(document, context)
    if (!draft.ok) return block(document.id, draft.reason)
    if (!context.buyer) return block(document.id, "MissingBillingAddress")

    let number = await recoverDraft(client, document)
    if (number === null) {
      const customerId = await ensureCustomer(client, context, context.buyer)
      const ref = orderReference(context.orderId)
      const title = document.kind === "invoice" ? `Commande ${ref}` : `Avoir — commande ${ref}`
      const issued = await issue(client, document, customerId, title, draft.draft)
      if ("blocked" in issued) return "blocked"
      number = issued.number
    }
    await update(document.id, { status: "finalized", henrriNumber: number, finalizedAt: new Date(), lastError: null })
  }

  if (document.kind === "invoice") {
    const [current] = await db
      .select({ henrriDocumentId: henrriDocuments.henrriDocumentId })
      .from(henrriDocuments)
      .where(eq(henrriDocuments.id, document.id))
    if (current?.henrriDocumentId != null) await recordPayment(client, current.henrriDocumentId, context)
    await update(document.id, { paymentRecordedAt: new Date() })
  }
  await update(document.id, { claimedAt: null, lastError: null })
  return "finalized"
}

/** One document, as far as it can go. Never throws: failures are recorded on the row. */
export async function processHenrriDocument(
  client: HenrriClient,
  documentId: string,
  log: Logger,
): Promise<ProcessOutcome> {
  const [queued] = await db.select().from(henrriDocuments).where(eq(henrriDocuments.id, documentId)).limit(1)
  if (!queued) return "skipped"
  if (queued.kind === "credit_note" && queued.status !== "finalized") {
    const gate = await invoiceGate(queued.orderId)
    if (gate === "blocked") return block(queued.id, "InvoiceBlocked")
    if (gate === "waiting") return "waiting"
  }

  const document = await claim(documentId)
  if (!document) return "skipped"
  try {
    return await runSteps(client, document)
  } catch (error) {
    const henrriError = error instanceof HenrriError ? error : null
    const reason = henrriError ? `${henrriError.code}: ${henrriError.message}` : String(error)
    if (henrriError && !henrriError.retryable) {
      log.warn({ documentId, reason }, "Henrri refused the document — blocked until an admin retries")
      return block(document.id, reason)
    }
    log.warn({ documentId, reason }, "Henrri document deferred to the next pass")
    await update(document.id, { lastError: reason, claimedAt: null })
    return "retry"
  }
}

/**
 * One pass over the queue, oldest first and invoices before credit notes, so
 * Henrri's numbering follows the order of the sales.
 */
export async function processPendingHenrriDocuments(client: HenrriClient, log: Logger) {
  const queued = await db
    .select({ id: henrriDocuments.id })
    .from(henrriDocuments)
    .where(and(workToDo(), claimIsFree()))
    .orderBy(sql`${henrriDocuments.kind} = 'credit_note'`, asc(henrriDocuments.createdAt))

  const outcomes: Record<ProcessOutcome, number> = { finalized: 0, waiting: 0, blocked: 0, retry: 0, skipped: 0 }
  for (const { id } of queued) {
    outcomes[await processHenrriDocument(client, id, log)] += 1
  }
  return { queued: queued.length, ...outcomes }
}

/** The configured client, or null while Henrri is not set up. */
export function henrriClientFromEnv(): HenrriClient | null {
  return henrriClientFromConfig({
    baseUrl: env.HENRRI_BASE_URL,
    clientId: env.HENRRI_CLIENT_ID,
    clientSecret: env.HENRRI_CLIENT_SECRET,
  })
}

/** In-process pass every HENRRI_SYNC_INTERVAL_MINUTES, like the confirmation retry. */
export function startHenrriScheduler(app: FastifyInstance): void {
  const minutes = env.HENRRI_SYNC_INTERVAL_MINUTES
  if (env.NODE_ENV === "test" || minutes <= 0) return
  const client = henrriClientFromEnv()
  if (!client) {
    app.log.info("Henrri not configured — invoices wait in the queue")
    return
  }

  const timer = setInterval(
    () => {
      processPendingHenrriDocuments(client, app.log)
        .then((result) => {
          if (result.queued > 0) app.log.info(result, "Henrri sync pass")
        })
        .catch((err) => app.log.error({ err }, "Henrri sync pass failed"))
    },
    minutes * 60 * 1000,
  )
  timer.unref?.()
  app.addHook("onClose", async () => clearInterval(timer))
  app.log.info({ minutes }, "Henrri sync scheduler started")
}
