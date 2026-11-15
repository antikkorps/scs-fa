// Story 12.13 — the « Tags » column of the triage workbook: a supplier's whole
// catalogue can land in a universe (« Chasse ») without tagging each product in
// the back-office. Tags are curated there, never created by an import.

import { normaliseHeader } from "@armurier/shared"
import { db } from "../db/client.js"
import { tags } from "../db/schema.js"

interface TaggableRow {
  data: { tags: string[] | null } | null
  tagIds: string[] | null
}

/**
 * Resolve each row's tags (by slug, or by name whatever the case and accents)
 * into ids. A row naming a tag that does not exist is refused, with every
 * unknown name listed.
 */
export async function resolveImportTags<Row extends TaggableRow>(
  rows: Row[],
  invalidate: (row: Row, message: string) => void,
): Promise<void> {
  const listed = rows.filter((row) => row.data?.tags)
  if (listed.length === 0) return
  const all = await db.select({ id: tags.id, slug: tags.slug, name: tags.name }).from(tags)
  const idByKey = new Map<string, string>()
  for (const tag of all) {
    idByKey.set(tag.slug, tag.id)
    idByKey.set(normaliseHeader(tag.name), tag.id)
  }
  for (const row of listed) {
    const names = row.data?.tags ?? []
    const unknown = names.filter((name) => !idByKey.has(name.toLowerCase()) && !idByKey.has(normaliseHeader(name)))
    if (unknown.length > 0) {
      const list = unknown.map((name) => `« ${name} »`).join(", ")
      invalidate(row, `Tag inconnu : ${list}. Créez-le d'abord dans Catalogue → Tags.`)
      continue
    }
    const ids = names.map((name) => idByKey.get(name.toLowerCase()) ?? idByKey.get(normaliseHeader(name)) ?? "")
    row.tagIds = [...new Set(ids)]
  }
}
