import { orderReference } from "@armurier/shared"
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm"
import type { FastifyBaseLogger, FastifyInstance } from "fastify"
import { db } from "../db/client.js"
import { orders, paymentCarte, paymentVirement, users } from "../db/schema.js"
import { sendOrderConfirmationEmail } from "../email.js"
import { env } from "../env.js"

type Logger = Pick<FastifyBaseLogger, "warn" | "error">

/**
 * An order left unconfirmed this long is picked up by the retry pass: long
 * enough never to race the send fired by the checkout itself.
 */
export const CONFIRMATION_RETRY_AFTER_MINUTES = 5

/**
 * Send the order confirmation (story 12.1, art. L221-13) — at most once.
 *
 * The order is CLAIMED first (`confirmation_sent_at` set only if still empty),
 * so the checkout and a retry pass can never both mail it. If the provider
 * fails, the claim is released and the retry pass tries again later.
 * Never throws: a mail outage must not undo or fail an order.
 */
export async function sendOrderConfirmation(orderId: string, log: Logger): Promise<boolean> {
  const [claimed] = await db
    .update(orders)
    .set({ confirmationSentAt: new Date() })
    .where(and(eq(orders.id, orderId), isNull(orders.confirmationSentAt)))
    .returning({ id: orders.id })
  if (!claimed) return false

  try {
    const [row] = await db
      .select({
        order: orders,
        email: users.email,
        firstName: users.firstname,
        cardTtc: paymentCarte.amountTtc,
        transferTtc: paymentVirement.amountExpectedTtc,
        transferReference: paymentVirement.paymentReference,
      })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.userId))
      .leftJoin(paymentCarte, eq(paymentCarte.orderId, orders.id))
      .leftJoin(paymentVirement, eq(paymentVirement.orderId, orders.id))
      .where(eq(orders.id, orderId))
      .limit(1)
    // Pre-12.1 orders have no accepted CGV to send: nothing to confirm.
    const termsVersion = row?.order.termsVersion
    if (!row || !termsVersion) return false

    const { order } = row
    const address = order.shippingAddress
    await sendOrderConfirmationEmail(row.email, {
      orderId: order.id,
      orderRef: orderReference(order.id),
      placedAt: order.createdAt ?? new Date(),
      firstName: row.firstName,
      lines: order.itemsJson.map((l) => ({ name: l.name, qty: l.qty })),
      subtotalHt: Number(order.subtotalHt),
      vipDiscount: Number(order.vipDiscountAmount ?? 0),
      vat: Number(order.vatAmount),
      totalTtc: Number(order.totalTtc),
      cardTtc: Number(row.cardTtc ?? 0),
      transferTtc: Number(row.transferTtc ?? 0),
      transferReference: row.transferReference,
      requiresLegalVerification: order.legalVerificationStatus === "pending",
      shippingAddress: address
        ? [
            `${address.firstName} ${address.lastName}`,
            address.line1,
            ...(address.line2 ? [address.line2] : []),
            `${address.postal} ${address.city}`,
          ]
        : [],
      termsVersion,
    })
    return true
  } catch (err) {
    await db.update(orders).set({ confirmationSentAt: null }).where(eq(orders.id, orderId))
    log.warn({ err, orderId }, "Order confirmation e-mail failed — released for the retry pass")
    return false
  }
}

/**
 * Retry pass: every order placed under accepted CGV whose confirmation has not
 * gone out (provider down at checkout, process restarted mid-send…).
 */
export async function resendPendingConfirmations(log: Logger): Promise<{ pending: number; sent: number }> {
  const pending = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        isNull(orders.confirmationSentAt),
        isNotNull(orders.termsVersion),
        lt(orders.createdAt, sql`now() - make_interval(mins => ${CONFIRMATION_RETRY_AFTER_MINUTES})`),
      ),
    )
  let sent = 0
  for (const { id } of pending) {
    if (await sendOrderConfirmation(id, log)) sent++
  }
  return { pending: pending.length, sent }
}

/** In-process retry pass, same pattern as the legal-document SLA check. */
export function startOrderConfirmationScheduler(app: FastifyInstance): void {
  const minutes = env.ORDER_CONFIRMATION_RETRY_MINUTES
  if (env.NODE_ENV === "test" || minutes <= 0) return

  const timer = setInterval(
    () => {
      resendPendingConfirmations(app.log)
        .then((r) => {
          if (r.pending > 0) app.log.warn(r, "order confirmation retry pass")
        })
        .catch((err) => app.log.error({ err }, "order confirmation retry pass failed"))
    },
    minutes * 60 * 1000,
  )
  timer.unref?.()
  app.addHook("onClose", async () => clearInterval(timer))
  app.log.info({ minutes }, "order confirmation retry scheduler started")
}
