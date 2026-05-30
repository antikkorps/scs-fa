// Pricing helpers shared between API and web.

/** Round a monetary amount to 2 decimals (cents). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Compute the VAT-inclusive price from a net price, rounded to 2 decimals. */
export function computePriceTtc(priceHt: number, vatPct: number): number {
  return round2(priceHt * (1 + vatPct / 100))
}
