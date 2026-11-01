import { E2E_FIXTURES, mediaRenditions } from "@armurier/shared"
import { and, eq } from "drizzle-orm"
import { afterAll, describe, expect, it } from "vitest"
import { db } from "../db/client.js"
import {
  artists,
  artworkPrints,
  artworkSeries,
  artworks,
  blogPosts,
  media,
  productCategories,
  products,
  productTags,
  tags,
} from "../db/schema.js"
import { storage } from "../storage/index.js"
import { assertE2eEnvironment, removeE2eFixtures, seedE2eFixtures } from "./fixtures.js"

/** The stored WebP and share card behind an owner's main visual are really there. */
async function expectServableVisual(url: string | null | undefined) {
  const set = mediaRenditions(url)
  expect(set, `not a media rendition: ${url}`).not.toBeNull()
  if (!set) return
  await expect(storage.getBytes(`media/${set.id}/${set.widths.at(-1)}.webp`)).resolves.toBeInstanceOf(Buffer)
  await expect(storage.getBytes(`media/${set.id}/og.jpg`)).resolves.toBeInstanceOf(Buffer)
}

describe("e2e fixtures (layout checks)", () => {
  afterAll(async () => {
    await removeE2eFixtures()
  })

  it("refuses to run anywhere but a throwaway, in-memory environment", () => {
    expect(() => assertE2eEnvironment({ NODE_ENV: "production", STORAGE_DRIVER: "memory" })).toThrow()
    expect(() => assertE2eEnvironment({ NODE_ENV: "test", STORAGE_DRIVER: "s3" })).toThrow()
    expect(() => assertE2eEnvironment({ NODE_ENV: "test", STORAGE_DRIVER: undefined })).toThrow()
    expect(() => assertE2eEnvironment({ NODE_ENV: "test", STORAGE_DRIVER: "memory" })).not.toThrow()
  })

  it("seeds a published product, filed and tagged, with a real uploaded visual", async () => {
    await seedE2eFixtures()

    const [product] = await db
      .select({
        id: products.id,
        name: products.name,
        image: products.featuredImageUrl,
        category: productCategories.slug,
      })
      .from(products)
      .innerJoin(productCategories, eq(productCategories.id, products.categoryId))
      .where(and(eq(products.slug, E2E_FIXTURES.product), eq(products.published, true)))
    expect(product?.category).toBe(E2E_FIXTURES.category)
    // The unbreakable word is the point of this fixture.
    expect(product?.name.split(" ").some((word) => word.length >= 40)).toBe(true)
    await expectServableVisual(product?.image)

    const tagged = await db
      .select({ tag: tags.slug })
      .from(productTags)
      .innerJoin(tags, eq(tags.id, productTags.tagId))
      .where(eq(productTags.productId, product?.id ?? ""))
    expect(tagged.map((row) => row.tag)).toContain(E2E_FIXTURES.tag)
  })

  it("seeds an artist, a series and a watermarked artwork with prints for sale", async () => {
    const [artist] = await db.select().from(artists).where(eq(artists.slug, E2E_FIXTURES.artist))
    expect(artist?.published).toBe(true)
    await expectServableVisual(artist?.portraitUrl)

    const [series] = await db.select().from(artworkSeries).where(eq(artworkSeries.slug, E2E_FIXTURES.series))
    expect(series?.artistId).toBe(artist?.id)

    const [artwork] = await db.select().from(artworks).where(eq(artworks.slug, E2E_FIXTURES.artwork))
    expect(artwork).toMatchObject({ published: true, artistId: artist?.id, seriesId: series?.id })
    await expectServableVisual(artwork?.featuredImageUrl)
    const [visual] = await db
      .select()
      .from(media)
      .where(eq(media.ownerId, artwork?.id ?? ""))
    expect(visual?.watermarked).toBe(true)

    const prints = await db
      .select()
      .from(artworkPrints)
      .where(eq(artworkPrints.artworkId, artwork?.id ?? ""))
    expect(prints.some((print) => print.status === "available")).toBe(true)
  })

  it("seeds a published journal post", async () => {
    const [post] = await db.select().from(blogPosts).where(eq(blogPosts.slug, E2E_FIXTURES.post))
    expect(post?.published).toBe(true)
    expect(post?.publishedAt).toBeInstanceOf(Date)
  })

  /**
   * ⚠️ The e2e API stores images in memory, so a restart keeps the rows and
   * loses the bytes. Skipping fixtures that already exist would serve broken
   * images on every run after the first: each run starts them over instead.
   */
  it("starts over on each run: nothing duplicated, every visual servable again", async () => {
    const [before] = await db
      .select({ id: media.id })
      .from(media)
      .innerJoin(products, eq(products.id, media.ownerId))
      .where(eq(products.slug, E2E_FIXTURES.product))
    await storage.delete(`media/${before?.id}/og.jpg`)

    await seedE2eFixtures()
    const [product] = await db
      .select({ id: products.id, image: products.featuredImageUrl })
      .from(products)
      .where(eq(products.slug, E2E_FIXTURES.product))
    expect(
      await db
        .select()
        .from(media)
        .where(eq(media.ownerId, product?.id ?? "")),
    ).toHaveLength(1)
    await expectServableVisual(product?.image)
  })
})
