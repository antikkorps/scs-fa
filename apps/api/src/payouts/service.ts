import { computePayoutHt, refundFactorFor } from "@armurier/shared"
import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "../db/client.js"
import {
  artists,
  artworkPrints,
  artworks,
  beneficiaries,
  beneficiaryPayouts,
  orders,
  products,
  productVariants,
  refunds,
} from "../db/schema.js"

type DbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db

/** One order line, as it lives in the `orders.items_json` snapshot. */
interface SnapshotLine {
  variantId?: string
  printId?: string
  qty: number
  priceHt: number
  name: string
}

interface ResolvedShare {
  beneficiaryId: string
  sharePct: number
}

/**
 * Who is owed on this line, and at what rate.
 *
 * The rate is looked up **once, at the sale**, and frozen on the payout row —
 * the same discipline as `orders.items_json` freezing the price. Renegotiating
 * a rate tomorrow must never rewrite what was owed yesterday.
 *
 * An artwork's beneficiary is not stored on the artwork: it is the beneficiary
 * of its ARTIST. Only the rate can be renegotiated piece by piece.
 */
async function resolveShare(line: SnapshotLine, tx: DbExecutor): Promise<ResolvedShare | null> {
  if (line.printId) {
    const [row] = await tx
      .select({
        beneficiaryId: artists.beneficiaryId,
        artworkSharePct: artworks.beneficiarySharePct,
        defaultSharePct: beneficiaries.defaultSharePct,
      })
      .from(artworkPrints)
      .innerJoin(artworks, eq(artworkPrints.artworkId, artworks.id))
      .innerJoin(artists, eq(artworks.artistId, artists.id))
      .innerJoin(beneficiaries, eq(artists.beneficiaryId, beneficiaries.id))
      .where(eq(artworkPrints.id, line.printId))
      .limit(1)
    if (!row?.beneficiaryId) return null
    return {
      beneficiaryId: row.beneficiaryId,
      sharePct: Number(row.artworkSharePct ?? row.defaultSharePct),
    }
  }

  if (line.variantId) {
    const [row] = await tx
      .select({
        beneficiaryId: products.beneficiaryId,
        productSharePct: products.beneficiarySharePct,
        defaultSharePct: beneficiaries.defaultSharePct,
      })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .innerJoin(beneficiaries, eq(products.beneficiaryId, beneficiaries.id))
      .where(eq(productVariants.id, line.variantId))
      .limit(1)
    if (!row?.beneficiaryId) return null
    return {
      beneficiaryId: row.beneficiaryId,
      sharePct: Number(row.productSharePct ?? row.defaultSharePct),
    }
  }

  return null
}

/**
 * Record what each beneficiary will be owed on a freshly placed order.
 *
 * Created as `pending`: the order is not paid yet, so nothing is due. A line
 * whose article has no beneficiary produces no row at all — an absent row is
 * clearer than a row worth zero.
 */
export async function createPayoutsForOrder(orderId: string, lines: SnapshotLine[], tx: DbExecutor = db) {
  for (const line of lines) {
    const share = await resolveShare(line, tx)
    if (!share || share.sharePct <= 0) continue

    const baseHt = Math.round(line.priceHt * line.qty * 100) / 100
    const amountHt = computePayoutHt(baseHt, share.sharePct)
    if (amountHt <= 0) continue

    await tx.insert(beneficiaryPayouts).values({
      orderId,
      beneficiaryId: share.beneficiaryId,
      variantId: line.variantId ?? null,
      printId: line.printId ?? null,
      label: line.name.slice(0, 255),
      sharePct: share.sharePct.toFixed(2),
      baseHt: baseHt.toFixed(2),
      amountHt: amountHt.toFixed(2),
    })
  }
}

const PAID_STATUSES = ["received", "reconciled", "partially_refunded"] as const

/**
 * Bring an order's payouts in line with what actually happened to the money.
 *
 * Called whenever an order's payment state moves. It never touches a payout an
 * admin has already settled (`paid`): money that has left the account is a fact,
 * not a projection.
 */
export async function settlePayoutsForOrder(orderId: string, tx: DbExecutor = db) {
  const [order] = await tx
    .select({ paymentStatus: orders.paymentStatus, totalTtc: orders.totalTtc })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)
  if (!order) return

  const rows = await tx
    .select()
    .from(beneficiaryPayouts)
    .where(
      and(eq(beneficiaryPayouts.orderId, orderId), inArray(beneficiaryPayouts.status, ["pending", "due", "cancelled"])),
    )
  if (rows.length === 0) return

  const [{ refunded } = { refunded: "0" }] = await tx
    .select({ refunded: sql<string>`coalesce(sum(${refunds.amountTtc}), 0)` })
    .from(refunds)
    .where(and(eq(refunds.orderId, orderId), eq(refunds.status, "succeeded")))

  const factor = refundFactorFor(Number(order.totalTtc), Number(refunded))
  const payment = order.paymentStatus ?? ""
  const isPaid = (PAID_STATUSES as readonly string[]).includes(payment)
  // ⚠️ A refunded or cancelled order is NOT "not paid yet": it was paid and then
  // undone. Sending it back to `pending` would put it in the queue of sales
  // still waiting for money that is never coming.
  const isVoided = payment === "refunded" || payment === "cancelled"

  for (const row of rows) {
    // The rate and the basis were frozen at the sale; only the refund factor
    // moves, and only downwards.
    const amountHt = computePayoutHt(Number(row.baseHt), Number(row.sharePct), factor)
    const status = isVoided ? "cancelled" : !isPaid ? "pending" : amountHt <= 0 ? "cancelled" : "due"

    await tx
      .update(beneficiaryPayouts)
      .set({ amountHt: amountHt.toFixed(2), status, updatedAt: new Date() })
      .where(eq(beneficiaryPayouts.id, row.id))
  }
}
