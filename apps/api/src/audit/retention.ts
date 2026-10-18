// Story 12.7e — how long audit events are kept (decided 2026-10-15 / 2026-10-19):
// an order's history 10 years from the order's date, everything else 1 year.
// Technical logs (14 days) are journald's job, not this one.

import { and, inArray, isNull, lt } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { db } from "../db/client.js"
import { auditLogs, orders } from "../db/schema.js"
import { env } from "../env.js"

const ORDER_HISTORY_YEARS = 10
const OTHER_EVENTS_YEARS = 1
const PURGE_EVERY_MS = 24 * 60 * 60 * 1000

function yearsBefore(now: Date, years: number): Date {
  const cutoff = new Date(now)
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years)
  return cutoff
}

/** Delete what is past its retention. Idempotent: run it as often as you like. */
export async function purgeAuditLogs(now: Date = new Date()): Promise<{ orderEvents: number; otherEvents: number }> {
  // All of an old order's history goes at once, late events included.
  const oldOrders = db
    .select({ id: orders.id })
    .from(orders)
    .where(lt(orders.createdAt, yearsBefore(now, ORDER_HISTORY_YEARS)))
  const orderEvents = await db
    .delete(auditLogs)
    .where(inArray(auditLogs.orderId, oldOrders))
    .returning({ id: auditLogs.id })

  // Logins, security, e-mails outside an order, admin actions — and the events
  // of a deleted order, whose link is gone.
  const otherEvents = await db
    .delete(auditLogs)
    .where(and(isNull(auditLogs.orderId), lt(auditLogs.createdAt, yearsBefore(now, OTHER_EVENTS_YEARS))))
    .returning({ id: auditLogs.id })

  return { orderEvents: orderEvents.length, otherEvents: otherEvents.length }
}

/** Purge at startup, then once a day. No-op under tests. Cleared on server close. */
export function startAuditPurgeScheduler(app: FastifyInstance): void {
  if (env.NODE_ENV === "test") return

  const run = () =>
    purgeAuditLogs()
      .then((purged) => {
        if (purged.orderEvents + purged.otherEvents > 0) app.log.info(purged, "audit log purge")
      })
      .catch((err) => app.log.error({ err }, "audit log purge failed"))

  void run()
  const timer = setInterval(run, PURGE_EVERY_MS)
  timer.unref?.()
  app.addHook("onClose", async () => clearInterval(timer))
  app.log.info("audit log purge scheduler started")
}
