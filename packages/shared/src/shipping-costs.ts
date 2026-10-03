import { round2 } from "./pricing.js"
import { FIREARM_CATEGORY_SLUGS } from "./shipping.js"

// Story 12.3 — shipping costs at checkout. Pure: the cart, the order and the
// admin preview all price delivery with these very rules.
//
// The model is a flat rate per shipping class, because the catalogue holds no
// weights (supplier imports do not provide them):
//   - firearm   — one rate PER PARCEL (a category B weapon travels in two),
//                 insured and signed-for delivery included;
//   - small     — ammunition, optics, accessories: ONE rate per order, waived
//                 above a threshold;
//   - print     — Gun Art: one rate PER PRINT (dedicated packaging).
// Rates are VAT-inclusive, as the customer reads them. The VIP discount never
// applies to shipping.

export const SHIPPING_CLASSES = ["firearm", "small", "print"] as const
export type ShippingClass = (typeof SHIPPING_CLASSES)[number]

/** The rate grid, edited in the back office. Amounts in euros TTC. */
export interface ShippingRates {
  firearmParcelTtc: number
  smallParcelTtc: number
  /** Small-parcel shipping is free from this goods amount (TTC); null = never free. */
  smallParcelFreeFromTtc: number | null
  printTtc: number
}

/**
 * The grid seeded by the migration, until the client sends theirs. Kept here so
 * a test or a fresh database never prices delivery at zero by accident.
 */
export const DEFAULT_SHIPPING_RATES: ShippingRates = {
  firearmParcelTtc: 25,
  smallParcelTtc: 8.9,
  smallParcelFreeFromTtc: 150,
  printTtc: 15,
}

/** One cart or order line, as far as shipping is concerned. */
export interface ShippableLine {
  kind: "product" | "print"
  categorySlug: string
  qty: number
  /** Parcels one unit travels in (products only; prints are always 1). */
  parcelCount: number
  vatPct: number
  /** Net HT of the line, VIP discount applied — the prorata key. */
  netHt: number
  /** What the customer pays for the line, TTC — the free-shipping key. */
  lineTtc: number
  requiresPaymentVirement: boolean
}

/**
 * A slice of the shipping cost tied to one line: it carries that line's VAT rate
 * and payment bucket, so a mixed-rate cart is taxed pro rata and a transfer-only
 * firearm's delivery is paid by transfer with it.
 */
export interface ShippingPortion {
  amountTtc: number
  priceHt: number
  vatAmount: number
  vatPct: number
  requiresPaymentVirement: boolean
}

export interface ShippingBreakdownEntry {
  shippingClass: ShippingClass
  /** Parcels for `firearm`, prints for `print`, 1 for `small`. */
  units: number
  amountTtc: number
}

export interface ShippingQuote {
  totalTtc: number
  totalHt: number
  vatAmount: number
  /** One entry per class present in the cart, free small parcels included (at 0). */
  breakdown: ShippingBreakdownEntry[]
  /** True when small parcels were present and travel free thanks to the threshold. */
  smallParcelFree: boolean
  /** How much more small goods (TTC) would make small-parcel shipping free; null when not applicable. */
  smallParcelFreeRemainingTtc: number | null
  portions: ShippingPortion[]
}

export function shippingClassOf(line: Pick<ShippableLine, "kind" | "categorySlug">): ShippingClass {
  if (line.kind === "print") return "print"
  return FIREARM_CATEGORY_SLUGS.includes(line.categorySlug) ? "firearm" : "small"
}

function toCents(n: number): number {
  return Math.round(n * 100)
}

/** Split a TTC amount into HT + VAT at one rate, so that HT + VAT is exactly the TTC. */
function portionOf(amountTtc: number, line: ShippableLine): ShippingPortion {
  const priceHt = round2(amountTtc / (1 + line.vatPct / 100))
  return {
    amountTtc,
    priceHt,
    vatAmount: round2(amountTtc - priceHt),
    vatPct: line.vatPct,
    requiresPaymentVirement: line.requiresPaymentVirement,
  }
}

/**
 * Spread `amountTtc` over `lines` pro rata of their net HT, to the cent: the
 * largest-remainder method guarantees the slices add up to the amount exactly.
 */
