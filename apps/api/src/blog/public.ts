import { paginationSchema } from "@armurier/shared"
import { and, desc, eq, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { blogPosts, users } from "../db/schema.js"
import { validationError } from "../http.js"

// Author display name from the joined user, or null when the post is unattributed.
const AUTHOR_NAME = sql<string | null>`nullif(trim(concat_ws(' ', ${users.firstname}, ${users.lastname})), '')`

// Newest-first ordering: published_at when set, else created_at.
const PUBLISHED_ORDER = sql`coalesce(${blogPosts.publishedAt}, ${blogPosts.createdAt})`

/** GET /api/blog — published articles, newest-first, paginated (cards). */
export const listBlogRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (request, reply) => {
    const parsed = paginationSchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const { page, limit } = parsed.data

    const where = eq(blogPosts.published, true)

    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(blogPosts).where(where)

    const data = await db
      .select({
        id: blogPosts.id,
        slug: blogPosts.slug,
        title: blogPosts.title,
        excerpt: blogPosts.excerpt,
        category: blogPosts.category,
        tags: blogPosts.tags,
        featuredImageUrl: blogPosts.featuredImageUrl,
        featured: blogPosts.featured,
        publishedAt: blogPosts.publishedAt,
        authorName: AUTHOR_NAME,
      })
      .from(blogPosts)
      .leftJoin(users, eq(users.id, blogPosts.authorId))
      .where(where)
      .orderBy(desc(PUBLISHED_ORDER))
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
}

/** GET /api/blog/:slug — one published article (full content). 404 otherwise. */
export const getBlogPostRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/:slug", async (request, reply) => {
    const slug = (request.params as { slug: string }).slug
    // Bound the param (consistency with the rest of the API; slugs are short).
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 255) {
      return reply.code(404).send({ error: "NotFound", message: "Article not found" })
    }

    const [post] = await db
      .select({
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
        publishedAt: blogPosts.publishedAt,
        updatedAt: blogPosts.updatedAt,
        authorName: AUTHOR_NAME,
      })
      .from(blogPosts)
      .leftJoin(users, eq(users.id, blogPosts.authorId))
      .where(and(eq(blogPosts.slug, slug), eq(blogPosts.published, true)))
      .limit(1)

    if (!post) {
      return reply.code(404).send({ error: "NotFound", message: "Article not found" })
    }

    return reply.code(200).send({ data: post })
  })
}
