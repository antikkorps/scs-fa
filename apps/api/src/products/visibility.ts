import { and, eq, ne, type SQL, sql } from "drizzle-orm"
import { ancientWeapons, productCategories, products } from "../db/schema.js"

/**
 * The one condition every public route puts on products: published, and meant
 * for everyone (story 12.8c — a product reserved for pros never surfaces on the
 * public side). A new public route that reads products uses this, never
 * `published` alone.
 */
export function publiclyVisible(): SQL {
  return and(eq(products.published, true), eq(products.audience, "public")) as SQL
}

/**
 * What an approved pro may ask a quote for (story 12.8c): the published
 * armurerie, reserved for pros or not — never a collection piece nor a Gun Art
 * print, which a pro buys as anyone does. The query must join
 * `productCategories` on the product.
 */
export function proCatalogueVisible(): SQL {
  return and(
    eq(products.published, true),
    ne(productCategories.category, "gun_art"),
    sql`not exists (select 1 from ${ancientWeapons} where ${ancientWeapons.productId} = ${products.id})`,
  ) as SQL
}
