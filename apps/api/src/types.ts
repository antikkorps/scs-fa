import type { InferInsertModel, InferSelectModel } from "drizzle-orm"
import type { artworkPrints, orders, products, users } from "./db/schema.js"

// Select (read) types
export type User = InferSelectModel<typeof users>
export type Order = InferSelectModel<typeof orders>
export type Product = InferSelectModel<typeof products>
export type ArtworkPrint = InferSelectModel<typeof artworkPrints>

// Insert (write) types
export type UserInsert = InferInsertModel<typeof users>
export type OrderInsert = InferInsertModel<typeof orders>

// Custom types for API responses
export type OrderItem = {
  variantId?: string
  printId?: string
  qty: number
  priceHt: number
  name: string
  sku: string
  category: string
  requiresPaymentVirement: boolean
}

export type OrderResponse = Omit<Order, "itemsJson"> & {
  itemsJson: OrderItem[]
}
