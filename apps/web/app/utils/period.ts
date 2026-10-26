// Calendar periods for the back-office exports, as ISO days (YYYY-MM-DD).

export interface DayPeriod {
  from: string
  to: string
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10)

/** The whole calendar month before `today` — what an accountant asks for. */
export function previousMonth(today: string): DayPeriod {
  const [year = 0, month = 1] = today.split("-").map(Number)
  // Day 0 of a month is the last day of the one before; computed in UTC, no clock shift.
  const lastDay = new Date(Date.UTC(year, month - 1, 0))
  const firstDay = new Date(Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), 1))
  return { from: isoDay(firstDay), to: isoDay(lastDay) }
}
