import { DEFAULT_SHIPPING_RATES, type ShippingRates } from "@armurier/shared"
import { eq } from "drizzle-orm"
import { db } from "../db/client.js"
import { shippingRates } from "../db/schema.js"

type Executor = Pick<typeof db, "select">

/**
 * The rate grid in force (story 12.3). The migration seeds the single row, so
 * the fallback only covers a database that lost it: delivery is then priced at
 * the default grid — never at zero, which would ship every order at the shop's
 * expense without anyone noticing.
 */
export async function loadShippingRates(executor: Executor = db): Promise<ShippingRates> {
  const [row] = await executor.select().from(shippingRates).where(eq(shippingRates.id, 1)).limit(1)
  if (!row) return DEFAULT_SHIPPING_RATES
  return {
    firearmParcelTtc: Number(row.firearmParcelTtc),
    smallParcelTtc: Number(row.smallParcelTtc),
    smallParcelFreeFromTtc: row.smallParcelFreeFromTtc === null ? null : Number(row.smallParcelFreeFromTtc),
    printTtc: Number(row.printTtc),
  }
}
