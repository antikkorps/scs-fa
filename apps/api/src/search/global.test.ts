import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { artworkPrints, artworks, productCategories, products } from "../db/schema.js"

// A distinctive token so the fixtures are isolated from any seeded/demo rows and
// from each other's full-text matches.
const PREFIX = "TESTSEARCH-"
const TOKEN = "zorglubium"

async function categoryId(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(eq(productCategories.slug, slug))
    .limit(1)
  if (!row) throw new Error(`Missing seeded product category: ${slug} (run db:seed)`)
  return row.id
}

describe("GET /api/search", () => {
  let app: FastifyInstance

  async function cleanup() {
    const artIds = db
      .select({ id: artworks.id })
      .from(artworks)
      .where(like(artworks.sku, `${PREFIX}%`))
    await db.delete(artworkPrints).where(inArray(artworkPrints.artworkId, artIds))
    await db.delete(artworks).where(like(artworks.sku, `${PREFIX}%`))
    await db.delete(products).where(like(products.sku, `${PREFIX}%`))
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()

    const armePoing = await categoryId("arme-poing")
    const gunArt = await categoryId("gun-art")

    // A published firearm whose name carries the token.
    await db.insert(products).values({
      sku: `${PREFIX}gun`,
      slug: `${PREFIX}gun`,
      name: `Pistolet ${TOKEN}`,
      description: "Une arme de test",
      categoryId: armePoing,
      priceHt: "800.00",
      vatPct: "20",
      requiresLegalVerification: true,
      published: true,
    })

    // An unpublished firearm that also matches — must stay hidden.
    await db.insert(products).values({
      sku: `${PREFIX}hidden`,
      slug: `${PREFIX}hidden`,
      name: `Carabine ${TOKEN}`,
      categoryId: armePoing,
      priceHt: "500.00",
      vatPct: "20",
      requiresLegalVerification: true,
      published: false,
    })

    // A published artwork whose title carries the token, with one available print.
    const [artProduct] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}art`,
        slug: `${PREFIX}art`,
        name: `Art ${TOKEN}`,
        categoryId: gunArt,
        priceHt: "300.00",
        vatPct: "20",
        requiresLegalVerification: false,
        published: true,
      })
      .returning({ id: products.id })

    const [artwork] = await db
      .insert(artworks)
      .values({
        productId: artProduct.id,
        slug: `${PREFIX}art`,
        sku: `${PREFIX}art`,
        title: `Tirage ${TOKEN}`,
        artistName: "Test Artist",
        editionLimit: 10,
        availableFormats: [{ id: "A4", name: "A4", widthCm: 21, heightCm: 29.7, priceFactor: 1 }],
        basePriceHt: "300.00",
        priceIncrementHt: "10.00",
        vatPct: "20",
        orientation: "square",
        published: true,
      })
      .returning({ id: artworks.id })

    await db.insert(artworkPrints).values({
      artworkId: artwork.id,
      printNumber: 1,
      totalPrints: 10,
      printDesignation: "1/10",
      formatId: "A4",
      status: "available",
      priceHtUnit: "300.00",
    })
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("400s when q is missing", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("ValidationError")
  })

  it("returns matching products and artworks under a typed envelope", async () => {
    const res = await app.inject({ method: "GET", url: `/api/search?q=${TOKEN}` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.query).toBe(TOKEN)

    const productSkus = body.products.map((p: { sku: string }) => p.sku)
    expect(productSkus).toContain(`${PREFIX}gun`)
    // unpublished match is hidden
    expect(productSkus).not.toContain(`${PREFIX}hidden`)
    // the gun-art product backs an artwork, not a standalone product result
    expect(productSkus).not.toContain(`${PREFIX}art`)

    const artworkSlugs = body.artworks.map((a: { slug: string }) => a.slug)
    expect(artworkSlugs).toContain(`${PREFIX}art`)
  })

  it("computes priceTtc and artwork availability", async () => {
    const res = await app.inject({ method: "GET", url: `/api/search?q=${TOKEN}` })
    const body = res.json()

    const gun = body.products.find((p: { sku: string }) => p.sku === `${PREFIX}gun`)
    expect(gun.priceHt).toBe(800)
    expect(gun.priceTtc).toBe(960)
    expect(gun.category).toMatchObject({ slug: "arme-poing" })

    const art = body.artworks.find((a: { slug: string }) => a.slug === `${PREFIX}art`)
    expect(art.orientation).toBe("square")
    expect(art.availableCount).toBe(1)
    expect(art.priceFromHt).toBe(300)
    expect(art.priceFromTtc).toBe(360)
  })

  it("returns empty arrays for a non-matching query", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=nonexistentqwxyz" })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.products).toEqual([])
    expect(body.artworks).toEqual([])
  })
})
