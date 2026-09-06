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

/**
 * VIP discount on a line: 50% of the product margin, in HT.
 * Ammunition (and any excluded category) gets no discount.
 */
export function calculateVipDiscount(
  lineHt: number,
  marginPct: number,
  categorySlug: string,
): { discountPct: number; discountAmount: number } {
  if (marginPct <= 0 || VIP_DISCOUNT_EXCLUDED_CATEGORIES.includes(categorySlug)) {
    return { discountPct: 0, discountAmount: 0 }
  }
  const discountPct = round2(marginPct * 0.5)
  return { discountPct, discountAmount: round2(lineHt * (discountPct / 100)) }
}
