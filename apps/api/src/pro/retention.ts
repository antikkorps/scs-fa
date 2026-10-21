// Story 12.8c — how long a quote request is kept (decided 2026-10-21): one that
// never became an order goes 3 years after its last activity, the CNIL's
// duration for prospects between professionals. A converted one follows its
// order. Its lines go with it (cascade).

import { and, lt, ne } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { startDailyPurge } from "../daily-purge.js"
import { db } from "../db/client.js"
import { quoteRequests } from "../db/schema.js"

const STALE_REQUEST_YEARS = 3

/** Delete what is past its retention. Idempotent. */
export async function purgeStaleQuoteRequests(now: Date = new Date()): Promise<{ quoteRequests: number }> {
  const cutoff = new Date(now)
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - STALE_REQUEST_YEARS)
  const removed = await db
    .delete(quoteRequests)
    .where(and(ne(quoteRequests.status, "converted"), lt(quoteRequests.updatedAt, cutoff)))
    .returning({ id: quoteRequests.id })
  return { quoteRequests: removed.length }
}

export function startQuoteRequestPurgeScheduler(app: FastifyInstance): void {
  startDailyPurge(app, "quote request", purgeStaleQuoteRequests)
}
