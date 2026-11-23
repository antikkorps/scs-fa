import {
  createMenuEntrySchema,
  menuEntryShapeIssue,
  reorderMenuSchema,
  type UpdateMenuEntryInput,
  updateMenuEntrySchema,
  uuidParamSchema,
} from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { FastifyPluginAsync, FastifyReply } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import type { DbExecutor } from "../db/client.js"
import { isUniqueViolation } from "../db/errors.js"
import { menuEntries } from "../db/schema.js"
import { validationError } from "../http.js"
import {
  filterColumns,
  inMenuTransaction,
  loadMenuEntries,
  type MenuEntry,
  MenuInputError,
  setEntryTags,
} from "./entries.js"
import { placementIssue } from "./tree.js"

class EntryNotFoundError extends Error {}

function refuseIf(issue: string | null): void {
  if (issue) throw new MenuInputError(issue)
}

function answerError(error: unknown, reply: FastifyReply) {
  if (error instanceof MenuInputError) return reply.code(400).send({ error: "BadRequest", message: error.message })
  if (error instanceof EntryNotFoundError)
    return reply.code(404).send({ error: "NotFound", message: "Entry not found" })
  if (isUniqueViolation(error, "uq_menu_entries_parent_slug")) {
    return reply.code(409).send({ error: "Conflict", message: "A sibling entry already has this slug" })
  }
  throw error
}

/** Last among the parent's children. */
function nextPosition(entries: MenuEntry[], parentId: string | null): number {
  const siblings = entries.filter((entry) => entry.parentId === parentId)
  return Math.max(0, ...siblings.map((entry) => entry.position)) + 1
}

async function reloaded(id: string, tx: DbExecutor): Promise<MenuEntry> {
  const entry = (await loadMenuEntries(tx)).find((candidate) => candidate.id === id)
  if (!entry) throw new EntryNotFoundError()
  return entry
}

/** The entry once the patch is applied: a new category leaves the old one's subcategory behind. */
function patched(existing: MenuEntry, patch: UpdateMenuEntryInput): MenuEntry {
  const merged = { ...existing, ...patch }
  const categoryChanged = patch.categorySlug !== undefined && patch.categorySlug !== existing.categorySlug
  if (categoryChanged && patch.subcategorySlug === undefined) merged.subcategorySlug = null
  return merged
}

async function updateEntry(id: string, patch: UpdateMenuEntryInput, tx: DbExecutor): Promise<MenuEntry> {
  const entries = await loadMenuEntries(tx)
  const existing = entries.find((entry) => entry.id === id)
  if (!existing) throw new EntryNotFoundError()
  const entry = patched(existing, patch)
  refuseIf(menuEntryShapeIssue(entry))
  if (entry.kind === "link" && entries.some((child) => child.parentId === id)) {
    throw new MenuInputError("An entry with children cannot become a link")
  }
  const moved = entry.parentId !== existing.parentId
  if (moved) refuseIf(placementIssue(entries, id, entry.parentId))

  await tx
    .update(menuEntries)
    .set({
      parentId: entry.parentId,
      slug: entry.slug,
      label: entry.label,
      kind: entry.kind,
      linkUrl: entry.linkUrl,
      description: entry.description,
      intro: entry.intro,
      hiddenFilters: entry.hiddenFilters,
      ...(await filterColumns(entry, tx)),
      ...(moved ? { position: nextPosition(entries, entry.parentId) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(menuEntries.id, id))
  if (patch.tagSlugs !== undefined) await setEntryTags(id, entry.tagSlugs, tx)
  return reloaded(id, tx)
}

/**
 * Admin editing of the shop menu (story 12.15b): add, rename, move, reorder and
 * delete entries, and set each one's saved filter. The tree is read whole and
 * checked in the transaction that changes it.
 */
export const adminMenuRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  fastify.get("/", async (_request, reply) => reply.send({ data: await loadMenuEntries() }))

  fastify.post("/", async (request, reply) => {
    const parsed = createMenuEntrySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const { tagSlugs, categorySlug, subcategorySlug, legalCategory, ...entry } = parsed.data
    try {
      const created = await inMenuTransaction(async (tx) => {
        const entries = await loadMenuEntries(tx)
        refuseIf(placementIssue(entries, null, entry.parentId))
        const [row] = await tx
          .insert(menuEntries)
          .values({
            ...entry,
            ...(await filterColumns({ categorySlug, subcategorySlug, legalCategory }, tx)),
            position: nextPosition(entries, entry.parentId),
          })
          .returning({ id: menuEntries.id })
        if (!row) throw new Error("Insert returned no row")
        await setEntryTags(row.id, tagSlugs, tx)
        return reloaded(row.id, tx)
      })
      return reply.code(201).send({ data: created })
    } catch (error) {
      return answerError(error, reply)
    }
  })

  /** PUT /order — the children of one parent, in their new order: all of them, no stranger. */
  fastify.put("/order", async (request, reply) => {
    const parsed = reorderMenuSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const { parentId, ids } = parsed.data
    try {
      await inMenuTransaction(async (tx) => {
        const siblings = (await loadMenuEntries(tx)).filter((entry) => entry.parentId === parentId)
        const sameSet = siblings.length === ids.length && siblings.every((entry) => ids.includes(entry.id))
        refuseIf(sameSet ? null : "The order must list every child of this parent, and only them")
        for (const [index, id] of ids.entries()) {
          await tx
            .update(menuEntries)
            .set({ position: index + 1 })
            .where(eq(menuEntries.id, id))
        }
      })
      return reply.code(204).send()
    } catch (error) {
      return answerError(error, reply)
    }
  })

  fastify.patch("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const parsed = updateMenuEntrySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    try {
      const entry = await inMenuTransaction((tx) => updateEntry(params.data.id, parsed.data, tx))
      return reply.send({ data: entry })
    } catch (error) {
      return answerError(error, reply)
    }
  })

  /** DELETE /:id — the entry's branch goes with it; no product is touched. */
  fastify.delete("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const [row] = await inMenuTransaction((tx) =>
      tx.delete(menuEntries).where(eq(menuEntries.id, params.data.id)).returning({ id: menuEntries.id }),
    )
    if (!row) return reply.code(404).send({ error: "NotFound", message: "Entry not found" })
    return reply.code(204).send()
  })
}
