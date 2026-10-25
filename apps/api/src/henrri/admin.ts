// Story 12.6 — what the back-office sees of the Henrri queue, and how it nudges it.

import { and, asc, count, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm"
import { db } from "../db/client.js"
import { henrriDocuments } from "../db/schema.js"

/** Past this, a document still on its way is worth an admin's look. */
const STALLED_AFTER_MINUTES = 60

/** An order's invoice and credit notes, invoice first — without Henrri's internal ids. */
export async function henrriDocumentsOfOrder(orderId: string) {
  const rows = await db
    .select()
    .from(henrriDocuments)
    .where(eq(henrriDocuments.orderId, orderId))
    .orderBy(sql`${henrriDocuments.kind} = 'credit_note'`, asc(henrriDocuments.createdAt))
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    number: row.henrriNumber,
    amountTtc: Number(row.expectedTotalTtc),
    refundId: row.refundId,
    lastError: row.lastError,
    held: row.heldAt !== null,
    attempts: row.attempts,
    finalizedAt: row.finalizedAt,
    paymentRecordedAt: row.paymentRecordedAt,
    createdAt: row.createdAt,
  }))
}

/**
 * Puts an order's blocked documents back in the queue, and releases the issued
 * ones held for an admin (their payment is tried again). Returns how many.
 */
export async function retryOrderDocuments(orderId: string): Promise<number> {
  const blocked = await db
    .update(henrriDocuments)
    .set({ status: "pending", lastError: null, claimedAt: null, claimToken: null, updatedAt: new Date() })
    .where(and(eq(henrriDocuments.orderId, orderId), eq(henrriDocuments.status, "blocked")))
    .returning({ id: henrriDocuments.id })
  const held = await db
    .update(henrriDocuments)
    .set({ heldAt: null, lastError: null, claimedAt: null, claimToken: null, updatedAt: new Date() })
    .where(and(eq(henrriDocuments.orderId, orderId), isNotNull(henrriDocuments.heldAt)))
    .returning({ id: henrriDocuments.id })
  return blocked.length + held.length
}

/**
 * Documents that need a human: blocked ones, and those still on their way an
 * hour on (Henrri down, credits exhausted…) — a sale is never held up by them,
 * so this counter is the only place they show.
 */
export async function countDocumentsNeedingAttention(): Promise<number> {
  const [{ total }] = await db.select({ total: count() }).from(henrriDocuments).where(needsAttention())
  return total
}

/** The ids of orders with at least one document that needs attention. */
export function ordersNeedingAttention() {
  return db
    .selectDistinct({ orderId: henrriDocuments.orderId })
    .from(henrriDocuments)
    .where(and(isNotNull(henrriDocuments.orderId), needsAttention()))
}

function needsAttention() {
  const stalledSince = sql`now() - make_interval(mins => ${STALLED_AFTER_MINUTES})`
  return or(
    eq(henrriDocuments.status, "blocked"),
    isNotNull(henrriDocuments.heldAt),
    and(inArray(henrriDocuments.status, ["pending", "draft"]), lt(henrriDocuments.createdAt, stalledSince)),
    and(
      eq(henrriDocuments.status, "finalized"),
      eq(henrriDocuments.kind, "invoice"),
      isNull(henrriDocuments.paymentRecordedAt),
      lt(henrriDocuments.finalizedAt, stalledSince),
    ),
  )
}
