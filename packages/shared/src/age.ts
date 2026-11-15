// Story 12.13c — sales reserved to adults (Franck and Fred, 2026-11-15): a
// customer ordering an article that requires an age certifies on their honour
// that they are of age — a ticked box recorded with the order, no date of
// birth kept. Organisations are exempt (the buyer is a legal entity).

/** Categories reserved to adults whatever an article's legal category says. */
export const ADULT_ONLY_CATEGORY_SLUGS: readonly string[] = ["coutellerie"]

export const ADULT_AGE = 18

/** The age an article requires: its own, else its legal category's; every knife at least 18. */
export function requiredAge(item: {
  ageMinRequired: number | null
  legalMinAge: number | null
  categorySlug: string
}): number {
  const stated = item.ageMinRequired ?? item.legalMinAge ?? 0
  return ADULT_ONLY_CATEGORY_SLUGS.includes(item.categorySlug) ? Math.max(stated, ADULT_AGE) : stated
}
