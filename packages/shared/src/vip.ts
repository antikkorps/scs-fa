import { round2 } from "./pricing.js"

// Legal categories whose (new) firearms unlock VIP status when purchased.
export const VIP_QUALIFYING_LEGAL_CATEGORIES: readonly string[] = ["B", "C", "D"]

// Tags marking a firearm as not new — buying one does NOT unlock VIP. Since
// story 11.1 the state of a weapon is a tag, because it has to coexist with its
// nature (an historical piece is necessarily second-hand).
export const NON_NEW_PRODUCT_TAGS: readonly string[] = ["occasion", "arme-ancienne", "arme-historique"]

// Legacy equivalent, kept for orders placed BEFORE story 11.1: `items_json` is an
// immutable snapshot, so those rows still carry "occasion"/"arme-ancienne" in
// their `category` field. Dropping this would retroactively turn old second-hand
// purchases into VIP-qualifying ones.
export const NON_NEW_PRODUCT_CATEGORIES: readonly string[] = ["occasion", "arme-ancienne"]

// Product categories excluded from the VIP discount (e.g. ammunition).
export const VIP_DISCOUNT_EXCLUDED_CATEGORIES: readonly string[] = ["munition"]

/**
 * A purchase unlocks VIP when it contains at least one **new firearm**: legal
 * category B/C/D, carrying no tag that marks it as second-hand or historical.
 *
 * `tagSlugs` is what current orders snapshot; the category check behind it only
 * still matters for orders placed before story 11.1, when the state lived in the
 * category. Both must stay: a pre-11.1 second-hand order has no tags at all, so
 * the tag check alone would silently promote it to VIP-qualifying.
 */
export function isNewFirearmQualifying(
  legalCategory: string | null | undefined,
  categorySlug: string,
  tagSlugs: readonly string[] = [],
): boolean {
  if (!legalCategory || !VIP_QUALIFYING_LEGAL_CATEGORIES.includes(legalCategory)) {
    return false
  }
  if (tagSlugs.some((slug) => NON_NEW_PRODUCT_TAGS.includes(slug))) {
    return false
  }
  return !NON_NEW_PRODUCT_CATEGORIES.includes(categorySlug)
}

// Share of the product margin a VIP gets back, until SCS changes it in the back
// office (story 12.9e, `shop_settings.vip_margin_share_pct`).
export const DEFAULT_VIP_MARGIN_SHARE_PCT = 50

/**
 * VIP discount on a line: a share of the product margin (half by default), in HT.
 * Ammunition (and any excluded category) gets no discount.
 */
export function calculateVipDiscount(
  lineHt: number,
  marginPct: number,
  categorySlug: string,
  marginSharePct: number = DEFAULT_VIP_MARGIN_SHARE_PCT,
): { discountPct: number; discountAmount: number } {
  if (marginPct <= 0 || marginSharePct <= 0 || VIP_DISCOUNT_EXCLUDED_CATEGORIES.includes(categorySlug)) {
    return { discountPct: 0, discountAmount: 0 }
  }
  const discountPct = round2((marginPct * marginSharePct) / 100)
  return { discountPct, discountAmount: round2(lineHt * (discountPct / 100)) }
}

/** An order line as the VIP rule reads it (the `items_json` snapshot). */
export interface VipOrderLine {
  qty: number
  category: string
  legalCategory?: string | null
  tags?: string[]
}

/**
 * Whether an order still holds a new firearm once its returns are counted
 * (story 12.9e, Franck 2026-10-22): returning the firearm that unlocked VIP —
 * in a partial refund too — takes the order out of the running. `returned`
 * lists the goods-return refund lines (`item` = index in the order's lines).
 */
export function keepsQualifyingFirearm(
  lines: readonly VipOrderLine[],
  returned: ReadonlyArray<{ item: number; qty: number }>,
): boolean {
  return lines.some((line, index) => {
    if (!isNewFirearmQualifying(line.legalCategory, line.category, line.tags ?? [])) return false
    const returnedQty = returned.filter((r) => r.item === index).reduce((sum, r) => sum + r.qty, 0)
    return line.qty - returnedQty > 0
  })
}
