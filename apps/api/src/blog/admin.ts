import { blogArticleCreateSchema, blogArticleUpdateSchema, blogQuerySchema, uuidParamSchema } from "@armurier/shared"
import { and, desc, eq, ilike, or, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { blogPosts, users } from "../db/schema.js"
import { validationError } from "../http.js"

const AUTHOR_NAME = sql<string | null>`nullif(trim(concat_ws(' ', ${users.firstname}, ${users.lastname})), '')`

// Row shape for the admin list: enough to triage without the full content body.
const LIST_FIELDS = {
  id: blogPosts.id,
  slug: blogPosts.slug,
  title: blogPosts.title,
  category: blogPosts.category,
  published: blogPosts.published,
  featured: blogPosts.featured,
  publishedAt: blogPosts.publishedAt,
  updatedAt: blogPosts.updatedAt,
  authorName: AUTHOR_NAME,
} as const

// Full row returned by create/update/get-by-id.
const FULL_FIELDS = {
  id: blogPosts.id,
  slug: blogPosts.slug,
  title: blogPosts.title,
  excerpt: blogPosts.excerpt,
  content: blogPosts.content,
  category: blogPosts.category,
  tags: blogPosts.tags,
  featuredImageUrl: blogPosts.featuredImageUrl,
  metaTitle: blogPosts.metaTitle,
  metaDescription: blogPosts.metaDescription,
  published: blogPosts.published,
  featured: blogPosts.featured,
  publishedAt: blogPosts.publishedAt,
  authorId: blogPosts.authorId,
  createdAt: blogPosts.createdAt,
  updatedAt: blogPosts.updatedAt,
} as const

// Postgres unique-violation (slug already taken). node-postgres surfaces the
// driver error on `.cause` once wrapped by Drizzle, so check both levels.
const hasPgCode = (e: unknown, code: string): boolean =>
  typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === code

function isUniqueViolation(err: unknown): boolean {
  return hasPgCode(err, "23505") || hasPgCode((err as { cause?: unknown })?.cause, "23505")
}

// Admin blog CRUD. Mounted under /api/admin/blog.
export const adminBlogRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  // GET / — all posts (published or not), newest-first, filterable + paginated.
  fastify.get("/", async (request, reply) => {
    const parsed = blogQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const { published, search, page, limit } = parsed.data

    const conditions = [
      published === undefined ? undefined : eq(blogPosts.published, published),
      search ? or(ilike(blogPosts.title, `%${search}%`), ilike(blogPosts.slug, `%${search}%`)) : undefined,
    ].filter(Boolean)
    const where = conditions.length ? and(...conditions) : undefined

    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(blogPosts).where(where)

    const data = await db
      .select(LIST_FIELDS)
      .from(blogPosts)
      .leftJoin(users, eq(users.id, blogPosts.authorId))
      .where(where)
      .orderBy(desc(blogPosts.updatedAt))
      .limit(limit)
      .offset((page - 1) * limit)

    return reply.code(200).send({
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    })
  })

  // GET /:id — full post for the editor.
  fastify.get("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    const [post] = await db.select(FULL_FIELDS).from(blogPosts).where(eq(blogPosts.id, params.data.id)).limit(1)
    if (!post) return reply.code(404).send({ error: "NotFound", message: "Article not found" })
    return reply.code(200).send({ data: post })
  })

  // POST / — create. Author is the session admin; publishedAt is stamped when
  // the post is created already published.
  fastify.post("/", async (request, reply) => {
    const parsed = blogArticleCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const data = parsed.data

    try {
      const [created] = await db
        .insert(blogPosts)
        .values({
          slug: data.slug,
          title: data.title,
          excerpt: data.excerpt,
          content: data.content,
          category: data.category,
          tags: data.tags,
          featuredImageUrl: data.featuredImageUrl,
          metaTitle: data.metaTitle,
          metaDescription: data.metaDescription,
          published: data.published,
          featured: data.featured,
          publishedAt: data.published ? new Date() : null,
          authorId: request.user.sub,
        })
        .returning(FULL_FIELDS)
      return reply.code(201).send({ data: created })
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: "Conflict", message: "A post with this slug already exists" })
      }
      throw err
    }
  })

  // PATCH /:id — partial update. Transitioning to published stamps publishedAt
  // once; unpublishing clears it.
  fastify.patch("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const body = blogArticleUpdateSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send(validationError(body.error.issues))

    const [existing] = await db
      .select({ id: blogPosts.id, published: blogPosts.published, publishedAt: blogPosts.publishedAt })
      .from(blogPosts)
      .where(eq(blogPosts.id, params.data.id))
      .limit(1)
    if (!existing) return reply.code(404).send({ error: "NotFound", message: "Article not found" })

    const patch: Record<string, unknown> = { ...body.data, updatedAt: new Date() }
    if (body.data.published === true && !existing.publishedAt) patch.publishedAt = new Date()
    if (body.data.published === false) patch.publishedAt = null

    try {
      const [updated] = await db
        .update(blogPosts)
        .set(patch)
        .where(eq(blogPosts.id, params.data.id))
        .returning(FULL_FIELDS)
      return reply.code(200).send({ data: updated })
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: "Conflict", message: "A post with this slug already exists" })
      }
      throw err
    }
  })

  // DELETE /:id
  fastify.delete("/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))

    const deleted = await db.delete(blogPosts).where(eq(blogPosts.id, params.data.id)).returning({ id: blogPosts.id })
    if (deleted.length === 0) return reply.code(404).send({ error: "NotFound", message: "Article not found" })
    return reply.code(204).send()
  })
}
