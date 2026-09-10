import { computePriceTtc } from "@armurier/shared"
import { and, asc, eq } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { artists, artworkPrints, artworkSeries, artworks, artworkThemes } from "../db/schema.js"
import { selectArtworkCards } from "./cards.js"

/** GET /api/artworks — published Gun Art collection (one card per artwork). */
export const listArtworksRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (_request, reply) => {
    return reply.code(200).send({ data: await selectArtworkCards(undefined) })
  })
}

/** GET /api/artworks/:slug — one published artwork with its numbered prints. */
export const getArtworkRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/:slug", async (request, reply) => {
    const slug = (request.params as { slug: string }).slug
    // Bound the param (consistency with the rest of the API; slugs are short).
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 200) {
      return reply.code(404).send({ error: "NotFound", message: "Artwork not found" })
    }

    const [art] = await db
      .select({
        id: artworks.id,
        slug: artworks.slug,
        title: artworks.title,
        description: artworks.description,
        longDescription: artworks.longDescription,
        artistSlug: artists.slug,
        artistName: artists.name,
        artistHeadline: artists.headline,
        artistBio: artists.bio,
        artistPortraitUrl: artists.portraitUrl,
        seriesSlug: artworkSeries.slug,
        seriesTitle: artworkSeries.title,
        seriesIntro: artworkSeries.intro,
        seriesReference: artworkSeries.reference,
        themeSlug: artworkThemes.slug,
        themeName: artworkThemes.name,
        featuredImageUrl: artworks.featuredImageUrl,
        orientation: artworks.orientation,
        editionLimit: artworks.editionLimit,
        editionYear: artworks.editionYear,
        availableFormats: artworks.availableFormats,
        vatPct: artworks.vatPct,
        includeCertificate: artworks.includeCertificate,
      })
      .from(artworks)
      .leftJoin(artists, and(eq(artworks.artistId, artists.id), eq(artists.published, true)))
      .leftJoin(artworkSeries, and(eq(artworks.seriesId, artworkSeries.id), eq(artworkSeries.published, true)))
      .leftJoin(artworkThemes, eq(artworkSeries.themeId, artworkThemes.id))
      .where(and(eq(artworks.slug, slug), eq(artworks.published, true)))
      .limit(1)

    if (!art) {
      return reply.code(404).send({ error: "NotFound", message: "Artwork not found" })
    }

    const vatPct = Number(art.vatPct ?? 20)
    const printRows = await db
      .select({
        id: artworkPrints.id,
        printNumber: artworkPrints.printNumber,
        printDesignation: artworkPrints.printDesignation,
        formatId: artworkPrints.formatId,
        status: artworkPrints.status,
        priceHtUnit: artworkPrints.priceHtUnit,
      })
      .from(artworkPrints)
      .where(eq(artworkPrints.artworkId, art.id))
      .orderBy(asc(artworkPrints.printNumber))

    const prints = printRows.map((p) => {
      const priceHt = Number(p.priceHtUnit)
      return {
        id: p.id,
        printNumber: p.printNumber,
        printDesignation: p.printDesignation,
        formatId: p.formatId,
        status: p.status,
        priceHt,
        priceTtc: computePriceTtc(priceHt, vatPct),
      }
    })

    const availablePrints = prints.filter((p) => p.status === "available")
    const priceFromHt = availablePrints.length > 0 ? Math.min(...availablePrints.map((p) => p.priceHt)) : null

    const {
      artistSlug,
      artistName,
      artistHeadline,
      artistBio,
      artistPortraitUrl,
      seriesSlug,
      seriesTitle,
      seriesIntro,
      seriesReference,
      themeSlug,
      themeName,
      ...core
    } = art

    return reply.code(200).send({
      data: {
        ...core,
        // Nested rather than flattened: the detail page links to the artist and
        // to the series, so it needs their slugs, not just their labels.
        artist: artistSlug
          ? {
              slug: artistSlug,
              name: artistName,
              headline: artistHeadline,
              bio: artistBio,
              portraitUrl: artistPortraitUrl,
            }
          : null,
        series: seriesSlug
          ? {
              slug: seriesSlug,
              title: seriesTitle,
              intro: seriesIntro,
              reference: seriesReference,
              theme: themeSlug ? { slug: themeSlug, name: themeName } : null,
            }
          : null,
        vatPct,
        prints,
        availableCount: availablePrints.length,
        soldCount: prints.filter((p) => p.status === "sold").length,
        priceFromHt,
        priceFromTtc: priceFromHt === null ? null : computePriceTtc(priceFromHt, vatPct),
      },
    })
  })
}
