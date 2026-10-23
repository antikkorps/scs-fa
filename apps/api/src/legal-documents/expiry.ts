// Story 12.9f (security audit) — a supporting document past its expiry date
// proves nothing. Once a day, documents still pending review or approved whose
// expiry date has passed are marked `expired`, so the back office and the
// customer see the same status, and the owner's orders under review are
// re-derived (they go back to the customer for a valid document).

import { parisToday } from "@armurier/shared"
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { recordAuditEvents } from "../audit/record.js"
import { db } from "../db/client.js"
import { legalDocuments } from "../db/schema.js"
import { recomputeOrderLegalStatus } from "../orders/legal-status.js"
import { startPeriodicJob } from "../periodic-job.js"

const DAY_MS = 24 * 60 * 60 * 1000
// A rejected document is already out of the way: only these can still count.
const EXPIRABLE_STATUSES = ["pending", "approved"] as const

/**
 * Mark the documents past their expiry date — every customer's, or only one's
 * (`userId`). Idempotent: run it as often as you like.
 */
export async function expireLegalDocuments(
  today: string = parisToday(),
  userId?: string,
): Promise<{ expired: number }> {
  const expired = await db.transaction(async (tx) => {
    const pastExpiry = and(
      inArray(legalDocuments.verificationStatus, [...EXPIRABLE_STATUSES]),
      isNotNull(legalDocuments.expiresAt),
      lt(legalDocuments.expiresAt, today),
      userId ? eq(legalDocuments.userId, userId) : undefined,
    )
    const due = await tx
      .select({ id: legalDocuments.id, verificationStatus: legalDocuments.verificationStatus })
      .from(legalDocuments)
      .where(pastExpiry)
      .for("update")
    if (due.length === 0) return []

    const marked = await tx
      .update(legalDocuments)
      .set({ verificationStatus: "expired", updatedAt: new Date() })
      .where(
        and(
          inArray(
            legalDocuments.id,
            due.map((doc) => doc.id),
          ),
          pastExpiry,
        ),
      )
      .returning({ id: legalDocuments.id, userId: legalDocuments.userId })
    const previousStatus = new Map(due.map((doc) => [doc.id, doc.verificationStatus]))
    await recordAuditEvents(
      marked.map((doc) => ({
        userId: null,
        userRole: "system",
        entityType: "legal_document",
        entityId: doc.id,
        action: "legal_doc_expired",
        oldValue: { verificationStatus: previousStatus.get(doc.id) },
        newValue: { verificationStatus: "expired" },
      })),
      tx,
    )
    return marked
  })

  // Outside the transaction: the recompute reads the documents just committed.
  for (const owner of new Set(expired.map((doc) => doc.userId))) {
    await recomputeOrderLegalStatus(owner)
  }
  return { expired: expired.length }
}

/** Mark expired documents at startup, then once a day. */
export function startLegalDocExpiryScheduler(app: FastifyInstance): void {
  startPeriodicJob(app, "legal document expiry", DAY_MS, () => expireLegalDocuments())
}
