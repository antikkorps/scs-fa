// Story 12.15b — the shop menu as the admin API returns it (flat, filter by slugs).

import type { MenuEntryKind } from "@armurier/shared"
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
}

/** An entry placed in the tree: its level (1 at the top) and its address. */
export interface PlacedMenuEntry {
  entry: AdminMenuEntry
  level: number
  path: string
}
