import type { FastifyPluginAsync } from "fastify"
import { loadMenuEntries, type MenuEntry } from "./entries.js"

interface PublicMenuEntry {
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

/** The nested tree under `parentId`, siblings in the order loaded (display order). */
function branch(entries: MenuEntry[], parentId: string | null, parentPath: string): PublicMenuEntry[] {
  return entries
    .filter((entry) => entry.parentId === parentId)
    .map((entry) => {
      const path = `${parentPath}/${entry.slug}`
      return {
        slug: entry.slug,
        label: entry.label,
        path,
        kind: entry.kind,
        href: hrefOf(entry, path),
        filter: filterOf(entry),
        children: branch(entries, entry.id, path),
      }
    })
}

/** GET /api/menu — the shop menu (story 12.15b), as the site's header draws it. */
export const menuRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (_request, reply) => reply.send({ data: branch(await loadMenuEntries(), null, "") }))
}
