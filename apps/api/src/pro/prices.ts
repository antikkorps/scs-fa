import { computePriceTtc } from "@armurier/shared"
import type { ProOrganisation } from "./access.js"

// Story 12.8c — a pro never receives the public price. With « afficher les
// prix » on, they get their net price: the public price excluding VAT, less
// their organisation's discount (decision 2026-10-19); without it, nothing.

const roundCents = (amount: number) => Math.round(amount * 100) / 100

export interface NetPrices {
  netPriceHt: number | null
  netPriceTtc: number | null
}

export function netPrices(publicPriceHt: number, vatPct: number, organisation: ProOrganisation): NetPrices {
  if (!organisation.showPrices) return { netPriceHt: null, netPriceTtc: null }
  const netPriceHt = roundCents(publicPriceHt * (1 - organisation.discountPct / 100))
  return { netPriceHt, netPriceTtc: computePriceTtc(netPriceHt, vatPct) }
}

/** The same item, its public prices replaced by the pro's. */
export function withNetPrices<T extends { priceHt: number; priceTtc: number }>(
  item: T,
  vatPct: number,
  organisation: ProOrganisation,
): Omit<T, "priceHt" | "priceTtc" | "priceDeltaHt"> & NetPrices {
  const { priceHt, priceTtc: _priceTtc, priceDeltaHt: _priceDeltaHt, ...rest } = item as T & { priceDeltaHt?: number }
  return { ...rest, ...netPrices(priceHt, vatPct, organisation) }
}
