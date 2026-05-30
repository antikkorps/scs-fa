// Pricing helpers shared between API and web.

/** Compute the VAT-inclusive price from a net price, rounded to 2 decimals. */
export function computePriceTtc(priceHt: number, vatPct: number): number {
  return Math.round(priceHt * (1 + vatPct / 100) * 100) / 100
}
