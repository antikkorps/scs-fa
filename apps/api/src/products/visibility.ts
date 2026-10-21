import { and, eq, type SQL } from "drizzle-orm"
import { products } from "../db/schema.js"

/**
 * The one condition every public route puts on products: published, and meant
 * for everyone (story 12.8c — a product reserved for pros never surfaces on the
 * public side). A new public route that reads products uses this, never
 * `published` alone.
 */
export function publiclyVisible(): SQL {
  return and(eq(products.published, true), eq(products.audience, "public")) as SQL
}
