import { round2 } from "./pricing.js"

// Per-article profitability (story 11.10).
//
// The client's question is "what does this piece actually earn us?", and the
// honest answer has to subtract what is owed to a third party. Two people are
// paid on a sale:
//   - **Sylvain** (artist): the shop sells Gun Art prints ON HIS BEHALF;
//   - **Florian** (advisor): the gunsmiths buy collection pieces on his advice
//     and pay him a commission when they sell.
// A margin that ignored them would be a number that reads as profit and is not.

/** What an article costs and owes, before it is sold. */
export interface ProfitabilityInput {
  /** Selling price, excl. VAT. */
  priceHt: number
  /** What the piece was bought for, excl. VAT. Unknown = 0, and the margin says so. */
  costPriceHt?: number | null
  /** Charges as a share of the selling price. Ignored when `chargesAmountHt` is set. */
  chargesPct?: number | null
  /** Charges as a flat amount — takes precedence over the percentage. */
  chargesAmountHt?: number | null
  /** Fallback used when the article carries neither charge field. */
  defaultChargesPct?: number | null
  /** Share of the sale owed to a third party. */
  beneficiarySharePct?: number | null
}

export interface Profitability {
  priceHt: number
  costPriceHt: number
  chargesHt: number
  payoutHt: number
  /** priceHt − cost − charges − payout. Negative when the article loses money. */
  marginHt: number
  /** Margin as a share of the selling price; 0 when the price is 0. */
  marginPct: number
  /** True when nothing is known of the cost — the margin is then an upper bound, not a fact. */
  costUnknown: boolean
}

function clampPct(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 100)
}

/**
 * Charges: a flat amount wins over a percentage, and the global default only
 * applies when the article says nothing at all.
 *
 * ⚠️ `0` is an answer, not an absence: an article explicitly set to 0% of
 * charges must NOT silently fall back to the global default.
 */
export function resolveChargesHt(priceHt: number, input: ProfitabilityInput): number {
  if (input.chargesAmountHt !== null && input.chargesAmountHt !== undefined) {
    return round2(Math.max(input.chargesAmountHt, 0))
  }
  if (input.chargesPct !== null && input.chargesPct !== undefined) {
    return round2((priceHt * clampPct(input.chargesPct)) / 100)
  }
  return round2((priceHt * clampPct(input.defaultChargesPct)) / 100)
}

/** Full breakdown for one article at one selling price. */
export function computeProfitability(input: ProfitabilityInput): Profitability {
  const priceHt = round2(Math.max(input.priceHt, 0))
  const costUnknown = input.costPriceHt === null || input.costPriceHt === undefined
  const costPriceHt = round2(Math.max(input.costPriceHt ?? 0, 0))
  const chargesHt = resolveChargesHt(priceHt, input)
  const payoutHt = round2((priceHt * clampPct(input.beneficiarySharePct)) / 100)
  const marginHt = round2(priceHt - costPriceHt - chargesHt - payoutHt)

  return {
    priceHt,
    costPriceHt,
    chargesHt,
    payoutHt,
    marginHt,
    marginPct: priceHt > 0 ? round2((marginHt / priceHt) * 100) : 0,
    costUnknown,
  }
}

/**
 * The share actually owed on a sale.
 *
 * Basis is **HT and net of refunds**: VAT is not revenue, and a refunded order
 * owes nothing. `refundFactor` is the share of the order that survived — 1 when
 * nothing was refunded, 0 when all of it was.
 */
export function computePayoutHt(lineHt: number, sharePct: number, refundFactor = 1): number {
  const factor = Math.min(Math.max(refundFactor, 0), 1)
  return round2((Math.max(lineHt, 0) * clampPct(sharePct) * factor) / 100)
}

/**
 * What is left of an order once refunds are taken off, as a factor in [0, 1].
 *
 * Refunds are recorded per ORDER, not per line, so the only defensible thing to
 * do is reduce every line in proportion.
 */
export function refundFactorFor(totalTtc: number, refundedTtc: number): number {
  if (totalTtc <= 0) return 0
  return Math.min(Math.max(1 - refundedTtc / totalTtc, 0), 1)
}
