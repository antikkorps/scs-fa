import { CART_HOLD_MINUTES } from "@armurier/shared"
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm"
import { type Database, db } from "../db/client.js"
import { artworkCartItems, artworkPrints } from "../db/schema.js"

// Either the root db handle or a transaction handle, so callers can compose a
// reservation with other writes (cart insert, order creation) in one atomic unit.
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0]
export type DbExecutor = Database | Tx

/**
 * Atomically claim an available print for a shopper's cart.
 *
 * The status guard lives in the WHERE clause, so the `available -> in_cart`
 * flip is a compare-and-set: of two shoppers racing for the same numbered
 * print, exactly one UPDATE matches a row and wins; the other matches nothing.
 * Returns the claimed row, or `null` when the print wasn't available.
 */
export async function reservePrintForCart(printId: string, exec: DbExecutor = db) {
  const [claimed] = await exec
    .update(artworkPrints)
    .set({ status: "in_cart", updatedAt: new Date() })
    .where(and(eq(artworkPrints.id, printId), eq(artworkPrints.status, "available")))
    .returning({
      id: artworkPrints.id,
      priceHtUnit: artworkPrints.priceHtUnit,
      printDesignation: artworkPrints.printDesignation,
    })
  return claimed ?? null
}

/**
 * Release a print held in a cart back to `available`. Guarded on `in_cart` so a
 * print that was meanwhile sold/reserved/cancelled is never resurrected.
 */
export async function releasePrintFromCart(printId: string, exec: DbExecutor = db) {
  const [released] = await exec
    .update(artworkPrints)
    .set({ status: "available", updatedAt: new Date() })
    .where(and(eq(artworkPrints.id, printId), eq(artworkPrints.status, "in_cart")))
    .returning({ id: artworkPrints.id })
  return released ?? null
}

/**
 * Promote a cart-held print to a placed order (`in_cart -> reserved`), stamping
 * the owning order. Guarded on `in_cart`: only the shopper currently holding the
 * print can convert it, and a concurrent double-checkout matches no row.
 */
export async function reservePrintForOrder(printId: string, orderId: string, exec: DbExecutor = db) {
  const [reserved] = await exec
    .update(artworkPrints)
    .set({ status: "reserved", orderId, updatedAt: new Date() })
    .where(and(eq(artworkPrints.id, printId), eq(artworkPrints.status, "in_cart")))
    .returning({ id: artworkPrints.id })
  return reserved ?? null
}

// Story 12.9a — a print stays held CART_HOLD_MINUTES after it entered the cart.
const holdStart = sql`now() - make_interval(mins => ${CART_HOLD_MINUTES})`

/** Cart lines whose print is still held: the only ones the cart shows and the checkout takes. */
export const printHoldActive = () => gte(artworkCartItems.addedAt, holdStart)

/** When the print of a cart line stops being held. */
export function printHeldUntil(addedAt: Date): Date {
  return new Date(addedAt.getTime() + CART_HOLD_MINUTES * 60 * 1000)
}

/**
 * Put back on sale the prints whose hold has lapsed (story 12.9a): their cart
 * lines go, and the prints return to `available` — guarded on `in_cart`, so a
 * print ordered meanwhile is never touched. Returns how many lines went.
 */
export async function releaseLapsedPrintHolds(): Promise<number> {
  return db.transaction(async (tx) => {
    const lapsed = await tx
      .delete(artworkCartItems)
      .where(lt(artworkCartItems.addedAt, holdStart))
      .returning({ printId: artworkCartItems.printId })
    if (lapsed.length === 0) return 0
    await tx
      .update(artworkPrints)
      .set({ status: "available", updatedAt: new Date() })
      .where(
        and(
          inArray(
            artworkPrints.id,
            lapsed.map((line) => line.printId),
          ),
          eq(artworkPrints.status, "in_cart"),
        ),
      )
    return lapsed.length
  })
}
