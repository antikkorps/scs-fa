/**
 * How many of the row's tabs, in order, fit in `available` pixels. When they do
 * not all fit, the room of the « Plus » entry is kept for the rest. A row not
 * laid out yet (every width 0) keeps them all, as the server renders it.
 */
export function tabsThatFit(widths: number[], available: number, moreWidth: number, gap: number): number {
  const whole = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(widths.length - 1, 0)
  if (whole <= available) return widths.length
  let used = moreWidth
  let count = 0
  for (const width of widths) {
    used += width + gap
    if (used > available) break
    count += 1
  }
  return count
}
