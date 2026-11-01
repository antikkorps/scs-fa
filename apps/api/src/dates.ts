// Retention cut-offs: "N years / days before now", in UTC.

const DAY_MS = 24 * 60 * 60 * 1000

export function yearsBefore(now: Date, years: number): Date {
  const cutoff = new Date(now)
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years)
  return cutoff
}

export function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS)
}
