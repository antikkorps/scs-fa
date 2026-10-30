import { calculateArtworkPrice, E2E_FIXTURES } from "@armurier/shared"
import { eq, inArray } from "drizzle-orm"
import sharp from "sharp"
import { db } from "../db/client.js"
import {
  artists,
  artworkPrints,
  artworkSeries,
  artworks,
  artworkThemes,
  blogPosts,
  legalCategories,
  productCategories,
  products,
  productTags,
  tags,
} from "../db/schema.js"
import { A4_FORMAT, FORMATS } from "../db/seeds.js"
import { appendOwnerMedia, deleteMediaForOwner } from "../media/service.js"

// The content the layout checks browse (apps/web/e2e), on top of the demo
// catalogue: fixed slugs, real visuals through the real upload pipeline, and
// copy long enough to break a layout that only holds with short demo names.

const PRODUCT_NAME =
  "Carabine semi-automatique de battue Verney-Carron Impact NT Grande-Épaisseur " +
  "Référence-Constructeur-VC-IMPACT-NT-BATTUE-CANON-56-CM-CROSSE-NOYER-GRADE-3"
const ARTWORK_SKU = `ART-${E2E_FIXTURES.artwork}`
const EDITION_LIMIT = 8
const SOLD_PRINTS = 3

/**
 * The e2e API keeps its images in memory and its rows in Postgres: it must
 * never run against a real bucket or a production database.
 */
export function assertE2eEnvironment(env: { NODE_ENV?: string; STORAGE_DRIVER?: string }) {
  if (env.NODE_ENV === "production") throw new Error("The e2e fixtures never run in production")
  if (env.STORAGE_DRIVER !== "memory") throw new Error("The e2e fixtures need STORAGE_DRIVER=memory")
}

/** A generated "photo": a gradient with a few shapes, so a card has something to show. */
function syntheticPhoto(width: number, height: number, hue: number): Promise<Buffer> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},45%,35%)"/><stop offset="1" stop-color="hsl(${hue + 40},35%,12%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#g)"/>` +
    `<circle cx="${width * 0.3}" cy="${height * 0.4}" r="${Math.min(width, height) * 0.2}" fill="hsl(${hue},30%,70%)"/>` +
    `<rect x="${width * 0.5}" y="${height * 0.55}" width="${width * 0.35}" height="${height * 0.12}" fill="hsl(${hue + 180},25%,55%)"/>` +
    `</svg>`
  return sharp(Buffer.from(svg)).jpeg().toBuffer()
}

async function requireId(query: Promise<{ id: string }[]>, what: string): Promise<string> {
  const [row] = await query
  if (!row) throw new Error(`e2e fixtures: missing ${what} (run the reference and demo seeds first)`)
  return row.id
}

/** Remove every e2e fixture, files included. Safe when there is none. */
export async function removeE2eFixtures() {
  const productIds = (
    await db
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.slug, [E2E_FIXTURES.product, `art-${E2E_FIXTURES.artwork}`]))
  ).map((row) => row.id)
  const [artwork] = await db.select({ id: artworks.id }).from(artworks).where(eq(artworks.slug, E2E_FIXTURES.artwork))
  const [artist] = await db.select({ id: artists.id }).from(artists).where(eq(artists.slug, E2E_FIXTURES.artist))

  if (artwork) {
    await deleteMediaForOwner("artwork", artwork.id)
    await db.delete(artworkPrints).where(eq(artworkPrints.artworkId, artwork.id))
    await db.delete(artworks).where(eq(artworks.id, artwork.id))
  }
  for (const id of productIds) {
    await deleteMediaForOwner("product", id)
    await db.delete(productTags).where(eq(productTags.productId, id))
    await db.delete(products).where(eq(products.id, id))
  }
  await db.delete(artworkSeries).where(eq(artworkSeries.slug, E2E_FIXTURES.series))
  if (artist) {
    await deleteMediaForOwner("artist", artist.id)
    await db.delete(artists).where(eq(artists.id, artist.id))
  }
  await db.delete(blogPosts).where(eq(blogPosts.slug, E2E_FIXTURES.post))
}

/**
 * Seed the e2e fixtures from scratch — removing the previous run's first, since
 * its rows survive a restart while its in-memory images do not.
 */
