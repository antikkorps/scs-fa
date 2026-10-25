// What every way of placing an order shares — the shop's checkout (POST
// /api/orders) and, since story 12.8d, the acceptance of a pro quote: the
// address snapshot, the guarded stock decrement, the payment buckets.

import { randomBytes } from "node:crypto"
import { type PaymentSplit, virementReferenceFromBytes } from "@armurier/shared"
import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm"
import type { DbExecutor } from "../artworks/reservation.js"
import { addresses, type OrderAddressSnapshot, paymentCarte, paymentVirement, productVariants } from "../db/schema.js"
import { env } from "../env.js"

export class OrderError extends Error {
  constructor(
    readonly statusCode: number,
    readonly errorCode: string,
    message: string,
  ) {
    super(message)
  }
}

export const ADDRESS_FIELDS = {
  firstName: addresses.firstName,
  lastName: addresses.lastName,
  line1: addresses.line1,
  line2: addresses.line2,
  postal: addresses.postal,
  city: addresses.city,
  country: addresses.country,
  phone: addresses.phone,
} as const

export function toSnapshot(a: {
  firstName: string
  lastName: string
  line1: string
  line2: string | null
  postal: string
  city: string
  country: string
  phone: string | null
}): OrderAddressSnapshot {
  return {
    firstName: a.firstName,
    lastName: a.lastName,
    line1: a.line1,
    line2: a.line2,
    postal: a.postal,
    city: a.city,
    country: a.country,
    phone: a.phone,
  }
}

/**
 * Decrement variant stock atomically (guard prevents overselling). The guard
 * also honours a unique-piece hold (story 11.2): a lapsed hold that someone
 * else has re-claimed must block this order, otherwise the hold would mean
 * nothing at the one moment it matters.
 */
export async function decrementVariantStock(
  tx: DbExecutor,
  lines: ReadonlyArray<{ variantId: string; qty: number; sku: string }>,
  userId: string,
): Promise<void> {
  for (const line of lines) {
    const updated = await tx
      .update(productVariants)
      .set({
        stockQty: sql`${productVariants.stockQty} - ${line.qty}`,
        reservedBy: null,
        reservedUntil: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productVariants.id, line.variantId),
          gte(productVariants.stockQty, line.qty),
          or(
            isNull(productVariants.reservedBy),
            eq(productVariants.reservedBy, userId),
            lt(productVariants.reservedUntil, sql`now()`),
          ),
        ),
      )
      .returning({ id: productVariants.id })
    if (updated.length === 0) {
      throw new OrderError(409, "InsufficientStock", `Insufficient stock for ${line.sku}`)
    }
  }
}

/**
 * The card-payable amount (story 6.1 attaches a Stripe PaymentIntent to its
 * row) and the bank-transfer bucket (story 6.2). The RIB is snapshotted from
 * env onto the row so later config changes never rewrite an order's
 * already-issued instructions, and a unique, typo-resistant reference is
 * allocated for the customer's transfer label / admin reconciliation.
 */
export async function insertPaymentBuckets(tx: DbExecutor, orderId: string, split: PaymentSplit): Promise<void> {
  if (split.carte.amountTtc > 0) {
    await tx.insert(paymentCarte).values({
      orderId,
      amountTtc: split.carte.amountTtc.toFixed(2),
      currency: "EUR",
      paymentStatus: "pending",
    })
  }

  if (split.virement.amountTtc > 0) {
    let reference = virementReferenceFromBytes(randomBytes(8))
    for (let attempt = 0; attempt < 5; attempt++) {
      const [clash] = await tx
        .select({ id: paymentVirement.id })
        .from(paymentVirement)
        .where(eq(paymentVirement.paymentReference, reference))
        .limit(1)
      if (!clash) break
      reference = virementReferenceFromBytes(randomBytes(8))
    }
    await tx.insert(paymentVirement).values({
      orderId,
      amountExpectedTtc: split.virement.amountTtc.toFixed(2),
      currency: "EUR",
      ibanRecipient: env.VIREMENT_IBAN,
      bicRecipient: env.VIREMENT_BIC,
      bankName: env.VIREMENT_BANK_NAME,
      accountHolderName: env.VIREMENT_ACCOUNT_HOLDER,
      paymentReference: reference,
      paymentStatus: "awaiting_transfer",
    })
  }
}
