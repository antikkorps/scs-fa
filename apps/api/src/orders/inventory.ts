import { and, eq, sql } from "drizzle-orm"
import type { DbExecutor } from "../artworks/reservation.js"
import { artworkPrints, type orders, productVariants } from "../db/schema.js"

type OrderLines = (typeof orders.$inferSelect)["itemsJson"]

/**
 * Give back what an order took off the market: variant stock, and the Gun Art
 * prints it had reserved (only those still attached to it). Shared by the full
 * refund (story 6.3) and the cancellation of an unpaid order (story 12.9a).
 * The caller runs it once, inside the transaction that moves the order to its
 * terminal status.
 */
export async function releaseOrderInventory(tx: DbExecutor, orderId: string, lines: OrderLines): Promise<void> {
  for (const line of lines) {
    if (line.variantId) {
      await tx
        .update(productVariants)
        .set({ stockQty: sql`${productVariants.stockQty} + ${line.qty}`, updatedAt: new Date() })
        .where(eq(productVariants.id, line.variantId))
    }
    if (line.printId) {
      await tx
        .update(artworkPrints)
        .set({ status: "available", orderId: null, updatedAt: new Date() })
        .where(and(eq(artworkPrints.id, line.printId), eq(artworkPrints.orderId, orderId)))
    }
  }
}
