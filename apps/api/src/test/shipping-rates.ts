import type { ShippingRates } from "@armurier/shared"
import { db } from "../db/client.js"
import { shippingRates } from "../db/schema.js"
import { loadShippingRates } from "../shipping-rates/service.js"

/** The grid the order and cart suites price against, whatever the database holds. */
export const TEST_SHIPPING_RATES: ShippingRates = {
  firearmParcelTtc: 25,
  smallParcelTtc: 9,
  smallParcelFreeFromTtc: 150,
  printTtc: 15,
}

async function writeRates(rates: ShippingRates) {
  const values = {
    firearmParcelTtc: rates.firearmParcelTtc.toFixed(2),
    smallParcelTtc: rates.smallParcelTtc.toFixed(2),
    smallParcelFreeFromTtc: rates.smallParcelFreeFromTtc === null ? null : rates.smallParcelFreeFromTtc.toFixed(2),
    printTtc: rates.printTtc.toFixed(2),
  }
  await db
    .insert(shippingRates)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: shippingRates.id, set: values })
}

/**
 * Pin the (global, single-row) shipping grid for a suite; returns the function
 * that puts the previous grid back. Test files run one at a time, so a pinned
 * grid cannot leak into a concurrent suite.
 */
export async function pinShippingRates(rates: ShippingRates = TEST_SHIPPING_RATES): Promise<() => Promise<void>> {
  const previous = await loadShippingRates()
  await writeRates(rates)
  return () => writeRates(previous)
}
