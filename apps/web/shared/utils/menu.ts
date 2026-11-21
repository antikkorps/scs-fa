// Story 12.15c — the shop menu as GET /api/menu gives it, read by the site
// (header, entry pages, links) and by the server routes (sitemap, llms.txt).

export interface ShopMenuFilter {
  category: string | null
  subcategory: string | null
  tags: string[]
  legalCategory: string | null
}

export interface ShopMenuEntry {
  slug: string
  label: string
  /** The entry's address: its slugs from the top. */
  path: string
  kind: "filter" | "group" | "link"
  /** Its own page, the linked page, or null for a heading. */
  href: string | null
  filter: ShopMenuFilter | null
  children: ShopMenuEntry[]
}

/** Where a category's or a tag's links lead instead of its own page. */
export interface MenuShortcuts {
  categories: Map<string, string>
  tags: Map<string, string>
}

function* walk(entries: ShopMenuEntry[]): Generator<ShopMenuEntry> {
  for (const entry of entries) {
    yield entry
    yield* walk(entry.children)
  }
}

/** Every entry with a page of its own, depth first. */
export function menuPages(menu: ShopMenuEntry[]): ShopMenuEntry[] {
  return [...walk(menu)].filter((entry) => entry.kind === "filter")
}

/** The one criterion an entry's filter holds, when it holds exactly one category or one tag. */
function soleCriterion(filter: ShopMenuFilter): { kind: "category" | "tag"; slug: string } | null {
  if (filter.subcategory || filter.legalCategory) return null
  const [tag, ...more] = filter.tags
  if (filter.category && !tag) return { kind: "category", slug: filter.category }
  if (!filter.category && tag && more.length === 0) return { kind: "tag", slug: tag }
  return null
}

/**
 * The entries standing for a category's or a tag's page: same products, so the
 * site links there and the old page names it canonical (decision of
 * 2026-11-21). The first such entry in the menu wins.
 */
export function menuShortcuts(menu: ShopMenuEntry[]): MenuShortcuts {
  const shortcuts: MenuShortcuts = { categories: new Map(), tags: new Map() }
  for (const entry of menuPages(menu)) {
    const criterion = entry.filter && soleCriterion(entry.filter)
    if (!criterion) continue
    const map = criterion.kind === "category" ? shortcuts.categories : shortcuts.tags
    if (!map.has(criterion.slug)) map.set(criterion.slug, entry.path)
  }
  return shortcuts
}
