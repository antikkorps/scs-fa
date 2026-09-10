import { and, asc, count, eq, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { artists, artworkSeries, artworks, artworkThemes } from "../db/schema.js"
import { selectArtworkCards } from "./cards.js"

// How many published artworks a series actually holds — a series announced with
// nothing in it would be a dead link on the collection page.
const ARTWORK_COUNT = sql<number>`(
  select count(*)::int from ${artworks}
  where ${artworks.seriesId} = ${artworkSeries.id} and ${artworks.published} = true
)`

const SERIES_COLUMNS = {
  id: artworkSeries.id,
  slug: artworkSeries.slug,
  title: artworkSeries.title,
  intro: artworkSeries.intro,
  reference: artworkSeries.reference,
  coverImageUrl: artworkSeries.coverImageUrl,
  themeSlug: artworkThemes.slug,
  themeName: artworkThemes.name,
  artistSlug: artists.slug,
  artistName: artists.name,
  artworkCount: ARTWORK_COUNT,
}

type SeriesRow = {
  id: string
  slug: string
  title: string
  intro: string | null
  reference: string | null
  coverImageUrl: string | null
  themeSlug: string | null
  themeName: string | null
  artistSlug: string | null
  artistName: string | null
  artworkCount: number
}

function toSeries(r: SeriesRow) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    intro: r.intro,
    reference: r.reference,
    coverImageUrl: r.coverImageUrl,
    theme: r.themeSlug ? { slug: r.themeSlug, name: r.themeName } : null,
    artist: r.artistSlug ? { slug: r.artistSlug, name: r.artistName } : null,
    artworkCount: r.artworkCount,
  }
}

/** The published-series query, joined to its theme and its (published) artist. */
function seriesQuery() {
  return db
    .select(SERIES_COLUMNS)
    .from(artworkSeries)
    .leftJoin(artworkThemes, eq(artworkSeries.themeId, artworkThemes.id))
    .leftJoin(artists, and(eq(artworkSeries.artistId, artists.id), eq(artists.published, true)))
}

/**
 * Gun Art editorial routes (story 11.6): series and themes.
 *
 * ⚠️ Mounted under `/api/artworks`, so `series` and `themes` join `images`
 * (story 11.5) in the list of **reserved artwork slugs**: a static segment wins
 * over `/api/artworks/:slug` in the router, and an artwork carrying one of
 * those slugs would become unreachable.
 */
export const artworkEditorialRoutes: FastifyPluginAsync = async (fastify) => {
  /** GET /api/artworks/series — every published series, newest editorial order first. */
  fastify.get("/series", async (_request, reply) => {
    const rows = await seriesQuery()
      .where(eq(artworkSeries.published, true))
      .orderBy(asc(artworkSeries.displayOrder), asc(artworkSeries.title))
    return reply.code(200).send({ data: rows.map(toSeries) })
  })

  /** GET /api/artworks/series/:slug — one series, its presentation text and its artworks. */
  fastify.get("/series/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string }
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 200) {
      return reply.code(404).send({ error: "NotFound", message: "Series not found" })
    }

    const [row] = await seriesQuery()
      .where(and(eq(artworkSeries.slug, slug), eq(artworkSeries.published, true)))
      .limit(1)
    if (!row) {
      return reply.code(404).send({ error: "NotFound", message: "Series not found" })
    }

    // A series is read in the order its author intended, not by date.
    const artworksInSeries = await selectArtworkCards(eq(artworks.seriesId, row.id), "series")
    return reply.code(200).send({ data: { ...toSeries(row), artworks: artworksInSeries } })
  })

  /** GET /api/artworks/themes — the navigation by theme, each with its published series. */
  fastify.get("/themes", async (_request, reply) => {
    const themes = await db
      .select({
        id: artworkThemes.id,
        slug: artworkThemes.slug,
        name: artworkThemes.name,
        description: artworkThemes.description,
        seriesCount: count(artworkSeries.id),
      })
      .from(artworkThemes)
      .leftJoin(artworkSeries, and(eq(artworkSeries.themeId, artworkThemes.id), eq(artworkSeries.published, true)))
      .groupBy(artworkThemes.id)
      .orderBy(asc(artworkThemes.displayOrder), asc(artworkThemes.name))

    return reply.code(200).send({ data: themes })
  })

  /** GET /api/artworks/themes/:slug — one theme and the series it gathers. */
  fastify.get("/themes/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string }
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 200) {
      return reply.code(404).send({ error: "NotFound", message: "Theme not found" })
    }

    const [theme] = await db
      .select({
        id: artworkThemes.id,
        slug: artworkThemes.slug,
        name: artworkThemes.name,
        description: artworkThemes.description,
      })
      .from(artworkThemes)
      .where(eq(artworkThemes.slug, slug))
      .limit(1)
    if (!theme) {
      return reply.code(404).send({ error: "NotFound", message: "Theme not found" })
    }

    const rows = await seriesQuery()
      .where(and(eq(artworkSeries.themeId, theme.id), eq(artworkSeries.published, true)))
      .orderBy(asc(artworkSeries.displayOrder), asc(artworkSeries.title))

    return reply.code(200).send({ data: { ...theme, series: rows.map(toSeries) } })
  })
}
