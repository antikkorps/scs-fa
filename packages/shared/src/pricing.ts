// Pricing helpers shared between API and web.

/** Round a monetary amount to 2 decimals (cents). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Compute the VAT-inclusive price from a net price, rounded to 2 decimals. */
export function computePriceTtc(priceHt: number, vatPct: number): number {
  return round2(priceHt * (1 + vatPct / 100))
}

export interface TaxableAmount {
  priceHt: number
  vatPct: number
}

export interface VatRateTotal {
  vatPct: number
  totalHt: number
  vatAmount: number
}

export interface VatTotals {
  totalHt: number
  vatAmount: number
  totalTtc: number
  /** One entry per VAT rate, in the order the rates first appear. */
  byRate: VatRateTotal[]
}

/**
 * VAT of a whole order the way an invoice computes it, and the way Henrri does
 * (story 12.6): the HT of each rate is added up first, then its VAT is rounded
 * once, half a cent going up. Integer cents and basis points, so binary floating
 * point never tips a rounding.
 */
export function computeVatTotals(amounts: TaxableAmount[]): VatTotals {
  const htCentsByRate = new Map<number, number>()
  for (const { priceHt, vatPct } of amounts) {
    htCentsByRate.set(vatPct, (htCentsByRate.get(vatPct) ?? 0) + Math.round(priceHt * 100))
  }

  let totalHtCents = 0
  let vatCents = 0
  const byRate: VatRateTotal[] = []
  for (const [vatPct, htCents] of htCentsByRate) {
    const rateVatCents = vatCentsOf(htCents, vatPct)
    totalHtCents += htCents
    vatCents += rateVatCents
    byRate.push({ vatPct, totalHt: htCents / 100, vatAmount: rateVatCents / 100 })
  }
  return {
    totalHt: totalHtCents / 100,
    vatAmount: vatCents / 100,
    totalTtc: (totalHtCents + vatCents) / 100,
    byRate,
  }
}

/** VAT in cents of `htCents` at `vatPct`, half a cent rounded away from zero. */
function vatCentsOf(htCents: number, vatPct: number): number {
  const basisPoints = Math.round(vatPct * 100)
  const magnitude = Math.floor((Math.abs(htCents) * basisPoints + 5_000) / 10_000)
  return htCents < 0 ? -magnitude : magnitude
}
