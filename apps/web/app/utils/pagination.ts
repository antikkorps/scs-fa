// Paginated listings (catalogue, category and tag pages, collection firearms).
// SEO audit 2026-11-15: later pages must be reachable by real links (finding 1)
// and must not share the first page's title (finding 13).

/** The page asked for in `?page=`, or the first one for anything else. */
export function pageFromQuery(value: unknown): number {
  if (typeof value !== "string") return 1
  const page = Number.parseInt(value, 10)
  return Number.isFinite(page) && page > 0 ? page : 1
}

/** The listing's title, numbered from page 2 on. */
export function pagedTitle(title: string, page: number): string {
  return page > 1 ? `${title} — page ${page}` : title
}

export type PagerItem = number | "gap"

/**
 * The numbered links of a pager: the first and last pages, and the current
 * page with its neighbours. A gap that would hide a single page shows it.
 */
export function pagerItems(page: number, totalPages: number): PagerItem[] {
  const shown = [1, page - 1, page, page + 1, totalPages].filter((n) => n >= 1 && n <= totalPages)
  const pages = [...new Set(shown)].sort((a, b) => a - b)
  const items: PagerItem[] = []
  for (const [index, current] of pages.entries()) {
    const previous = pages[index - 1]
    if (previous !== undefined && current - previous === 2) items.push(previous + 1)
    if (previous !== undefined && current - previous > 2) items.push("gap")
    items.push(current)
  }
  return items
}
