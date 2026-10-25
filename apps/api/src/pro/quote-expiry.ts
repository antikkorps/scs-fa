// Story 12.8d — a sent quote holds through its last day, in Paris; then it
// expires and can no longer be accepted. SCS revises it to send it again.

import { parisToday } from "@armurier/shared"
import { and, eq, lt } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { recordAuditEvent } from "../audit/record.js"
import { db } from "../db/client.js"
import { quoteRequests } from "../db/schema.js"
import { startPeriodicJob } from "../periodic-job.js"
import { validityDate } from "./quotes.js"

// Hourly, so a quote never outlives its last day by much more than an hour.
const SWEEP_EVERY_MS = 60 * 60 * 1000

/** Expire the sent quotes whose last day is before `today`. Idempotent. */
export async function expireQuotes(today: string = parisToday()): Promise<{ quotes: number }> {
  const expired = await db
    .update(quoteRequests)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(eq(quoteRequests.status, "sent"), lt(quoteRequests.validUntil, validityDate(today))))
    .returning({ id: quoteRequests.id, number: quoteRequests.number })
  for (const quote of expired) {
    await recordAuditEvent({
      userRole: "system",
      entityType: "quote_request",
      entityId: quote.id,
      action: "quote_request.expired",
      oldValue: { status: "sent" },
      newValue: { status: "expired" },
    })
  }
  return { quotes: expired.length }
}

export function startQuoteExpiryScheduler(app: FastifyInstance): void {
  startPeriodicJob(app, "quote expiry", SWEEP_EVERY_MS, () => expireQuotes())
}
