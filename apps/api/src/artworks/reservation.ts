import { and, eq } from "drizzle-orm"
import { type Database, db } from "../db/client.js"
import { artworkPrints } from "../db/schema.js"

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
