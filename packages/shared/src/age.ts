// Story 12.13c — sales reserved to adults (decisions Franck 2026-11-15): a
// customer gives their date of birth when ordering an article that requires an
// age, once, and is refused under it. Organisations are exempt (the buyer is a
// legal entity). Dates are "YYYY-MM-DD" strings, compared in Paris time by the
// caller (parisToday).

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

/** Whole years between a birth date and `today`; someone born on 29 February ages on 1 March. */
export function ageOn(birthDate: string, today: string): number {
  const [by = 0, bm = 0, bd = 0] = birthDate.split("-").map(Number)
  const [ty = 0, tm = 0, td = 0] = today.split("-").map(Number)
  const hadBirthday = tm > bm || (tm === bm && td >= bd)
  return ty - by - (hadBirthday ? 0 : 1)
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const OLDEST_PLAUSIBLE_YEAR = 1900

/** A real calendar date, in the past, not absurdly old: what a birth date field may hold. */
export function isPlausibleBirthDate(value: string, today: string): boolean {
  const match = DATE_RE.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return real && year >= OLDEST_PLAUSIBLE_YEAR && value <= today
}
