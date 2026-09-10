import { and, asc, eq } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { selectArtworkCards } from "../artworks/cards.js"
import { db } from "../db/client.js"
import { artists, artworkSeries, artworks, artworkThemes } from "../db/schema.js"

const PUBLIC_COLUMNS = {
  id: artists.id,
  slug: artists.slug,
  name: artists.name,
  headline: artists.headline,
  bio: artists.bio,
  journey: artists.journey,
  portraitUrl: artists.portraitUrl,
  bookTitle: artists.bookTitle,
  bookUrl: artists.bookUrl,
  metaTitle: artists.metaTitle,
  metaDescription: artists.metaDescription,
}

/**
 * Public artist pages (story 11.6).
 *
 * Mounted on its own prefix rather than under `/api/artworks`: an artist is not
 * an artwork, and every static segment added there costs one more reserved
 * artwork slug.
 */
export const artistRoutes: FastifyPluginAsync = async (fastify) => {
  /** GET /api/artists — published artists (the client has one; the model does not assume it). */
  fastify.get("/", async (_request, reply) => {
    const rows = await db
      .select(PUBLIC_COLUMNS)
      .from(artists)
      .where(eq(artists.published, true))
      .orderBy(asc(artists.name))
    return reply.code(200).send({ data: rows })
  })

  /** GET /api/artists/:slug — bio, journey, book link, series and body of work. */
  fastify.get("/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string }
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 200) {
      return reply.code(404).send({ error: "NotFound", message: "Artist not found" })
    }

    const [artist] = await db
      .select(PUBLIC_COLUMNS)
      .from(artists)
      .where(and(eq(artists.slug, slug), eq(artists.published, true)))
      .limit(1)
    if (!artist) {
      return reply.code(404).send({ error: "NotFound", message: "Artist not found" })
    }

    const series = await db
      .select({
        id: artworkSeries.id,
        slug: artworkSeries.slug,
        title: artworkSeries.title,
        intro: artworkSeries.intro,
        reference: artworkSeries.reference,
        coverImageUrl: artworkSeries.coverImageUrl,
        themeSlug: artworkThemes.slug,
        themeName: artworkThemes.name,
      })
      .from(artworkSeries)
      .leftJoin(artworkThemes, eq(artworkSeries.themeId, artworkThemes.id))
      .where(and(eq(artworkSeries.artistId, artist.id), eq(artworkSeries.published, true)))
      .orderBy(asc(artworkSeries.displayOrder), asc(artworkSeries.title))

    const { bookTitle, bookUrl, ...rest } = artist
    return reply.code(200).send({
      data: {
        ...rest,
        // Grouped, so the front renders the affiliate link only when both halves
        // are there — a URL with no title reads as a bare, untrustworthy link.
        book: bookUrl && bookTitle ? { title: bookTitle, url: bookUrl } : null,
        series: series.map((s) => ({
          id: s.id,
          slug: s.slug,
          title: s.title,
          intro: s.intro,
          reference: s.reference,
          coverImageUrl: s.coverImageUrl,
          theme: s.themeSlug ? { slug: s.themeSlug, name: s.themeName } : null,
        })),
        artworks: await selectArtworkCards(eq(artworks.artistId, artist.id)),
      },
    })
  })
}