function allocate(amountTtc: number, lines: ShippableLine[]): ShippingPortion[] {
  const cents = toCents(amountTtc)
  const weights = lines.map((l) => Math.max(l.netHt, 0))
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  // All lines free (e.g. a 100% discount): share evenly rather than divide by zero.
  const shares = totalWeight > 0 ? weights.map((w) => (cents * w) / totalWeight) : lines.map(() => cents / lines.length)
  const left = cents - shares.reduce((sum, s) => sum + Math.floor(s), 0)
  // The `left` cents the floors dropped go to the largest remainders (ties: first line).
  const bonus = new Set(
    shares
      .map((s, i) => ({ i, r: s - Math.floor(s) }))
      .sort((a, b) => b.r - a.r || a.i - b.i)
      .slice(0, left)
      .map(({ i }) => i),
  )
  return lines
    .map((l, i) => portionOf((Math.floor(shares[i] ?? 0) + (bonus.has(i) ? 1 : 0)) / 100, l))
    .filter((p) => p.amountTtc > 0)
}

/** Price the delivery of a cart (or an order being placed) against a rate grid. */
export function computeShippingCost(lines: readonly ShippableLine[], rates: ShippingRates): ShippingQuote {
  const breakdown: ShippingBreakdownEntry[] = []
  const portions: ShippingPortion[] = []

  const firearms = lines.filter((l) => shippingClassOf(l) === "firearm")
  if (firearms.length > 0) {
    let parcels = 0
    for (const line of firearms) {
      const lineParcels = line.qty * Math.max(1, Math.trunc(line.parcelCount) || 1)
      parcels += lineParcels
      const amount = round2(lineParcels * rates.firearmParcelTtc)
      if (amount > 0) portions.push(portionOf(amount, line))
    }
    breakdown.push({ shippingClass: "firearm", units: parcels, amountTtc: round2(parcels * rates.firearmParcelTtc) })
  }

  const small = lines.filter((l) => shippingClassOf(l) === "small")
  let smallParcelFree = false
  let smallParcelFreeRemainingTtc: number | null = null
  if (small.length > 0) {
    const goodsTtc = round2(small.reduce((sum, l) => sum + l.lineTtc, 0))
    const threshold = rates.smallParcelFreeFromTtc
    smallParcelFree = threshold !== null && goodsTtc >= threshold
    if (threshold !== null && !smallParcelFree) smallParcelFreeRemainingTtc = round2(threshold - goodsTtc)
    const amount = smallParcelFree ? 0 : rates.smallParcelTtc
    if (amount > 0) portions.push(...allocate(amount, small))
    breakdown.push({ shippingClass: "small", units: 1, amountTtc: amount })
  }

  const prints = lines.filter((l) => shippingClassOf(l) === "print")
  if (prints.length > 0) {
    let units = 0
    for (const line of prints) {
      units += line.qty
      const amount = round2(line.qty * rates.printTtc)
      if (amount > 0) portions.push(portionOf(amount, line))
    }
    breakdown.push({ shippingClass: "print", units, amountTtc: round2(units * rates.printTtc) })
  }

  const totalTtc = toCents(portions.reduce((sum, p) => sum + p.amountTtc, 0)) / 100
  const totalHt = toCents(portions.reduce((sum, p) => sum + p.priceHt, 0)) / 100
  return {
    totalTtc,
    totalHt,
    vatAmount: round2(totalTtc - totalHt),
    breakdown,
    smallParcelFree,
    smallParcelFreeRemainingTtc,
    portions,
  }
}

/**
 * Whether the shop delivers to an address: metropolitan France, Corsica
 * included (CGV art. 7). Overseas departments and territories (postcodes 97x /
 * 98x) are a different tax territory and are refused, as is anything abroad.
 */
export function isDeliverableAddress(address: { country: string; postal: string }): boolean {
  if (address.country.trim().toUpperCase() !== "FR") return false
  // Corsica's postcodes are 20xxx (2A/2B are department codes, not postcodes).
  return /^(?:0[1-9]|[1-8]\d|9[0-5])\d{3}$/.test(address.postal.trim())
}

/** Customer-facing label of a breakdown entry. */
export function shippingClassLabel(entry: Pick<ShippingBreakdownEntry, "shippingClass" | "units">): string {
  const plural = entry.units > 1 ? "s" : ""
  switch (entry.shippingClass) {
    case "firearm":
      return `Arme — ${entry.units} colis assuré${plural}, remise contre signature`
    case "small":
      return "Munitions et accessoires"
    case "print":
      return `Tirage${plural} Gun Art — ${entry.units} envoi${plural} sous emballage dédié`
  }
}
