// Story 12.15b/c — the public menu: the tree the header draws, and its pages.

import { productFiltersSchema } from "@armurier/shared"
import { countCatalogue } from "../products/list.js"
import { publicCatalogueVisible } from "../products/visibility.js"
import { loadMenuEntries, type MenuEntry } from "./entries.js"

export interface PublicMenuEntry {
  slug: string
  label: string
  /** The entry's address: its slugs from the top (decision D4). */
  path: string
  kind: MenuEntry["kind"]
  /** Where the entry leads: its own page, the linked page, or nowhere for a heading. */
  href: string | null
  filter: { category: string | null; subcategory: string | null; tags: string[]; legalCategory: string | null } | null
  children: PublicMenuEntry[]
}

function hrefOf(entry: MenuEntry, path: string): string | null {
  if (entry.kind === "link") return entry.linkUrl
  return entry.kind === "filter" ? path : null
}

function filterOf(entry: MenuEntry): PublicMenuEntry["filter"] {
  if (entry.kind !== "filter") return null
  return {
    category: entry.categorySlug,
    subcategory: entry.subcategorySlug,
    tags: entry.tagSlugs,
    legalCategory: entry.legalCategory,
  }
}

/** Each entry's address, its slugs from the top: the one walk every view shares. */
function pathsById(entries: MenuEntry[]): Map<string, string> {
  const paths = new Map<string, string>()
  const place = (parentId: string | null, parentPath: string) => {
    for (const entry of entries.filter((candidate) => candidate.parentId === parentId)) {
      paths.set(entry.id, `${parentPath}/${entry.slug}`)
      place(entry.id, `${parentPath}/${entry.slug}`)
    }
  }
  place(null, "")
  return paths
}

function nested(entries: MenuEntry[], parentId: string | null, paths: Map<string, string>): PublicMenuEntry[] {
  return entries
    .filter((entry) => entry.parentId === parentId)
    .map((entry) => {
      const path = paths.get(entry.id) ?? ""
      return {
        slug: entry.slug,
        label: entry.label,
        path,
        kind: entry.kind,
        href: hrefOf(entry, path),
        filter: filterOf(entry),
        children: nested(entries, entry.id, paths),
      }
    })
}

/** The nested tree under `parentId`, siblings in the order loaded (display order). */
export function branch(entries: MenuEntry[], parentId: string | null = null): PublicMenuEntry[] {
  return nested(entries, parentId, pathsById(entries))
}

interface TrailStep {
  label: string
  href: string | null
}

/** The entries from the top down to the one at `path`, or null when the path leads nowhere. */
function chainAt(entries: MenuEntry[], path: string): MenuEntry[] | null {
  const chain: MenuEntry[] = []
  let parentId: string | null = null
  for (const slug of path.split("/").slice(1)) {
    const entry = entries.find((candidate) => candidate.parentId === parentId && candidate.slug === slug)
    if (!entry) return null
    chain.push(entry)
    parentId = entry.id
  }
  return chain.length > 0 ? chain : null
}

/** What the catalogue shows for this filter, counted as the catalogue counts. */
export async function productCount(filter: NonNullable<PublicMenuEntry["filter"]>): Promise<number> {
  const filters = productFiltersSchema.parse({
    category: filter.category ?? undefined,
    subcategory: filter.subcategory ?? undefined,
    tags: filter.tags.join(",") || undefined,
    legalCategory: filter.legalCategory ?? undefined,
    limit: 1,
  })
  return countCatalogue(filters, publicCatalogueVisible())
}

/** Only a filter entry has a page: a heading gathers, a link leads elsewhere. */
export function pageAt(entries: MenuEntry[], path: string) {
  const chain = chainAt(entries, path)
  const entry = chain?.at(-1)
  if (!chain || !entry || entry.kind !== "filter") return null
  const paths = pathsById(entries)
  const breadcrumb: TrailStep[] = chain
    .slice(0, -1)
    .map((ancestor) => ({ label: ancestor.label, href: hrefOf(ancestor, paths.get(ancestor.id) ?? "") }))
  return {
    label: entry.label,
    // Rebuilt from the tree, never echoed: it becomes the page's canonical.
    path: paths.get(entry.id) ?? path,
    description: entry.description,
    intro: entry.intro,
    filter: filterOf(entry),
    breadcrumb,
    children: nested(entries, entry.id, paths),
  }
}

/**
 * The menu pages search engines may list (12.15c): the filter entries showing at
 * least one product, an empty one being kept out of the indexes. Dated by their
 * last edit. One count query per entry, run together; the caller caches (the sitemap does).
 */
export async function indexableMenuPages(): Promise<{ path: string; updatedAt: Date | null }[]> {
  const entries = new Map((await loadMenuEntries()).map((entry) => [entry.id, entry]))
  // The paths come depth first, in display order: the sitemap keeps it.
  const pages = [...pathsById([...entries.values()])].flatMap(([id, path]) => {
    const entry = entries.get(id)
    const filter = entry && filterOf(entry)
    return entry && filter ? [{ path, filter, updatedAt: entry.updatedAt }] : []
  })
  const counts = await Promise.all(pages.map((page) => productCount(page.filter)))
  return pages.filter((_page, index) => (counts[index] ?? 0) > 0).map(({ path, updatedAt }) => ({ path, updatedAt }))
}