export async function seedE2eFixtures() {
  await removeE2eFixtures()

  const categoryId = await requireId(
    db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(eq(productCategories.slug, E2E_FIXTURES.category)),
    `category ${E2E_FIXTURES.category}`,
  )
  const gunArtId = await requireId(
    db.select({ id: productCategories.id }).from(productCategories).where(eq(productCategories.slug, "gun-art")),
    "category gun-art",
  )
  const legalCId = await requireId(
    db.select({ id: legalCategories.id }).from(legalCategories).where(eq(legalCategories.category, "C")),
    "legal category C",
  )
  const legalNoneId = await requireId(
    db.select({ id: legalCategories.id }).from(legalCategories).where(eq(legalCategories.category, "none")),
    "legal category none",
  )
  const tagId = await requireId(
    db.select({ id: tags.id }).from(tags).where(eq(tags.slug, E2E_FIXTURES.tag)),
    `tag ${E2E_FIXTURES.tag}`,
  )
  const themeId = await requireId(
    db.select({ id: artworkThemes.id }).from(artworkThemes).where(eq(artworkThemes.slug, E2E_FIXTURES.theme)),
    `theme ${E2E_FIXTURES.theme}`,
  )

  // Armurerie product: long name, landscape photo, filed and tagged.
  const [product] = await db
    .insert(products)
    .values({
      sku: "E2E-CARABINE",
      slug: E2E_FIXTURES.product,
      name: PRODUCT_NAME,
      description: `${PRODUCT_NAME}. Fiche de contrôle de la mise en page : nom long, mot insécable, visuel paysage.`,
      categoryId,
      legalCategoryId: legalCId,
      priceHt: "1249.17",
      stockQty: 2,
      requiresLegalVerification: true,
      ageMinRequired: 18,
      published: true,
    })
    .returning({ id: products.id })
  if (!product) throw new Error("e2e fixtures: product insert returned no row")
  await db.insert(productTags).values({ productId: product.id, tagId })
  await appendOwnerMedia("product", product.id, PRODUCT_NAME, await syntheticPhoto(1600, 1000, 25))

  // Gun Art: artist, series, then a watermarked portrait artwork with prints.
  const [artist] = await db
    .insert(artists)
    .values({
      slug: E2E_FIXTURES.artist,
      name: "Artiste de contrôle e2e",
      headline: "Photographe de l'objet mécanique",
      bio: "Biographie de contrôle de la mise en page.",
      published: true,
    })
    .returning({ id: artists.id })
  if (!artist) throw new Error("e2e fixtures: artist insert returned no row")
  await appendOwnerMedia("artist", artist.id, "Portrait de l'artiste de contrôle", await syntheticPhoto(900, 900, 200))

  const [series] = await db
    .insert(artworkSeries)
    .values({
      slug: E2E_FIXTURES.series,
      title: "Série de contrôle e2e",
      intro: "Série de contrôle de la mise en page.",
      themeId,
      artistId: artist.id,
      published: true,
    })
    .returning({ id: artworkSeries.id })
  if (!series) throw new Error("e2e fixtures: series insert returned no row")

  const basePriceHt = 180
  const priceIncrementHt = 15
  const [artProduct] = await db
    .insert(products)
    .values({
      sku: ARTWORK_SKU,
      slug: `art-${E2E_FIXTURES.artwork}`,
      name: "Œuvre de contrôle e2e",
      categoryId: gunArtId,
      legalCategoryId: legalNoneId,
      priceHt: basePriceHt.toFixed(2),
      requiresLegalVerification: false,
      published: true,
    })
    .returning({ id: products.id })
  if (!artProduct) throw new Error("e2e fixtures: artwork product insert returned no row")
  const [artwork] = await db
    .insert(artworks)
    .values({
      productId: artProduct.id,
      slug: E2E_FIXTURES.artwork,
      sku: ARTWORK_SKU,
      title: "Œuvre de contrôle e2e",
      description: "Tirage de contrôle de la mise en page.",
      artistId: artist.id,
      seriesId: series.id,
      seriesOrder: 1,
      editionLimit: EDITION_LIMIT,
      editionYear: 2026,
      availableFormats: FORMATS,
      basePriceHt: basePriceHt.toFixed(2),
      priceIncrementHt: priceIncrementHt.toFixed(2),
      vatPct: "20",
      orientation: "portrait",
      published: true,
    })
    .returning({ id: artworks.id })
  if (!artwork) throw new Error("e2e fixtures: artwork insert returned no row")
  await db.insert(artworkPrints).values(
    Array.from({ length: EDITION_LIMIT }, (_, index) => {
      const printNumber = index + 1
      const priceHt = calculateArtworkPrice(basePriceHt, priceIncrementHt, EDITION_LIMIT, printNumber, A4_FORMAT)
      return {
        artworkId: artwork.id,
        printNumber,
        totalPrints: EDITION_LIMIT,
        printDesignation: `${printNumber}/${EDITION_LIMIT}`,
        formatId: A4_FORMAT.id,
        priceHtUnit: priceHt.toFixed(2),
        status: printNumber <= SOLD_PRINTS ? ("sold" as const) : ("available" as const),
      }
    }),
  )
  await appendOwnerMedia("artwork", artwork.id, "Œuvre de contrôle e2e", await syntheticPhoto(1200, 1500, 320))

  await db.insert(blogPosts).values({
    slug: E2E_FIXTURES.post,
    title: "Article de contrôle e2e : un titre volontairement long pour éprouver la mise en page du journal",
    excerpt: "Article de contrôle de la mise en page.",
    content:
      "<p>Article de contrôle de la mise en page.</p><h2>Un intertitre</h2>" +
      "<p>Un paragraphe avec un mot insécable : Référence-Constructeur-VC-IMPACT-NT-BATTUE-CANON-56-CM.</p>",
    category: "Histoire",
    tags: "contrôle",
    metaDescription: "Article de contrôle de la mise en page.",
    published: true,
    publishedAt: new Date(),
  })
}
