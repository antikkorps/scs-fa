import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import FormData from "form-data"
import sharp from "sharp"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import {
  artists,
  artworkPrints,
  artworks,
  auditLogs,
  legalCategories,
  media,
  productCategories,
  products,
  users,
} from "../db/schema.js"

const PASSWORD = "MotDePasseTresLong123!"
const ADMIN_EMAIL = "testmedia-admin@testmedia.local"
const CUSTOMER_EMAIL = "testmedia-cust@testmedia.local"
const PREFIX = "TESTMEDIA-"
const BASE = "/api/admin/media"

describe("catalogue media gallery (story 7.5b)", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerToken: string
  let productId: string
  let artworkId: string
  let artistId: string
  let png: Buffer
  let tiny: Buffer

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "testmedia-%"))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(like(users.email, "testmedia-%"))
    const artIds = db
      .select({ id: artworks.id })
      .from(artworks)
      .where(like(artworks.sku, `${PREFIX}%`))
    await db.delete(artworkPrints).where(inArray(artworkPrints.artworkId, artIds))
    await db.delete(products).where(like(products.sku, `%${PREFIX}%`))
    await db.delete(artists).where(like(artists.slug, "testmedia-%"))
  }

  async function makeUser(email: string, role: "customer" | "admin") {
    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    await db.insert(users).values({
      email,
      passwordHash,
      role,
      firstname: "Test",
      lastname: role === "admin" ? "Admin" : "Client",
      rgpdConsentAt: new Date(),
      rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
    })
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })
    return login.json().accessToken as string
  }

  function upload(opts: {
    buffer?: Buffer
    ownerType?: string
    ownerId?: string
    alt?: string | null
    contentType?: string
    token?: string
  }) {
    const form = new FormData()
    form.append("file", opts.buffer ?? png, { filename: "x.png", contentType: opts.contentType ?? "image/png" })
    if (opts.ownerType) form.append("ownerType", opts.ownerType)
    if (opts.ownerId) form.append("ownerId", opts.ownerId)
    if (opts.alt !== null) form.append("alt", opts.alt ?? "Texte alternatif")
    return app.inject({
      method: "POST",
      url: BASE,
      headers: { authorization: `Bearer ${opts.token ?? adminToken}`, ...form.getHeaders() },
      payload: form,
    })
  }

  const asAdmin = (method: "GET" | "PATCH" | "DELETE", url: string, body?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${adminToken}` }, ...(body ? { payload: body } : {}) })

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
    adminToken = await makeUser(ADMIN_EMAIL, "admin")
    customerToken = await makeUser(CUSTOMER_EMAIL, "customer")

    const [category] = await db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(eq(productCategories.slug, "gun-art"))
      .limit(1)
    const [legal] = await db
      .select({ id: legalCategories.id })
      .from(legalCategories)
      .where(eq(legalCategories.category, "none"))
      .limit(1)
    if (!category || !legal) throw new Error("Missing seeded reference data (run db:seed)")

    const [product] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}PROD`,
        slug: `${PREFIX.toLowerCase()}prod`,
        name: "Produit de test",
        categoryId: category.id,
        legalCategoryId: legal.id,
        priceHt: "100.00",
        requiresLegalVerification: false,
        published: true,
      })
      .returning({ id: products.id })
    if (!product) throw new Error("Product insert returned no row")
    productId = product.id

    const [artProduct] = await db
      .insert(products)
      .values({
        sku: `ART-${PREFIX}ART`,
        slug: `art-${PREFIX.toLowerCase()}art`,
        name: "Œuvre de test",
        categoryId: category.id,
        legalCategoryId: legal.id,
        priceHt: "100.00",
        requiresLegalVerification: false,
        published: true,
      })
      .returning({ id: products.id })
    if (!artProduct) throw new Error("Artwork product insert returned no row")

    const [artwork] = await db
      .insert(artworks)
      .values({
        productId: artProduct.id,
        slug: `${PREFIX.toLowerCase()}art`,
        sku: `${PREFIX}ART`,
        title: "Œuvre de test",
        editionLimit: 5,
        basePriceHt: "100.00",
        priceIncrementHt: "2.00",
        published: true,
      })
      .returning({ id: artworks.id })
    if (!artwork) throw new Error("Artwork insert returned no row")
    artworkId = artwork.id

    const [artist] = await db
      .insert(artists)
      .values({ slug: "testmedia-artiste", name: "Artiste de test", published: true })
      .returning({ id: artists.id })
    if (!artist) throw new Error("Artist insert returned no row")
    artistId = artist.id

    // 2400px wide: proves the renditions are downscales, never upscales.
    png = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 30, g: 30, b: 40 } } })
      .png()
      .toBuffer()
    // Smaller than the smallest rendition: it must not be blown up.
    tiny = await sharp({ create: { width: 120, height: 90, channels: 3, background: { r: 200, g: 40, b: 40 } } })
      .png()
      .toBuffer()
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("refuses anyone but an admin", async () => {
    expect(
      (await app.inject({ method: "GET", url: `${BASE}?ownerType=product&ownerId=${productId}` })).statusCode,
    ).toBe(401)
    expect((await upload({ ownerType: "product", ownerId: productId, token: customerToken })).statusCode).toBe(403)
  })

  it("pre-generates the widths and reports what the file actually has", async () => {
    const res = await upload({ ownerType: "product", ownerId: productId })
    expect(res.statusCode).toBe(201)
    const data = res.json().data
    expect(data.widths).toEqual([400, 800, 1400])
    expect(data.watermarked).toBe(false)
    expect(data.srcset).toContain("400w")
    expect(data.srcset).toContain("1400w")

    // Every rendition is really there.
    for (const w of data.widths) {
      const img = await app.inject({ method: "GET", url: `/api/media/${data.id}/${w}.webp` })
      expect(img.statusCode).toBe(200)
      expect(img.headers["content-type"]).toBe("image/webp")
      expect(img.headers["cache-control"]).toContain("immutable")
    }
  })

  it("never upscales a small image", async () => {
    const res = await upload({ ownerType: "product", ownerId: productId, buffer: tiny })
    expect(res.statusCode).toBe(201)
    const data = res.json().data
    // 120px source: no 400/800/1400 rendition, one rendition at its own size.
    expect(data.widths).toEqual([120])
    expect(data.width).toBe(120)
  })

  /**
   * ⚠️ The gallery must not be a hole through story 11.5. A Gun Art visual
   * served plainly here would undo the only protection that survives a
   * screenshot.
   */
  it("watermarks and caps a Gun Art visual, and keeps the original private", async () => {
    const res = await upload({ ownerType: "artwork", ownerId: artworkId })
    expect(res.statusCode).toBe(201)
    const data = res.json().data
    expect(data.watermarked).toBe(true)

    // Ink is really laid down: a flat background would have ~0 spread.
    const bytes = (await app.inject({ method: "GET", url: `/api/media/${data.id}/800.webp` })).rawPayload
    const stats = await sharp(bytes).stats()
    expect(Math.max(...stats.channels.map((c) => c.stdev))).toBeGreaterThan(1)

    // The print-grade original never travels over a public route.
    expect((await app.inject({ method: "GET", url: `/api/media/${data.id}/original` })).statusCode).toBe(404)
    const admin = await asAdmin("GET", `${BASE}/${data.id}/original`)
    expect(admin.statusCode).toBe(200)
    expect(admin.headers["cache-control"]).toBe("no-store")
  })

  it("stores no original for an ordinary product photo", async () => {
    const gallery = (await asAdmin("GET", `${BASE}?ownerType=product&ownerId=${productId}`)).json().data
    const first = gallery[0]
    expect((await asAdmin("GET", `${BASE}/${first.id}/original`)).statusCode).toBe(404)
  })

  it("demands alternative text — a gallery without it is unusable", async () => {
    const res = await upload({ ownerType: "product", ownerId: productId, alt: null })
    expect(res.statusCode).toBe(400)
  })

  it("rejects a file that is not really an image", async () => {
    const res = await upload({ ownerType: "product", ownerId: productId, buffer: Buffer.from("pas une image") })
    expect(res.statusCode).toBe(400)
  })

  /** No foreign key can vouch for a polymorphic owner id. */
  it("refuses an owner that does not exist", async () => {
    const res = await upload({ ownerType: "product", ownerId: "00000000-0000-4000-8000-000000000000" })
    expect(res.statusCode).toBe(404)
  })

  it("appends to the gallery so an upload never silently changes the main visual", async () => {
    const before = (await asAdmin("GET", `${BASE}?ownerType=artist&ownerId=${artistId}`)).json().data
    expect(before).toHaveLength(0)

    const first = (await upload({ ownerType: "artist", ownerId: artistId, alt: "Portrait 1" })).json().data
    const second = (await upload({ ownerType: "artist", ownerId: artistId, alt: "Portrait 2" })).json().data
    expect(first.position).toBe(0)
    expect(second.position).toBe(1)

    // The owner's own column follows position 0, written by the server.
    const [artist] = await db
      .select({ url: artists.portraitUrl })
      .from(artists)
      .where(eq(artists.id, artistId))
      .limit(1)
    expect(artist?.url).toBe(first.url)
  })

  it("moves the main visual when the gallery is reordered", async () => {
    const gallery = (await asAdmin("GET", `${BASE}?ownerType=artist&ownerId=${artistId}`)).json().data
    const reversed = [...gallery].reverse().map((m: { id: string }) => m.id)

    const res = await asAdmin("PATCH", `${BASE}/reorder`, {
      ownerType: "artist",
      ownerId: artistId,
      ids: reversed,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.map((m: { id: string }) => m.id)).toEqual(reversed)

    const [artist] = await db
      .select({ url: artists.portraitUrl })
      .from(artists)
      .where(eq(artists.id, artistId))
      .limit(1)
    expect(artist?.url).toBe(gallery[1].url)
  })

  it("refuses a partial reorder rather than half-sorting the gallery", async () => {
    const gallery = (await asAdmin("GET", `${BASE}?ownerType=artist&ownerId=${artistId}`)).json().data
    const res = await asAdmin("PATCH", `${BASE}/reorder`, {
      ownerType: "artist",
      ownerId: artistId,
      ids: [gallery[0].id],
    })
    expect(res.statusCode).toBe(400)
  })

  it("edits the alternative text", async () => {
    const gallery = (await asAdmin("GET", `${BASE}?ownerType=artist&ownerId=${artistId}`)).json().data
    const res = await asAdmin("PATCH", `${BASE}/${gallery[0].id}`, { alt: "Nouveau texte" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.alt).toBe("Nouveau texte")
  })

  it("closes the gap on delete, so position 0 keeps meaning something", async () => {
    const gallery = (await asAdmin("GET", `${BASE}?ownerType=artist&ownerId=${artistId}`)).json().data
    const removed = gallery[0]

    expect((await asAdmin("DELETE", `${BASE}/${removed.id}`)).statusCode).toBe(204)
    // The bytes are gone too, not just the row.
    expect((await app.inject({ method: "GET", url: `/api/media/${removed.id}/400.webp` })).statusCode).toBe(404)

    const after = (await asAdmin("GET", `${BASE}?ownerType=artist&ownerId=${artistId}`)).json().data
    expect(after).toHaveLength(1)
    expect(after[0].position).toBe(0)

    const [artist] = await db
      .select({ url: artists.portraitUrl })
      .from(artists)
      .where(eq(artists.id, artistId))
      .limit(1)
    expect(artist?.url).toBe(after[0].url)
  })

  it("clears the owner's visual when the last image goes", async () => {
    const gallery = (await asAdmin("GET", `${BASE}?ownerType=artist&ownerId=${artistId}`)).json().data
    await asAdmin("DELETE", `${BASE}/${gallery[0].id}`)

    const [artist] = await db
      .select({ url: artists.portraitUrl })
      .from(artists)
      .where(eq(artists.id, artistId))
      .limit(1)
    expect(artist?.url).toBeNull()
  })

  /**
   * ⚠️ The price of the polymorphic table: no foreign key removes these rows.
   * Without the explicit cleanup, every deleted product would leave its files in
   * the bucket and its rows in the table, forever.
   */
  it("takes the gallery with it when the owner is deleted", async () => {
    const uploaded = (await upload({ ownerType: "product", ownerId: productId, alt: "À supprimer" })).json().data

    const del = await asAdmin("DELETE", `/api/admin/products/${productId}`)
    expect(del.statusCode).toBe(204)

    expect(await db.select().from(media).where(eq(media.ownerId, productId))).toHaveLength(0)
    expect((await app.inject({ method: "GET", url: `/api/media/${uploaded.id}/400.webp` })).statusCode).toBe(404)
  })

  it("rejects a traversal attempt on the public route", async () => {
    const res = await app.inject({ method: "GET", url: "/api/media/..%2f..%2fetc/800.webp" })
    expect(res.statusCode).toBe(404)
    expect((await app.inject({ method: "GET", url: `/api/media/${artworkId}/abc.webp` })).statusCode).toBe(404)
  })
})
