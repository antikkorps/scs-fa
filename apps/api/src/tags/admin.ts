import { createTagSchema, updateTagSchema, uuidParamSchema } from "@armurier/shared"
import { asc, eq, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { productTags, tags } from "../db/schema.js"
import { validationError } from "../http.js"

// What a deletion would strip off the catalogue, shown before it happens.
//
// ⚠️ A JOIN, not a correlated sub-query: in a raw `sql` fragment Drizzle only
// qualifies column names when the outer query has a join, so on a single-table
// query the outer column comes out bare and Postgres binds it to the sub-query's
// own table — counting zero without a word.
const USAGE_COUNT = sql<number>`count(${productTags.tagId})::int`

/**
 * Admin CRUD over the transverse tags (story 7.5a; the screen story 11.1 left open).
 *
 * The FACET is fixed at creation and never patchable: it drives the query
 * semantics (OR inside a facet, AND across facets), so moving a tag would
 * silently change the meaning of every saved filter and every indexed URL.
 * Re-creating the tag under the right facet is the honest path.
 */
export const adminTagRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  fastify.get("/", async (_request, reply) => {
    const rows = await db
      .select({
        id: tags.id,
        slug: tags.slug,
        name: tags.name,
        facet: tags.facet,
        description: tags.description,
        displayOrder: tags.displayOrder,
        usageCount: USAGE_COUNT,
      })
      .from(tags)
      .leftJoin(productTags, eq(productTags.tagId, tags.id))
      .groupBy(tags.id)
      .orderBy(asc(tags.facet), asc(tags.displayOrder), asc(tags.name))
    return reply.send({ data: rows })
  })

  fastify.post("/", async (request, reply) => {
    const parsed = createTagSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const [clash] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, parsed.data.slug)).limit(1)
    if (clash) return reply.code(409).send({ error: "Conflict", message: "Slug already used" })

    const [row] = await db.insert(tags).values(parsed.data).returning()
    return reply.code(201).send({ data: row })
  })

  fastify.patch("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const parsed = updateTagSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const [row] = await db
      .update(tags)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(tags.id, params.data.id))
      .returning()
    if (!row) return reply.code(404).send({ error: "NotFound", message: "Tag not found" })
    return reply.send({ data: row })
  })

  /** DELETE /:id — the links to products cascade; the products themselves stay. */
  fastify.delete("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const [row] = await db.delete(tags).where(eq(tags.id, params.data.id)).returning({ id: tags.id })
    if (!row) return reply.code(404).send({ error: "NotFound", message: "Tag not found" })
    return reply.code(204).send()
  })
}
