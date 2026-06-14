import { isNewFirearmQualifying, PAID_PAYMENT_STATUSES } from "@armurier/shared"
import { asc, eq } from "drizzle-orm"
import { db } from "../db/client.js"
import { orders, users } from "../db/schema.js"

/**
 * Recompute a user's VIP status from scratch.
 *
 * A user is VIP (unlimited, no expiry) when they have a **paid** order
 * containing at least one **new firearm** (legal category B/C/D, not
 * second-hand/antique). Bidirectional and idempotent: it grants VIP when an
 * eligible paid order exists and **revokes** it when none does — a full refund
 * (Story 6.4) drops the order out of `PAID_PAYMENT_STATUSES`, so the user loses
 * VIP if it was their only qualifying purchase. A partial refund keeps the order
 * paid, so VIP stands. Already-correct state is left untouched (the original
 * `vipEligibleSince` is preserved rather than re-stamped).
 *
 * Called on payment confirmation and on refund. Returns the resulting status.
 */
export async function recomputeVipStatus(userId: string): Promise<boolean> {
  const [user] = await db.select({ vipActive: users.vipActive }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) return false

  const userOrders = await db
    .select({
      itemsJson: orders.itemsJson,
      paymentStatus: orders.paymentStatus,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(asc(orders.createdAt))

  let eligibleSince: Date | null = null
  for (const order of userOrders) {
    if (!PAID_PAYMENT_STATUSES.includes(order.paymentStatus)) continue
    const qualifies = order.itemsJson.some((i) => isNewFirearmQualifying(i.legalCategory, i.category))
    if (qualifies) {
      eligibleSince = order.createdAt
      break
    }
  }

  const shouldBeVip = eligibleSince !== null
  if (shouldBeVip === user.vipActive) return shouldBeVip // no transition — leave state as-is

  await db
    .update(users)
    .set(
      shouldBeVip
        ? { vipActive: true, vipStatus: "premium", vipEligibleSince: eligibleSince, updatedAt: new Date() }
        : { vipActive: false, vipStatus: null, vipEligibleSince: null, updatedAt: new Date() },
    )
    .where(eq(users.id, userId))
  return shouldBeVip
}
