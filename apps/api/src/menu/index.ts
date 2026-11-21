import type { FastifyPluginAsync } from "fastify"
import { z } from "zod"
import { loadMenuEntries } from "./entries.js"
import { branch, pageAt, productCount } from "./pages.js"

// An address of the site: a leading slash, then lower-case slugs.
const pageQuerySchema = z.object({
  path: z
    .string()
    .max(400)
    .regex(/^\/[a-z0-9/-]*$/),
})

/**
 * The shop menu (story 12.15b). GET / is the tree the header draws, kept light:
 * it ships in every page. GET /page is what one entry's page needs (12.15c).
 */
export const menuRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (_request, reply) => reply.send({ data: branch(await loadMenuEntries()) }))

  fastify.get("/page", async (request, reply) => {
    const parsed = pageQuerySchema.safeParse(request.query)
    const page = parsed.success ? pageAt(await loadMenuEntries(), parsed.data.path) : null
    if (!page?.filter) return reply.code(404).send({ error: "NotFound", message: "No menu page at this address" })
    return reply.send({ data: { ...page, productCount: await productCount(page.filter) } })
  })
}
