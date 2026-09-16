import { and, eq, inArray, isNotNull } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { db } from "../../db/client.js"
import { auditLogs, shipments } from "../../db/schema.js"
import { env } from "../../env.js"
import { recomputeOrderShippingStatus } from "../service.js"
import { trackedCarriers, trackingProviderFor } from "./index.js"

/**
 * How many parcels one run may ask about. A bound on the burst against a
 * carrier's quota, not on the work: the parcels left over are picked up by the
 * next run, since nothing marks them as seen.
 */
const MAX_PARCELS_PER_RUN = 100

interface Logger {
  warn: (obj: object, msg: string) => void
}

type ParcelToCheck = { id: string; orderId: string; carrier: string; trackingNumber: string | null }

type CheckOutcome = "delivered" | "checked" | "failed" | "skipped"

/**
 * Ask one carrier about one parcel, and record what it says.
 *
 * The move is one-way — `shipped` → `delivered`. A carrier reporting "in
 * transit" about a parcel an admin marked delivered by hand is not grounds to
 * unsay it: a human looking at the parcel beats an API looking at a database.
 */
async function checkParcel(parcel: ParcelToCheck, logger?: Logger): Promise<CheckOutcome> {
  const provider = trackingProviderFor(parcel.carrier)
  if (!provider || !parcel.trackingNumber) return "skipped"

  let result: Awaited<ReturnType<typeof provider.fetchStatus>>
  try {
    result = await provider.fetchStatus(parcel.trackingNumber)
  } catch (err) {
    // The carrier is down, rate-limiting us, or refusing our key. Leave the
    // parcel exactly as it is: an unanswered question is not an answer.
    logger?.warn({ err, shipmentId: parcel.id, carrier: parcel.carrier }, "carrier tracking check failed")
    return "failed"
  }

  const checkedAt = new Date()
  const label = result.label?.slice(0, 255) ?? null

  if (result.state !== "delivered") {
    await db
      .update(shipments)
      .set({ trackingCheckedAt: checkedAt, trackingLabel: label })
      .where(eq(shipments.id, parcel.id))
    return "checked"
  }

  const recorded = await db.transaction(async (tx) => {
    // Re-read under the row lock: an admin may have marked this parcel
    // delivered by hand while the carrier was answering us.
    const [current] = await tx.select().from(shipments).where(eq(shipments.id, parcel.id)).limit(1).for("update")
    if (current?.status !== "shipped") return false

    await tx
      .update(shipments)
      .set({
        status: "delivered",
        deliveredAt: result.deliveredAt ?? checkedAt,
        trackingCheckedAt: checkedAt,
        trackingLabel: label,
        updatedAt: checkedAt,
      })
      .where(eq(shipments.id, parcel.id))

    // `system`, not an admin: nobody clicked. The audit trail must say who — or
    // what — closed a parcel.
    await tx.insert(auditLogs).values({
      userId: null,
      userRole: "system",
      entityType: "shipment",
      entityId: parcel.id,
      action: "shipment.delivered",
      oldValue: { status: "shipped" },
      newValue: { status: "delivered", carrier: parcel.carrier, trackingLabel: result.label, source: "carrier_api" },
    })
    await recomputeOrderShippingStatus(parcel.orderId, tx)
    return true
  })

  // Counted as delivered only once the transaction has actually committed.
  return recorded ? "delivered" : "checked"
}

/**
 * Ask the carrier about one parcel, now — what the admin's "Rafraîchir le suivi"
 * button runs. Same code path as the scheduler, aimed at a single parcel.
 */
export async function refreshShipmentTracking(shipmentId: string, logger?: Logger): Promise<CheckOutcome> {
  const [parcel] = await db
    .select({
      id: shipments.id,
      orderId: shipments.orderId,
      carrier: shipments.carrier,
      trackingNumber: shipments.trackingNumber,
    })
    .from(shipments)
    .where(eq(shipments.id, shipmentId))
    .limit(1)
  return parcel ? checkParcel(parcel, logger) : "skipped"
}

export interface TrackingSyncSummary {
  /** Parcels actually asked about. */
  checked: number
  /** Parcels the carrier reported as arrived, and that we recorded as delivered. */
  delivered: number
  /** Parcels whose carrier could not be reached — left untouched for the next run. */
  failed: number
}

/**
 * Ask the carriers where the parcels in transit are, and record the arrivals.
 *
 * Only ever touches parcels that have already LEFT: one being prepared has no
 * carrier to ask, one already delivered is a closed fact. A carrier failure is
 * contained to its own parcel — nothing is marked, and the next run asks again.
 */
export async function runShipmentTrackingSync(logger?: Logger): Promise<TrackingSyncSummary> {
  const carriers = trackedCarriers()
  // No carrier account configured: tracking stays manual, as it was.
  if (carriers.length === 0) return { checked: 0, delivered: 0, failed: 0 }

  const inTransit = await db
    .select({
      id: shipments.id,
      orderId: shipments.orderId,
      carrier: shipments.carrier,
      trackingNumber: shipments.trackingNumber,
    })
    .from(shipments)
    .where(
      and(eq(shipments.status, "shipped"), isNotNull(shipments.trackingNumber), inArray(shipments.carrier, carriers)),
    )
    .limit(MAX_PARCELS_PER_RUN)

  const summary: TrackingSyncSummary = { checked: 0, delivered: 0, failed: 0 }
  for (const parcel of inTransit) {
    const outcome = await checkParcel(parcel, logger)
    if (outcome === "delivered") {
      summary.delivered++
      summary.checked++
    } else if (outcome === "checked") summary.checked++
    else if (outcome === "failed") summary.failed++
  }
  return summary
}

/**
 * Start the in-process tracking poll. No-op under tests, when the interval is 0,
 * or when no carrier account is configured — production can instead drive
 * `tracking-cli.ts` from an external cron. Cleared on server close.
 */
export function startShipmentTrackingScheduler(app: FastifyInstance): void {
  const minutes = env.TRACKING_POLL_INTERVAL_MINUTES
  const carriers = trackedCarriers()
  if (env.NODE_ENV === "test" || minutes <= 0 || carriers.length === 0) return

  const timer = setInterval(
    () => {
      runShipmentTrackingSync(app.log)
        .then((r) => {
          if (r.delivered > 0 || r.failed > 0) app.log.info(r, "carrier tracking sync")
        })
        .catch((err) => app.log.error({ err }, "carrier tracking sync failed"))
    },
    minutes * 60 * 1000,
  )
  timer.unref?.()
  app.addHook("onClose", async () => clearInterval(timer))
  app.log.info({ minutes, carriers }, "carrier tracking scheduler started")
}
