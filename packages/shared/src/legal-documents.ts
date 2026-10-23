// Story 12.9f (security audit) — a supporting document past its expiry date
// proves nothing: it cannot be uploaded, approved, nor clear an order.

const PARIS_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" })

/** Today's calendar date in Paris, as YYYY-MM-DD — the shop's legal day. */
export function parisToday(now = new Date()): string {
  return PARIS_DATE.format(now)
}

/** A document stays valid through its expiry day; none set means no expiry. */
export function isLegalDocExpired(expiresAt: string | null | undefined, today: string): boolean {
  if (!expiresAt) return false
  return expiresAt < today
}
