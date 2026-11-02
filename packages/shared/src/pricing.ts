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

/**
 * The HT, in cents, whose VAT-inclusive total is exactly `ttcCents` once Henrri
 * rounds the VAT (half a cent up), or null when none does: at 20 %, about one TTC
 * amount in six has no such HT (33.33 € sits between 27.77 → 33.32 and 27.78 →
 * 33.34). Used to enter a refund's credit note in HT (story 12.6).
 */
export function htCentsForTtc(ttcCents: number, vatPct: number): number | null {
  const estimate = Math.round(ttcCents / (1 + vatPct / 100))
  for (const htCents of [estimate, estimate - 1, estimate + 1]) {
    if (htCents + vatCentsOf(htCents, vatPct) === ttcCents) return htCents
  }
  return null
}

/** What the VAT-included totals need of a line: its rate and its VIP discount. */
export interface RetailLine {
  vatPct: number
  /** VIP discount on the whole line, HT. */
  discountHt: number
}

export interface RetailTotals {
  /** Goods before the VIP discount, VAT included. */
  itemsTtc: number
  vipDiscountTtc: number
  shippingTtc: number
  /** VAT the total includes ("dont TVA"). */
  vatAmount: number
  totalTtc: number
}

/** A line's price VAT included, before any VIP discount. */
export function lineTtc(line: { priceHt: number; qty: number; vatPct: number }): number {
  return computePriceTtc(line.priceHt * line.qty, line.vatPct)
}

/**
 * The totals an individual reads, VAT included (audit 2026-11-01, I4; pros keep
 * HT). The total and the VAT stay the ones computed by rate (computeVatTotals);
 * the goods row takes the rounding cent so goods − discount + delivery = total.
 */
export function retailTotals(input: {
  lines: RetailLine[]
  shippingTtc: number
  vatAmount: number
  totalTtc: number
}): RetailTotals {
  const vipDiscountTtc = round2(
    input.lines.reduce((sum, line) => sum + computePriceTtc(line.discountHt, line.vatPct), 0),
  )
  return {
    itemsTtc: round2(input.totalTtc - input.shippingTtc + vipDiscountTtc),
    vipDiscountTtc,
    shippingTtc: input.shippingTtc,
    vatAmount: input.vatAmount,
    totalTtc: input.totalTtc,
  }
}

/**
 * How an order is told to its buyer: VAT included for an individual, or null to
 * keep the HT breakdown — for a pro order, born of a quote and priced HT like it,
 * and for an old order whose lines never recorded their VAT rate.
 */
export function orderRetailTotals(order: {
  quoteRequestId: string | null | undefined
  items: Array<{ vatPct?: number; discountHt?: number }>
  shippingTtc: number
  vatAmount: number
  totalTtc: number
}): RetailTotals | null {
  if (order.quoteRequestId) return null
  const lines: RetailLine[] = []
  for (const item of order.items) {
    if (item.vatPct === undefined) return null
    lines.push({ vatPct: item.vatPct, discountHt: item.discountHt ?? 0 })
  }
  return retailTotals({
    lines,
    shippingTtc: order.shippingTtc,
    vatAmount: order.vatAmount,
    totalTtc: order.totalTtc,
  })
}
