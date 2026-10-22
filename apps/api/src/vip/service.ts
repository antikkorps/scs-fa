import { keepsQualifyingFirearm, PAID_PAYMENT_STATUSES } from "@armurier/shared"
import { and, asc, eq, inArray } from "drizzle-orm"
import { db } from "../db/client.js"
import { orders, refunds, users } from "../db/schema.js"

/**
 * Recompute a user's VIP status from scratch.
 *
 * A user is VIP (unlimited, no expiry) when they have an order that is **paid
 * and whose legal documents SCS has validated** — its lifecycle is `completed` —
 * and that still holds at least one **new firearm** (legal category B/C/D, not
 * second-hand/antique) once its returns are counted (story 12.9e, Franck
 * 2026-10-22). Returning that firearm revokes VIP, in a partial refund too; a
 * full refund drops the order out of `PAID_PAYMENT_STATUSES` anyway.
 * Bidirectional and idempotent; already-correct state is left untouched (the
 * original `vipEligibleSince` is preserved rather than re-stamped).
 *
 * Called on payment, on document validation (via the legal status) and on
 * refund. Returns the resulting status.
 */
export async function recomputeVipStatus(userId: string): Promise<boolean> {
  const [user] = await db.select({ vipActive: users.vipActive }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) return false

  const userOrders = await db
    .select({
      id: orders.id,
      itemsJson: orders.itemsJson,
      paymentStatus: orders.paymentStatus,
      legalVerificationStatus: orders.legalVerificationStatus,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(asc(orders.createdAt))

  const candidates = userOrders.filter(
    (order) => PAID_PAYMENT_STATUSES.includes(order.paymentStatus) && order.legalVerificationStatus === "completed",
  )
  const returns =
    candidates.length === 0
      ? []
      : await db
          .select({ orderId: refunds.orderId, lines: refunds.lines })
          .from(refunds)
          .where(
            and(
              inArray(
                refunds.orderId,
                candidates.map((order) => order.id),
              ),
              eq(refunds.status, "succeeded"),
              eq(refunds.kind, "goods_return"),
            ),
          )

  const qualifying = candidates.find((order) => {
    const returned = returns.filter((r) => r.orderId === order.id).flatMap((r) => r.lines ?? [])
    return keepsQualifyingFirearm(order.itemsJson, returned)
  })
  const eligibleSince = qualifying?.createdAt ?? null

  const shouldBeVip = qualifying !== undefined
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
