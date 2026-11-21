// Story 12.15b — menu entries as the API speaks of them: the filter by slugs,
// stored by ids (foreign keys), so a renamed slug never breaks an entry.

import type { LegalCategory, MenuEntryKind } from "@armurier/shared"
import { asc, eq, inArray, sql } from "drizzle-orm"
import { type DbExecutor, db } from "../db/client.js"
import { menuEntries, menuEntryTags, productCategories, productSubcategories, tags } from "../db/schema.js"
import { subcategoryIdIn, unknownSubcategoryMessage } from "../products/subcategory.js"

export interface MenuEntry {
  id: string
  parentId: string | null
  slug: string
  label: string
  position: number
  kind: MenuEntryKind
  linkUrl: string | null
  categorySlug: string | null
  subcategorySlug: string | null
  legalCategory: LegalCategory | null
  tagSlugs: string[]
}

/** A change the menu refuses (unknown reference, broken tree rule): the route answers 400. */
export class MenuInputError extends Error {}

/**
 * A transaction holding the menu's lock. Each write reads the whole tree and
 * checks it: two at once (A under B, B under A) would each pass on the old tree
 * and together make a cycle. The menu changes rarely; queuing its writes is free.
 */
export function inMenuTransaction<T>(work: (tx: DbExecutor) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('menu_entries'))`)
    return work(tx)
  })
}

/** The whole menu, flat, siblings in display order. */
export async function loadMenuEntries(tx: DbExecutor = db): Promise<MenuEntry[]> {
  const [rows, tagRows] = await Promise.all([
    tx
      .select({
        id: menuEntries.id,
        parentId: menuEntries.parentId,
        slug: menuEntries.slug,
        label: menuEntries.label,
        position: menuEntries.position,
        kind: menuEntries.kind,
        linkUrl: menuEntries.linkUrl,
        categorySlug: productCategories.slug,
        subcategorySlug: productSubcategories.slug,
        legalCategory: menuEntries.legalCategory,
      })
      .from(menuEntries)
      .leftJoin(productCategories, eq(productCategories.id, menuEntries.categoryId))
      .leftJoin(productSubcategories, eq(productSubcategories.id, menuEntries.subcategoryId))
      .orderBy(asc(menuEntries.position), asc(menuEntries.label)),
    tx
      .select({ entryId: menuEntryTags.entryId, slug: tags.slug })
      .from(menuEntryTags)
      .innerJoin(tags, eq(tags.id, menuEntryTags.tagId))
      .orderBy(asc(tags.slug)),
  ])
  const tagsByEntry = new Map<string, string[]>()
  for (const { entryId, slug } of tagRows) tagsByEntry.set(entryId, [...(tagsByEntry.get(entryId) ?? []), slug])
  return rows.map((row) => ({ ...row, tagSlugs: tagsByEntry.get(row.id) ?? [] }))
}

async function categoryIdOf(slug: string, tx: DbExecutor): Promise<string> {
  const [row] = await tx
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(eq(productCategories.slug, slug))
    .limit(1)
  if (!row) throw new MenuInputError(`Unknown category: ${slug}`)
  return row.id
}

async function tagIdsOf(slugs: string[], tx: DbExecutor): Promise<string[]> {
  if (slugs.length === 0) return []
  const rows = await tx.select({ id: tags.id, slug: tags.slug }).from(tags).where(inArray(tags.slug, slugs))
  const missing = slugs.filter((slug) => !rows.some((row) => row.slug === slug))
  if (missing.length > 0) throw new MenuInputError(`Unknown tags: ${missing.join(", ")}`)
  return rows.map((row) => row.id)
}

/** The entry's filter columns, from slugs; throws MenuInputError on an unknown one. */
export async function filterColumns(
  filter: Pick<MenuEntry, "categorySlug" | "subcategorySlug" | "legalCategory">,
  tx: DbExecutor,
) {
  const categoryId = filter.categorySlug ? await categoryIdOf(filter.categorySlug, tx) : null
  let subcategoryId: string | null = null
  if (categoryId && filter.subcategorySlug) {
    subcategoryId = await subcategoryIdIn(categoryId, filter.subcategorySlug, tx)
    if (!subcategoryId) throw new MenuInputError(unknownSubcategoryMessage(filter.subcategorySlug))
  }
  return { categoryId, subcategoryId, legalCategory: filter.legalCategory }
}

/** Replace the entry's tags with these. */
export async function setEntryTags(entryId: string, slugs: string[], tx: DbExecutor): Promise<void> {
  const tagIds = await tagIdsOf(slugs, tx)
  await tx.delete(menuEntryTags).where(eq(menuEntryTags.entryId, entryId))
  if (tagIds.length > 0) await tx.insert(menuEntryTags).values(tagIds.map((tagId) => ({ entryId, tagId })))
}
