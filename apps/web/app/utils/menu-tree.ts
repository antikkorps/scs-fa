// Story 12.15b — the admin menu tree, from the flat list the API returns.

import type { AdminMenuEntry, PlacedMenuEntry } from "~/types/menu"
import type { ProductCategoryRef } from "~/types/product"
import { legalCategoryLabel } from "~/utils/product"

/** The children of `parentId`, in display order. */
export function childrenOf(entries: AdminMenuEntry[], parentId: string | null): AdminMenuEntry[] {
  return entries
    .filter((entry) => entry.parentId === parentId)
    .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label, "fr"))
}

/** Depth first, as the tree reads top to bottom. */
export function placeEntries(entries: AdminMenuEntry[], parentId: string | null = null, level = 1, base = "") {
  const placed: PlacedMenuEntry[] = []
  for (const entry of childrenOf(entries, parentId)) {
    const path = `${base}/${entry.slug}`
    placed.push({ entry, level, path }, ...placeEntries(entries, entry.id, level + 1, path))
  }
  return placed
}

/** How many entries hang under this one, at any depth. */
export function descendantCount(entries: AdminMenuEntry[], id: string): number {
  return childrenOf(entries, id).reduce((count, child) => count + 1 + descendantCount(entries, child.id), 0)
}

/** Levels the entry's branch spans, itself included. */
export function branchHeight(entries: AdminMenuEntry[], id: string): number {
  return 1 + Math.max(0, ...childrenOf(entries, id).map((child) => branchHeight(entries, child.id)))
}

/** The filter in words: « Armes longues › Carabines · Chasse · Catégorie C ». */
export function filterSummary(
  entry: AdminMenuEntry,
  categories: ProductCategoryRef[],
  tagNames: Map<string, string>,
): string {
  const category = categories.find((candidate) => candidate.slug === entry.categorySlug)
  const subcategory = category?.subcategories.find((candidate) => candidate.slug === entry.subcategorySlug)
  const nature = [category?.name ?? entry.categorySlug, subcategory?.name ?? entry.subcategorySlug]
    .filter(Boolean)
    .join(" › ")
  const parts = [
    nature,
    ...entry.tagSlugs.map((slug) => tagNames.get(slug) ?? slug),
    entry.legalCategory ? legalCategoryLabel(entry.legalCategory) : "",
  ]
  return parts.filter(Boolean).join(" · ") || "Tout le catalogue"
}
