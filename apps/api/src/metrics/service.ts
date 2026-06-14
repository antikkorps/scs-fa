import { and, count, eq, gte, lt, sql } from "drizzle-orm"
import { db } from "../db/client.js"
import { legalDocuments, orders, refunds } from "../db/schema.js"

// Orders that count as a completed sale (mirrors PAID_PAYMENT_STATUSES). Kept as
// a raw fragment so we filter inside SQL rather than pulling rows into JS.
const PAID_ORDER_SQL = sql`${orders.paymentStatus} in ('received', 'reconciled', 'partially_refunded')`

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export interface MetricsResult {
  period: { from: string; to: string }
  revenue: {
    /** Gross TTC invoiced on paid orders placed in the period. */
    grossTtc: number
    /** Refunds (succeeded) issued against those paid orders. */
    refundedTtc: number
    /** grossTtc − refundedTtc. */
    netTtc: number
    paidOrders: number
  }
  commission: {
    ratePct: number
    /** Partner commission on net revenue (transparent reporting). */
    amount: number
  }
  funnel: {
    totalOrders: number
    paidOrders: number
    pendingOrders: number
    failedOrders: number
    refundedOrders: number
    /** paidOrders / totalOrders, as a percentage. */
    conversionPct: number
  }
  legalSla: {
    reviewed: number
    withinSla: number
    /** Share of reviewed documents decided before their 48h deadline. */
    withinSlaPct: number
    avgReviewHours: number | null
    /** Point-in-time: pending documents already past their deadline. */
    pendingOverdue: number
  }
  /** Daily gross TTC of paid orders placed that day, oldest first (for charts). */
  timeseries: Array<{ date: string; grossTtc: number }>
}

export interface MetricsInput {
  from: Date
  to: Date
  commissionRatePct: number
  now?: Date
}

/**
 * Aggregate the business metrics for a period: revenue (net of refunds) and the
 * partner commission, the order funnel + conversion, legal-review SLA
 * performance, and a daily revenue series.
 *
 * Everything is computed in SQL (sums/counts/group-by) over orders placed in
 * `[from, to)`, so it stays cheap as the table grows. Revenue is net: the gross
 * of paid orders minus the refunds settled against them.
 */
export async function computeMetrics(input: MetricsInput): Promise<MetricsResult> {
  const { from, to, commissionRatePct } = input
  const now = input.now ?? new Date()
  const inPeriod = and(gte(orders.createdAt, from), lt(orders.createdAt, to))

  const [[gross], [refunded], funnelRows, [reviewedRow], [overdueRow], series] = await Promise.all([
    db
      .select({ sum: sql<string>`coalesce(sum(${orders.totalTtc}), 0)`, n: count() })
      .from(orders)
      .where(and(inPeriod, PAID_ORDER_SQL)),
    db
      .select({ sum: sql<string>`coalesce(sum(${refunds.amountTtc}), 0)` })
      .from(refunds)
      .innerJoin(orders, eq(orders.id, refunds.orderId))
      .where(and(inPeriod, PAID_ORDER_SQL, eq(refunds.status, "succeeded"))),
    db.select({ status: orders.paymentStatus, n: count() }).from(orders).where(inPeriod).groupBy(orders.paymentStatus),
    // Documents decided in the period: how many, how many within deadline, mean review time.
    db
      .select({
        reviewed: count(),
        withinSla: sql<number>`count(*) filter (where ${legalDocuments.verifiedAt} <= ${legalDocuments.verificationDeadline})::int`,
        avgHours: sql<
          number | null
        >`avg(extract(epoch from (${legalDocuments.verifiedAt} - ${legalDocuments.uploadedAt})) / 3600.0)`,
      })
      .from(legalDocuments)
      .where(
        and(
          sql`${legalDocuments.verificationStatus} in ('approved', 'rejected')`,
          gte(legalDocuments.verifiedAt, from),
          lt(legalDocuments.verifiedAt, to),
        ),
      ),
    // Point-in-time backlog health: still-pending docs already past deadline.
    db
      .select({ n: count() })
      .from(legalDocuments)
      .where(and(eq(legalDocuments.verificationStatus, "pending"), lt(legalDocuments.verificationDeadline, now))),
    db
      .select({
        date: sql<string>`to_char(${orders.createdAt}, 'YYYY-MM-DD')`,
        sum: sql<string>`coalesce(sum(${orders.totalTtc}), 0)`,
      })
      .from(orders)
      .where(and(inPeriod, PAID_ORDER_SQL))
      .groupBy(sql`to_char(${orders.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${orders.createdAt}, 'YYYY-MM-DD')`),
  ])

  const grossTtc = round2(Number(gross.sum))
  const refundedTtc = round2(Number(refunded.sum))
  const netTtc = round2(grossTtc - refundedTtc)

  const byStatus = new Map<string, number>(funnelRows.map((r) => [r.status, r.n]))
  const sumStatuses = (statuses: string[]) => statuses.reduce((acc, s) => acc + (byStatus.get(s) ?? 0), 0)
  const totalOrders = funnelRows.reduce((acc, r) => acc + r.n, 0)
  const paidOrders = sumStatuses(["received", "reconciled", "partially_refunded"])
  const pendingOrders = sumStatuses(["pending", "awaiting_transfer", "transfer_claimed"])
  const failedOrders = sumStatuses(["failed", "cancelled"])
  const refundedOrders = sumStatuses(["refunded"])

  const reviewed = Number(reviewedRow.reviewed)
  const withinSla = Number(reviewedRow.withinSla)

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    revenue: { grossTtc, refundedTtc, netTtc, paidOrders: gross.n },
    commission: { ratePct: commissionRatePct, amount: round2(netTtc * (commissionRatePct / 100)) },
    funnel: {
      totalOrders,
      paidOrders,
      pendingOrders,
      failedOrders,
      refundedOrders,
      conversionPct: totalOrders > 0 ? round2((paidOrders / totalOrders) * 100) : 0,
    },
    legalSla: {
      reviewed,
      withinSla,
      withinSlaPct: reviewed > 0 ? round2((withinSla / reviewed) * 100) : 0,
      avgReviewHours: reviewedRow.avgHours === null ? null : round2(Number(reviewedRow.avgHours)),
      pendingOverdue: overdueRow.n,
    },
    timeseries: series.map((r) => ({ date: r.date, grossTtc: round2(Number(r.sum)) })),
  }
}
