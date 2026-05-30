import { isNewFirearmQualifying, PAID_PAYMENT_STATUSES } from "@armurier/shared"
import { asc, eq } from "drizzle-orm"
import { db } from "../db/client.js"
import { orders, users } from "../db/schema.js"

/**
 * Recompute a user's VIP status.
 *
 * A user becomes VIP (unlimited, no expiry) once they have a **paid** order
 * containing at least one **new firearm** (legal category B/C/D, not
 * second-hand/antique). Idempotent: once VIP, stays VIP.
 *
 * Intended to be called on payment confirmation (Phase 6). Returns whether the
 * user is VIP after the check.
 */
export async function recomputeVipStatus(userId: string): Promise<boolean> {
  const [user] = await db.select({ vipActive: users.vipActive }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) return false
  if (user.vipActive) return true

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

  if (!eligibleSince) return false

  await db
    .update(users)
    .set({
      vipActive: true,
      vipStatus: "premium",
      vipEligibleSince: eligibleSince,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
  return true
}
