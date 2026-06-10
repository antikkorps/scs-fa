import { computePriceTtc } from "@armurier/shared"
import { and, asc, desc, eq, sql } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import { artworkPrints, artworks } from "../db/schema.js"

// Aggregated availability/price-from for the collection grid.
const AVAILABLE_COUNT = sql<number>`count(${artworkPrints.id}) filter (where ${artworkPrints.status} = 'available')::int`
const SOLD_COUNT = sql<number>`count(${artworkPrints.id}) filter (where ${artworkPrints.status} = 'sold')::int`
const PRICE_FROM = sql<
  string | null
>`min(${artworkPrints.priceHtUnit}) filter (where ${artworkPrints.status} = 'available')`

/** GET /api/artworks — published Gun Art collection (one card per artwork). */
export const listArtworksRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (_request, reply) => {
    const rows = await db
      .select({
        id: artworks.id,
        slug: artworks.slug,
        title: artworks.title,
        artistName: artworks.artistName,
        description: artworks.description,
        featuredImageUrl: artworks.featuredImageUrl,
        editionLimit: artworks.editionLimit,
        editionYear: artworks.editionYear,
        vatPct: artworks.vatPct,
        featured: artworks.featured,
        availableCount: AVAILABLE_COUNT,
        soldCount: SOLD_COUNT,
        priceFromHt: PRICE_FROM,
      })
      .from(artworks)
      .leftJoin(artworkPrints, eq(artworkPrints.artworkId, artworks.id))
      .where(eq(artworks.published, true))
      .groupBy(artworks.id)
      .orderBy(desc(artworks.featured), desc(artworks.createdAt))

    const data = rows.map((r) => {
      const vatPct = Number(r.vatPct ?? 20)
      const priceFromHt = r.priceFromHt === null ? null : Number(r.priceFromHt)
      return {
        id: r.id,
        slug: r.slug,
        title: r.title,
        artistName: r.artistName,
        description: r.description,
        featuredImageUrl: r.featuredImageUrl,
        editionLimit: r.editionLimit,
        editionYear: r.editionYear,
        availableCount: r.availableCount,
        soldCount: r.soldCount,
        priceFromHt,
        priceFromTtc: priceFromHt === null ? null : computePriceTtc(priceFromHt, vatPct),
      }
    })

    return reply.code(200).send({ data })
  })
}

/** GET /api/artworks/:slug — one published artwork with its numbered prints. */
export const getArtworkRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/:slug", async (request, reply) => {
    const slug = (request.params as { slug: string }).slug

    const [art] = await db
      .select({
        id: artworks.id,
        slug: artworks.slug,
        title: artworks.title,
        description: artworks.description,
        longDescription: artworks.longDescription,
        artistName: artworks.artistName,
        artistBio: artworks.artistBio,
        featuredImageUrl: artworks.featuredImageUrl,
        editionLimit: artworks.editionLimit,
        editionYear: artworks.editionYear,
        availableFormats: artworks.availableFormats,
        vatPct: artworks.vatPct,
        includeCertificate: artworks.includeCertificate,
      })
      .from(artworks)
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

    return reply.code(200).send({
      data: {
        ...art,
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
