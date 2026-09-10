import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import {
  artists,
  artworkPrints,
  artworkSeries,
  artworks,
  artworkThemes,
  productCategories,
  products,
} from "../db/schema.js"

const PREFIX = "TESTEDITO-"
const SLUG = PREFIX.toLowerCase()

async function categoryId(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(eq(productCategories.slug, slug))
    .limit(1)
  if (!row) throw new Error(`Missing seeded product category: ${slug} (run db:seed)`)
  return row.id
}

describe("Gun Art editorial: series, themes and artist (story 11.6)", () => {
  let app: FastifyInstance
  let artistId: string
  let hiddenArtistId: string
  let themeId: string
  let seriesId: string

  async function cleanup() {
    const artIds = db
      .select({ id: artworks.id })
      .from(artworks)
      .where(like(artworks.sku, `${PREFIX}%`))
    await db.delete(artworkPrints).where(inArray(artworkPrints.artworkId, artIds))
    await db.delete(artworks).where(like(artworks.sku, `${PREFIX}%`))
    await db.delete(products).where(like(products.sku, `${PREFIX}%`))
    await db.delete(artworkSeries).where(like(artworkSeries.slug, `${SLUG}%`))
    await db.delete(artworkThemes).where(like(artworkThemes.slug, `${SLUG}%`))
    await db.delete(artists).where(like(artists.slug, `${SLUG}%`))
  }

  async function seedArtwork(suffix: string, opts: { published: boolean; seriesId?: string; seriesOrder?: number }) {
    const gunArt = await categoryId("gun-art")
    const [product] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}${suffix}`,
        slug: `${PREFIX}${suffix}`,
        name: `Art ${suffix}`,
        categoryId: gunArt,
        priceHt: "100.00",
        requiresLegalVerification: false,
        published: true,
      })
      .returning({ id: products.id })
    if (!product) throw new Error("Test product insert returned no row")

    const [artwork] = await db
      .insert(artworks)
      .values({
        productId: product.id,
        slug: `${PREFIX}${suffix}`,
        sku: `${PREFIX}${suffix}`,
        title: `Art ${suffix}`,
        artistId,
        seriesId: opts.seriesId ?? null,
        seriesOrder: opts.seriesOrder ?? 0,
        editionLimit: 5,
        availableFormats: [{ id: "A4", name: "A4", widthCm: 21, heightCm: 29.7, priceFactor: 1 }],
        basePriceHt: "100.00",
        priceIncrementHt: "10.00",
        vatPct: "20",
        published: opts.published,
      })
      .returning({ id: artworks.id })
    if (!artwork) throw new Error("Test artwork insert returned no row")

    await db.insert(artworkPrints).values({
      artworkId: artwork.id,
      printNumber: 1,
      totalPrints: 5,
      printDesignation: "1/5",
      formatId: "A4",
      priceHtUnit: "140.00",
    })
    return artwork.id
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()

    const [artist] = await db
      .insert(artists)
      .values({
        slug: `${SLUG}artiste`,
        name: "Sylvain de Test",
        headline: "Photographe d'objets",
        bio: "Bio de test.",
        journey: "Parcours de test.",
        bookTitle: "Le livre de test",
        bookUrl: "https://www.amazon.fr/dp/TESTBOOK",
        published: true,
      })
      .returning({ id: artists.id })
    if (!artist) throw new Error("Test artist insert returned no row")
    artistId = artist.id

    const [hidden] = await db
      .insert(artists)
      .values({ slug: `${SLUG}cache`, name: "Artiste non publié", published: false })
      .returning({ id: artists.id })
    if (!hidden) throw new Error("Hidden artist insert returned no row")
    hiddenArtistId = hidden.id

    const [theme] = await db
      .insert(artworkThemes)
      .values({ slug: `${SLUG}theme`, name: "Thème de test", description: "Un thème.", displayOrder: 1 })
      .returning({ id: artworkThemes.id })
    if (!theme) throw new Error("Test theme insert returned no row")
    themeId = theme.id

    const [series] = await db
      .insert(artworkSeries)
      .values({
        slug: `${SLUG}serie`,
        title: "Série de test",
        intro: "Le texte de présentation de la série.",
        reference: "Un film de référence",
        themeId,
        artistId,
        displayOrder: 1,
        published: true,
      })
      .returning({ id: artworkSeries.id })
    if (!series) throw new Error("Test series insert returned no row")
    seriesId = series.id

    await db.insert(artworkSeries).values({
      slug: `${SLUG}brouillon`,
      title: "Série non publiée",
      themeId,
      artistId,
      published: false,
    })

    // Deliberately inserted out of order: the series must be read in the order
    // its author set, not in insertion or alphabetical order.
    await seedArtwork("second", { published: true, seriesId, seriesOrder: 2 })
    await seedArtwork("first", { published: true, seriesId, seriesOrder: 1 })
    await seedArtwork("hidden", { published: false, seriesId, seriesOrder: 3 })
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  describe("GET /api/artworks/series", () => {
    it("lists published series with their theme, artist and artwork count", async () => {
      const res = await app.inject({ method: "GET", url: "/api/artworks/series" })
      expect(res.statusCode).toBe(200)
      const items = res.json().data as Array<{
        slug: string
        theme: { slug: string }
        artist: { name: string }
        artworkCount: number
      }>
      const mine = items.find((s) => s.slug === `${SLUG}serie`)
      expect(mine).toBeDefined()
      expect(mine?.theme.slug).toBe(`${SLUG}theme`)
      expect(mine?.artist.name).toBe("Sylvain de Test")
      // The unpublished artwork is not counted: the badge must not promise more
      // than the gallery shows.
      expect(mine?.artworkCount).toBe(2)
    })

    it("hides an unpublished series", async () => {
      const items = (await app.inject({ method: "GET", url: "/api/artworks/series" })).json().data as Array<{
        slug: string
      }>
      expect(items.some((s) => s.slug === `${SLUG}brouillon`)).toBe(false)
    })
  })

  describe("GET /api/artworks/series/:slug", () => {
    it("returns the presentation text and the artworks in the intended order", async () => {
      const res = await app.inject({ method: "GET", url: `/api/artworks/series/${SLUG}serie` })
      expect(res.statusCode).toBe(200)
      const data = res.json().data
      expect(data.intro).toBe("Le texte de présentation de la série.")
      expect(data.reference).toBe("Un film de référence")
      expect(data.artworks.map((a: { slug: string }) => a.slug)).toEqual([`${PREFIX}first`, `${PREFIX}second`])
    })

    it("never exposes an unpublished artwork of the series", async () => {
      const data = (await app.inject({ method: "GET", url: `/api/artworks/series/${SLUG}serie` })).json().data
      expect(data.artworks.some((a: { slug: string }) => a.slug === `${PREFIX}hidden`)).toBe(false)
    })

    it("404s on an unknown or unpublished series", async () => {
      expect((await app.inject({ method: "GET", url: "/api/artworks/series/nope-xyz" })).statusCode).toBe(404)
      expect((await app.inject({ method: "GET", url: `/api/artworks/series/${SLUG}brouillon` })).statusCode).toBe(404)
    })
  })

  describe("GET /api/artworks/themes", () => {
    it("counts only the published series of each theme", async () => {
      const items = (await app.inject({ method: "GET", url: "/api/artworks/themes" })).json().data as Array<{
        slug: string
        seriesCount: number
      }>
      expect(items.find((t) => t.slug === `${SLUG}theme`)?.seriesCount).toBe(1)
    })

    it("returns a theme with the series it gathers", async () => {
      const res = await app.inject({ method: "GET", url: `/api/artworks/themes/${SLUG}theme` })
      expect(res.statusCode).toBe(200)
      const data = res.json().data
      expect(data.name).toBe("Thème de test")
      expect(data.series.map((s: { slug: string }) => s.slug)).toEqual([`${SLUG}serie`])
    })

    it("404s on an unknown theme", async () => {
      expect((await app.inject({ method: "GET", url: "/api/artworks/themes/nope-xyz" })).statusCode).toBe(404)
    })
  })

  describe("GET /api/artists/:slug", () => {
    it("returns bio, journey, series and body of work", async () => {
      const res = await app.inject({ method: "GET", url: `/api/artists/${SLUG}artiste` })
      expect(res.statusCode).toBe(200)
      const data = res.json().data
      expect(data.name).toBe("Sylvain de Test")
      expect(data.headline).toBe("Photographe d'objets")
      expect(data.journey).toBe("Parcours de test.")
      expect(data.series.map((s: { slug: string }) => s.slug)).toEqual([`${SLUG}serie`])
      expect(data.artworks).toHaveLength(2)
    })

    it("groups the book link so a title-less URL is never rendered", async () => {
      const data = (await app.inject({ method: "GET", url: `/api/artists/${SLUG}artiste` })).json().data
      expect(data.book).toEqual({ title: "Le livre de test", url: "https://www.amazon.fr/dp/TESTBOOK" })
      expect(data.bookUrl).toBeUndefined()

      // A URL with no title yields no link at all rather than a bare one.
      await db.update(artists).set({ bookTitle: null }).where(eq(artists.id, artistId))
      const stripped = (await app.inject({ method: "GET", url: `/api/artists/${SLUG}artiste` })).json().data
      expect(stripped.book).toBeNull()
      await db.update(artists).set({ bookTitle: "Le livre de test" }).where(eq(artists.id, artistId))
    })

    it("404s on an unpublished artist", async () => {
      expect((await app.inject({ method: "GET", url: `/api/artists/${SLUG}cache` })).statusCode).toBe(404)
      expect(hiddenArtistId).toBeDefined()
    })

    it("lists only published artists", async () => {
      const items = (await app.inject({ method: "GET", url: "/api/artists" })).json().data as Array<{ slug: string }>
      expect(items.some((a) => a.slug === `${SLUG}artiste`)).toBe(true)
      expect(items.some((a) => a.slug === `${SLUG}cache`)).toBe(false)
    })
  })

  describe("artwork detail", () => {
    it("carries its series and the theme behind it", async () => {
      const data = (await app.inject({ method: "GET", url: `/api/artworks/${PREFIX}first` })).json().data
      expect(data.series).toMatchObject({ slug: `${SLUG}serie`, title: "Série de test" })
      expect(data.series.theme).toMatchObject({ slug: `${SLUG}theme` })
      expect(data.artist).toMatchObject({ slug: `${SLUG}artiste` })
    })

    it("keeps an artwork visible when its series is unpublished, without the label", async () => {
      const [draft] = await db
        .select({ id: artworkSeries.id })
        .from(artworkSeries)
        .where(eq(artworkSeries.slug, `${SLUG}brouillon`))
        .limit(1)
      await db
        .update(artworks)
        .set({ seriesId: draft?.id })
        .where(eq(artworks.sku, `${PREFIX}second`))

      const res = await app.inject({ method: "GET", url: `/api/artworks/${PREFIX}second` })
      expect(res.statusCode).toBe(200)
      expect(res.json().data.series).toBeNull()

      await db
        .update(artworks)
        .set({ seriesId })
        .where(eq(artworks.sku, `${PREFIX}second`))
    })
  })
})
