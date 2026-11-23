// Story 12.15b — the shop menu as the admin API returns it (flat, filter by slugs).

import type { MenuEntryKind, MenuFilterKey } from "@armurier/shared"
import type { LegalCategoryCode } from "./product"

export interface AdminMenuEntry {
  id: string
  parentId: string | null
  slug: string
  label: string
  position: number
  kind: MenuEntryKind
  linkUrl: string | null
  categorySlug: string | null
  subcategorySlug: string | null
  legalCategory: LegalCategoryCode | null
  tagSlugs: string[]
  /** Story 12.15c — the entry's page: meta description and introduction. */
  description: string | null
  intro: string | null
  /** Story 12.15e — the filters its page and its branch's leave out. */
  hiddenFilters: MenuFilterKey[]
}

/** An entry placed in the tree: its level (1 at the top) and its address. */
export interface PlacedMenuEntry {
  entry: AdminMenuEntry
  level: number
  path: string
}
