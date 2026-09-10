import {
  createArtistSchema,
  createArtworkSeriesSchema,
  createArtworkThemeSchema,
  updateArtistSchema,
  updateArtworkSeriesSchema,
  updateArtworkThemeSchema,
  uuidParamSchema,
} from "@armurier/shared"
import { asc, eq, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { authenticate } from "../auth/authenticate.js"
import { requireRole } from "../auth/require-role.js"
import { db } from "../db/client.js"
import { artists, artworkSeries, artworks, artworkThemes } from "../db/schema.js"
import { validationError } from "../http.js"

// How many rows point at an entity — the admin must see what a deletion would
// orphan BEFORE clicking, not discover it afterwards.
//
// ⚠️ Counted through a JOIN rather than a correlated sub-query on purpose. In a
// raw `sql` fragment Drizzle only qualifies column names when the outer query
// has a join; in a single-table query the outer column comes out bare and
// Postgres binds it to the sub-query's own table — silently counting zero.
// `count(distinct)` is what keeps two joined counts from multiplying each other.
const DISTINCT_SERIES = sql<number>`count(distinct ${artworkSeries.id})::int`
const DISTINCT_ARTWORKS = sql<number>`count(distinct ${artworks.id})::int`

/**
 * Admin CRUD over the Gun Art editorial entities (story 7.5a).
 *
 * Story 11.6 created artists, themes and series but left them enterable only
 * through the seed. These are the screens' API.
 *
 * Deletion is deliberately allowed even when rows point at the entity: the FKs
 * are `on delete set null`, so an artwork survives losing its series — it keeps
 * its prints, its orders and its page, and only loses an editorial label. Each
 * listing therefore reports the counts, so the choice is made with open eyes.
 */
export const adminArtworkEditorialRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate)
  fastify.addHook("preHandler", requireRole("admin"))

  // --- Artists -------------------------------------------------------------

  fastify.get("/artists", async (_request, reply) => {
    const rows = await db
      .select({
        id: artists.id,
        slug: artists.slug,
        name: artists.name,
        headline: artists.headline,
        published: artists.published,
        portraitUrl: artists.portraitUrl,
        bookTitle: artists.bookTitle,
        bookUrl: artists.bookUrl,
        seriesCount: DISTINCT_SERIES,
        artworkCount: DISTINCT_ARTWORKS,
      })
      .from(artists)
      .leftJoin(artworkSeries, eq(artworkSeries.artistId, artists.id))
      .leftJoin(artworks, eq(artworks.artistId, artists.id))
      .groupBy(artists.id)
      .orderBy(asc(artists.name))
    return reply.send({ data: rows })
  })

  fastify.get("/artists/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const [row] = await db.select().from(artists).where(eq(artists.id, params.data.id)).limit(1)
    if (!row) return reply.code(404).send({ error: "NotFound", message: "Artist not found" })
    return reply.send({ data: row })
  })

  fastify.post("/artists", async (request, reply) => {
    const parsed = createArtistSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const [clash] = await db.select({ id: artists.id }).from(artists).where(eq(artists.slug, parsed.data.slug)).limit(1)
    if (clash) return reply.code(409).send({ error: "Conflict", message: "Slug already used" })

    const [row] = await db.insert(artists).values(parsed.data).returning()
    return reply.code(201).send({ data: row })
  })

  fastify.patch("/artists/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const parsed = updateArtistSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const [row] = await db
      .update(artists)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(artists.id, params.data.id))
      .returning()
    if (!row) return reply.code(404).send({ error: "NotFound", message: "Artist not found" })
    return reply.send({ data: row })
  })

  fastify.delete("/artists/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const [row] = await db.delete(artists).where(eq(artists.id, params.data.id)).returning({ id: artists.id })
    if (!row) return reply.code(404).send({ error: "NotFound", message: "Artist not found" })
    return reply.code(204).send()
  })

  // --- Themes --------------------------------------------------------------

  fastify.get("/themes", async (_request, reply) => {
    const rows = await db
      .select({
        id: artworkThemes.id,
        slug: artworkThemes.slug,
        name: artworkThemes.name,
        description: artworkThemes.description,
        displayOrder: artworkThemes.displayOrder,
        seriesCount: DISTINCT_SERIES,
      })
      .from(artworkThemes)
      .leftJoin(artworkSeries, eq(artworkSeries.themeId, artworkThemes.id))
      .groupBy(artworkThemes.id)
      .orderBy(asc(artworkThemes.displayOrder), asc(artworkThemes.name))
    return reply.send({ data: rows })
  })

  fastify.post("/themes", async (request, reply) => {
    const parsed = createArtworkThemeSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const [clash] = await db
      .select({ id: artworkThemes.id })
      .from(artworkThemes)
      .where(eq(artworkThemes.slug, parsed.data.slug))
      .limit(1)
    if (clash) return reply.code(409).send({ error: "Conflict", message: "Slug already used" })

    const [row] = await db.insert(artworkThemes).values(parsed.data).returning()
    return reply.code(201).send({ data: row })
  })

  fastify.patch("/themes/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const parsed = updateArtworkThemeSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const [row] = await db
      .update(artworkThemes)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(artworkThemes.id, params.data.id))
      .returning()
    if (!row) return reply.code(404).send({ error: "NotFound", message: "Theme not found" })
    return reply.send({ data: row })
  })

  fastify.delete("/themes/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const [row] = await db
      .delete(artworkThemes)
      .where(eq(artworkThemes.id, params.data.id))
      .returning({ id: artworkThemes.id })
    if (!row) return reply.code(404).send({ error: "NotFound", message: "Theme not found" })
    return reply.code(204).send()
  })

  // --- Series --------------------------------------------------------------

  fastify.get("/series", async (_request, reply) => {
    const rows = await db
      .select({
        id: artworkSeries.id,
        slug: artworkSeries.slug,
        title: artworkSeries.title,
        reference: artworkSeries.reference,
        displayOrder: artworkSeries.displayOrder,
        published: artworkSeries.published,
        themeId: artworkSeries.themeId,
        themeName: artworkThemes.name,
        artistId: artworkSeries.artistId,
        artistName: artists.name,
        artworkCount: DISTINCT_ARTWORKS,
      })
      .from(artworkSeries)
      .leftJoin(artworkThemes, eq(artworkSeries.themeId, artworkThemes.id))
      .leftJoin(artists, eq(artworkSeries.artistId, artists.id))
      .leftJoin(artworks, eq(artworks.seriesId, artworkSeries.id))
      .groupBy(artworkSeries.id, artworkThemes.name, artists.name)
      .orderBy(asc(artworkSeries.displayOrder), asc(artworkSeries.title))
    return reply.send({ data: rows })
  })

  fastify.get("/series/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const [row] = await db.select().from(artworkSeries).where(eq(artworkSeries.id, params.data.id)).limit(1)
    if (!row) return reply.code(404).send({ error: "NotFound", message: "Series not found" })
    return reply.send({ data: row })
  })

  fastify.post("/series", async (request, reply) => {
    const parsed = createArtworkSeriesSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const [clash] = await db
      .select({ id: artworkSeries.id })
      .from(artworkSeries)
      .where(eq(artworkSeries.slug, parsed.data.slug))
      .limit(1)
    if (clash) return reply.code(409).send({ error: "Conflict", message: "Slug already used" })

    const missing = await missingReference(parsed.data.themeId, parsed.data.artistId)
    if (missing) return reply.code(400).send({ error: "ValidationError", message: missing })

    const [row] = await db.insert(artworkSeries).values(parsed.data).returning()
    return reply.code(201).send({ data: row })
  })

  fastify.patch("/series/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const parsed = updateArtworkSeriesSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))

    const missing = await missingReference(parsed.data.themeId, parsed.data.artistId)
    if (missing) return reply.code(400).send({ error: "ValidationError", message: missing })

    const [row] = await db
      .update(artworkSeries)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(artworkSeries.id, params.data.id))
      .returning()
    if (!row) return reply.code(404).send({ error: "NotFound", message: "Series not found" })
    return reply.send({ data: row })
  })

  fastify.delete("/series/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send(validationError(params.error.issues))
    const [row] = await db
      .delete(artworkSeries)
      .where(eq(artworkSeries.id, params.data.id))
      .returning({ id: artworkSeries.id })
    if (!row) return reply.code(404).send({ error: "NotFound", message: "Series not found" })
    return reply.code(204).send()
  })
}

/**
 * A dangling FK would otherwise surface as a Postgres 500. Reported as a field
 * error instead, naming which reference is wrong.
 */
async function missingReference(themeId?: string | null, artistId?: string | null): Promise<string | null> {
  if (themeId) {
    const [theme] = await db
      .select({ id: artworkThemes.id })
      .from(artworkThemes)
      .where(eq(artworkThemes.id, themeId))
      .limit(1)
    if (!theme) return `Unknown theme: ${themeId}`
  }
  if (artistId) {
    const [artist] = await db.select({ id: artists.id }).from(artists).where(eq(artists.id, artistId)).limit(1)
    if (!artist) return `Unknown artist: ${artistId}`
  }
  return null
}
