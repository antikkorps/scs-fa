import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { artworkPrints, artworks, productCategories, products } from "../db/schema.js"

const PREFIX = "TESTART-"

async function categoryId(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(eq(productCategories.slug, slug))
    .limit(1)
  if (!row) throw new Error(`Missing seeded product category: ${slug} (run db:seed)`)
  return row.id
}

describe("public artwork routes (/api/artworks)", () => {
  let app: FastifyInstance
  let publishedSlug: string

  async function cleanup() {
    const artIds = db
      .select({ id: artworks.id })
      .from(artworks)
      .where(like(artworks.sku, `${PREFIX}%`))
    await db.delete(artworkPrints).where(inArray(artworkPrints.artworkId, artIds))
    await db.delete(artworks).where(like(artworks.sku, `${PREFIX}%`))
    await db.delete(products).where(like(products.sku, `${PREFIX}%`))
  }

  async function seedArtwork(opts: {
    suffix: string
    published: boolean
    editionLimit: number
    basePriceHt: number
    soldCount: number
    orientation?: "portrait" | "landscape" | "square"
  }) {
    const gunArt = await categoryId("gun-art")
    const [product] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}${opts.suffix}`,
        slug: `${PREFIX}${opts.suffix}`,
        name: `Art ${opts.suffix}`,
        categoryId: gunArt,
        priceHt: opts.basePriceHt.toFixed(2),
        requiresLegalVerification: false,
        published: true,
      })
      .returning({ id: products.id })
    const [artwork] = await db
      .insert(artworks)
      .values({
        productId: product.id,
        slug: `${PREFIX}${opts.suffix}`,
        sku: `${PREFIX}${opts.suffix}`,
        title: `Art ${opts.suffix}`,
        artistName: "Test Artist",
        editionLimit: opts.editionLimit,
        availableFormats: [{ id: "A4", name: "A4", widthCm: 21, heightCm: 29.7, priceFactor: 1 }],
        basePriceHt: opts.basePriceHt.toFixed(2),
        priceIncrementHt: "10.00",
        vatPct: "20",
        featuredImageUrl: null,
        orientation: opts.orientation ?? "portrait",
        published: opts.published,
      })
      .returning({ id: artworks.id, slug: artworks.slug })

    // Cheapest available print = last number (base price, no rarity bonus).
    const values = Array.from({ length: opts.editionLimit }, (_, i) => {
      const n = i + 1
      const priceHt = opts.basePriceHt + 10 * (opts.editionLimit - n)
      return {
        artworkId: artwork.id,
        printNumber: n,
        totalPrints: opts.editionLimit,
        printDesignation: `${n}/${opts.editionLimit}`,
        formatId: "A4",
        priceHtUnit: priceHt.toFixed(2),
        status: (n <= opts.soldCount ? "sold" : "available") as "sold" | "available",
      }
    })
    await db.insert(artworkPrints).values(values)
    return artwork.slug
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
    publishedSlug = await seedArtwork({
      suffix: "pub",
      published: true,
      editionLimit: 10,
      basePriceHt: 100,
      soldCount: 3,
      orientation: "landscape",
    })
    await seedArtwork({ suffix: "hidden", published: false, editionLimit: 5, basePriceHt: 50, soldCount: 0 })
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("lists only published artworks with availability and price-from", async () => {
    const res = await app.inject({ method: "GET", url: "/api/artworks" })
    expect(res.statusCode).toBe(200)
    const items = res.json().data as Array<{
      slug: string
      orientation: string
      availableCount: number
      soldCount: number
      priceFromHt: number
      priceFromTtc: number
    }>

    const pub = items.find((a) => a.slug === publishedSlug)
    expect(pub).toBeDefined()
    expect(pub?.orientation).toBe("landscape")
    expect(pub?.availableCount).toBe(7) // 10 - 3 sold
    expect(pub?.soldCount).toBe(3)
    // cheapest available = print 10 = base 100 HT -> 120 TTC
    expect(pub?.priceFromHt).toBe(100)
    expect(pub?.priceFromTtc).toBe(120)

    expect(items.some((a) => a.slug === `${PREFIX}hidden`)).toBe(false)
  })

  it("returns a published artwork with its prints", async () => {
    const res = await app.inject({ method: "GET", url: `/api/artworks/${publishedSlug}` })
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data.slug).toBe(publishedSlug)
    expect(data.orientation).toBe("landscape")
    expect(data.prints).toHaveLength(10)
    expect(data.availableCount).toBe(7)
    expect(data.soldCount).toBe(3)
    expect(data.priceFromHt).toBe(100)
    // prints carry a TTC price
    const last = data.prints.find((p: { printNumber: number }) => p.printNumber === 10)
    expect(last.priceHt).toBe(100)
    expect(last.priceTtc).toBe(120)
  })

  it("404s on an unknown slug", async () => {
    const res = await app.inject({ method: "GET", url: "/api/artworks/does-not-exist-xyz" })
    expect(res.statusCode).toBe(404)
  })

  it("404s on an unpublished artwork", async () => {
    const res = await app.inject({ method: "GET", url: `/api/artworks/${PREFIX}hidden` })
    expect(res.statusCode).toBe(404)
  })
})
