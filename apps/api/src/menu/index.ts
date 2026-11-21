import type { FastifyPluginAsync } from "fastify"
import { z } from "zod"
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

/** Only a filter entry has a page: a heading gathers, a link leads elsewhere. */
function pageAt(entries: MenuEntry[], path: string) {
  const chain = chainAt(entries, path)
  const entry = chain?.at(-1)
  if (!chain || !entry || entry.kind !== "filter") return null
  let ancestorPath = ""
  const breadcrumb: TrailStep[] = chain.slice(0, -1).map((ancestor) => {
    ancestorPath = `${ancestorPath}/${ancestor.slug}`
    return { label: ancestor.label, href: hrefOf(ancestor, ancestorPath) }
  })
  return {
    label: entry.label,
    path,
    description: entry.description,
    intro: entry.intro,
    filter: filterOf(entry),
    breadcrumb,
    children: branch(entries, entry.id, path),
  }
}

const pageQuerySchema = z.object({ path: z.string().max(400) })

/**
 * The shop menu (story 12.15b). GET / is the tree the header draws, kept light:
 * it ships in every page. GET /page is what one entry's page needs (12.15c).
 */
export const menuRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (_request, reply) => reply.send({ data: branch(await loadMenuEntries(), null, "") }))

  fastify.get("/page", async (request, reply) => {
    const parsed = pageQuerySchema.safeParse(request.query)
    const page = parsed.success ? pageAt(await loadMenuEntries(), parsed.data.path) : null
    if (!page) return reply.code(404).send({ error: "NotFound", message: "No menu page at this address" })
    return reply.send({ data: page })
  })
}
