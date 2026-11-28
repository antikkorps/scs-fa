import { sql } from "drizzle-orm"
import { ancientWeapons, artworks, products } from "../db/schema.js"

/**
 * Products that back a Gun Art piece or a collection weapon are edited through
 * THEIR OWN screens, which know about editions and provenance. Letting them
 * through the generic product screens would offer an admin a way to
 * desynchronise the pair.
 */
export const GENERIC_ONLY = sql`not exists (select 1 from ${artworks} where ${artworks.productId} = ${products.id})
  and not exists (select 1 from ${ancientWeapons} where ${ancientWeapons.productId} = ${products.id})`
