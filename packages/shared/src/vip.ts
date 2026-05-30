import { round2 } from "./pricing.js"

// Legal categories whose (new) firearms unlock VIP status when purchased.
export const VIP_QUALIFYING_LEGAL_CATEGORIES: readonly string[] = ["B", "C", "D"]

// Product categories that are NOT "new" — buying these does NOT unlock VIP.
export const NON_NEW_PRODUCT_CATEGORIES: readonly string[] = ["occasion", "arme-ancienne"]

// Product categories excluded from the VIP discount (e.g. ammunition).
export const VIP_DISCOUNT_EXCLUDED_CATEGORIES: readonly string[] = ["munition"]

/**
 * A purchase unlocks VIP when it contains at least one **new firearm**:
 * legal category B/C/D and a product category that is not second-hand/antique.
 */
export function isNewFirearmQualifying(legalCategory: string | null | undefined, categorySlug: string): boolean {
  if (!legalCategory || !VIP_QUALIFYING_LEGAL_CATEGORIES.includes(legalCategory)) {
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
