import { and, eq, isNull, lt, or, sql } from "drizzle-orm"
import { db } from "../db/client.js"
import { productVariants } from "../db/schema.js"

/**
 * How long a unique piece stays held for the shopper who put it in their cart.
 * Long enough to gather identity documents and pick an address, short enough
 * that an abandoned cart doesn't take a one-off item off the market for a day.
 */
export const UNIQUE_PIECE_HOLD_MINUTES = 30

type DbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db

/**
 * SQL predicate: this variant is free to be claimed by `userId`.
 *
 * Free means nobody holds it, the holder is this same shopper (re-adding
 * extends their own hold), or the previous hold has lapsed. Expired holds are
 * **never swept** — they are simply ignored here, which removes both a cron to
 * maintain and any window where a released piece would still look taken.
 */
function claimable(userId: string) {
  return or(
    isNull(productVariants.reservedBy),
    eq(productVariants.reservedBy, userId),
    lt(productVariants.reservedUntil, sql`now()`),
  )
}

/**
 * Claim a unique piece for a shopper's cart. Returns false when someone else
 * currently holds it.
 *
 * This is a compare-and-set: the guard lives in the WHERE clause, so two
 * concurrent shoppers are serialised by the row lock and exactly one update
 * matches — the same technique as the Gun Art print reservation and the order
 * stock decrement.
 */
export async function reserveUniquePiece(
  variantId: string,
  userId: string,
  executor: DbExecutor = db,
): Promise<boolean> {
  const updated = await executor
    .update(productVariants)
    .set({
      reservedBy: userId,
      reservedUntil: sql`now() + interval '${sql.raw(String(UNIQUE_PIECE_HOLD_MINUTES))} minutes'`,
      updatedAt: new Date(),
    })
    .where(and(eq(productVariants.id, variantId), claimable(userId)))
    .returning({ id: productVariants.id })

  return updated.length > 0
}

/**
 * Release a hold. Scoped to the holder, so a stale call can never free a piece
 * somebody else has since claimed. Idempotent: releasing an unheld piece is a
 * no-op, which is what removing an already-removed cart line should do.
 */
export async function releaseUniquePiece(variantId: string, userId: string, executor: DbExecutor = db): Promise<void> {
  await executor
    .update(productVariants)
    .set({ reservedBy: null, reservedUntil: null, updatedAt: new Date() })
    .where(and(eq(productVariants.id, variantId), eq(productVariants.reservedBy, userId)))
}

/**
 * Release every hold belonging to a shopper — used when the whole cart is
 * emptied, and after their order has claimed the stock for good.
 */
export async function releaseAllUniquePieces(userId: string, executor: DbExecutor = db): Promise<void> {
  await executor
    .update(productVariants)
    .set({ reservedBy: null, reservedUntil: null, updatedAt: new Date() })
    .where(eq(productVariants.reservedBy, userId))
}

/**
 * SQL expression telling whether a variant is available to `userId` right now:
 * in stock and not held by anybody else. Used by the public listing and detail
 * so a piece someone is buying shows as momentarily unavailable.
 */
export const isVariantAvailableTo = (userId: string | null) =>
  sql<boolean>`(
    coalesce(${productVariants.stockQty}, 0) > 0
    and (
      ${productVariants.reservedBy} is null
      or ${productVariants.reservedUntil} < now()
      ${userId ? sql`or ${productVariants.reservedBy} = ${userId}` : sql``}
    )
  )`
