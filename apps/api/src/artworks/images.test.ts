import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import FormData from "form-data"
import sharp from "sharp"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { artworks, auditLogs, legalCategories, productCategories, products, users } from "../db/schema.js"

const PASSWORD = "MotDePasseTresLong123!"
const ADMIN_EMAIL = "testartimg-admin@testartimg.local"
const CUSTOMER_EMAIL = "testartimg-cust@testartimg.local"
const SLUG = "testartimg-piece"

describe("Gun Art image protection (story 11.5)", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerToken: string
  let artworkId: string
  let png: Buffer

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "testartimg-%"))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(like(users.email, "testartimg-%"))
    await db.delete(products).where(like(products.sku, "TESTARTIMG-%"))
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

  function upload(buffer: Buffer, contentType = "image/png", token = adminToken, slug = SLUG) {
    const form = new FormData()
    form.append("file", buffer, { filename: "piece.png", contentType })
    return app.inject({
      method: "POST",
      url: `/api/admin/artworks/${slug}/image`,
      headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
      payload: form,
    })
  }

  async function featuredImageUrl(): Promise<string | null> {
    const [row] = await db
      .select({ url: artworks.featuredImageUrl })
      .from(artworks)
      .where(eq(artworks.id, artworkId))
      .limit(1)
    return row?.url ?? null
  }

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
        sku: "TESTARTIMG-1",
        slug: SLUG,
        name: "Pièce de test",
        categoryId: category.id,
        legalCategoryId: legal.id,
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
        slug: SLUG,
        sku: "TESTARTIMG-ART",
        title: "Pièce de test",
        editionLimit: 25,
        basePriceHt: "100.00",
        priceIncrementHt: "2.00",
        published: true,
      })
      .returning({ id: artworks.id })
    if (!artwork) throw new Error("Test artwork insert returned no row")
    artworkId = artwork.id

    // A 2400px source: wide enough to prove the public file gets capped.
    png = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .png()
      .toBuffer()
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("refuses anyone but an admin", async () => {
    expect((await upload(png, "image/png", customerToken)).statusCode).toBe(403)
    const anon = await app.inject({ method: "POST", url: `/api/admin/artworks/${SLUG}/image` })
    expect(anon.statusCode).toBe(401)
  })

  it("publishes a capped, watermarked derivative and points the artwork at it", async () => {
    const res = await upload(png)
    expect(res.statusCode).toBe(201)
    const { url, width } = res.json().data as { url: string; width: number }
    expect(url).toMatch(/^\/api\/artworks\/images\/[0-9a-f-]{36}\.webp$/)
    // Downscaled: the print-grade resolution never goes out.
    expect(width).toBe(1400)
    expect(await featuredImageUrl()).toBe(url)

    const served = await app.inject({ method: "GET", url })
    expect(served.statusCode).toBe(200)
    expect(served.headers["content-type"]).toContain("image/webp")
    const meta = await sharp(served.rawPayload).metadata()
    expect(meta.width).toBe(1400)

    // The source was pure black; anything brighter is watermark ink.
    const { data } = await sharp(served.rawPayload).greyscale().raw().toBuffer({ resolveWithObject: true })
    expect(data.some((value) => value > 40)).toBe(true)
  })

  it("keeps the untouched original private, reachable only by an admin", async () => {
    const url = await featuredImageUrl()
    const id = /([0-9a-f-]{36})\.webp$/.exec(url ?? "")?.[1]
    expect(id).toBeTruthy()

    // The original is NOT exposed under the public image route in any shape.
    for (const candidate of [`/api/artworks/images/${id}`, `/api/artworks/images/${id}.png`]) {
      expect((await app.inject({ method: "GET", url: candidate })).statusCode).toBe(404)
    }

    const asCustomer = await app.inject({
      method: "GET",
      url: `/api/admin/artworks/${SLUG}/image/original`,
      headers: { authorization: `Bearer ${customerToken}` },
    })
    expect(asCustomer.statusCode).toBe(403)

    const asAdmin = await app.inject({
      method: "GET",
      url: `/api/admin/artworks/${SLUG}/image/original`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(asAdmin.statusCode).toBe(200)
    expect(asAdmin.headers["content-disposition"]).toContain("attachment")
    expect(asAdmin.headers["cache-control"]).toContain("no-store")
    // Full resolution, unmarked, exactly as uploaded — that is what a print needs.
    const meta = await sharp(asAdmin.rawPayload).metadata()
    expect(meta.width).toBe(2400)
    expect(asAdmin.rawPayload.equals(png)).toBe(true)
  })

  it("replaces a visual without leaving the previous pair behind", async () => {
    const before = await featuredImageUrl()
    const res = await upload(png)
    expect(res.statusCode).toBe(201)
    const after = await featuredImageUrl()
    expect(after).not.toBe(before)

    // The superseded public file is gone from the bucket, not merely unlinked.
    expect((await app.inject({ method: "GET", url: before ?? "" })).statusCode).toBe(404)
  })

  it("records who replaced a visual and who pulled an original", async () => {
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, artworkId))
    const actions = new Set(logs.map((l) => l.action))
    expect(actions.has("artwork.image_replaced")).toBe(true)
    expect(actions.has("artwork.original_downloaded")).toBe(true)
    expect(logs.every((l) => l.userId !== null)).toBe(true)
  })

  it("rejects a non-image payload, a disallowed type and an unknown artwork", async () => {
    expect((await upload(Buffer.from("not an image"))).statusCode).toBe(400)
    expect((await upload(Buffer.from("%PDF-1.4\n"), "application/pdf")).statusCode).toBe(400)
    expect((await upload(png, "image/png", adminToken, "no-such-piece")).statusCode).toBe(404)
  })

  it("accepts an original larger than the app-wide upload limit", async () => {
    // Legal documents are capped at 10 MB; a print-grade visual must not be.
    const noisy = await sharp({
      create: {
        width: 2200,
        height: 1800,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
        noise: { type: "gaussian", mean: 128, sigma: 60 },
      },
    })
      .png({ compressionLevel: 0 })
      .toBuffer()
    expect(noisy.length).toBeGreaterThan(10 * 1024 * 1024)
    expect((await upload(noisy)).statusCode).toBe(201)
  })

  it("404s on a malformed filename and an unknown image", async () => {
    expect((await app.inject({ method: "GET", url: "/api/artworks/images/..%2f..%2fetc" })).statusCode).toBe(404)
    expect(
      (await app.inject({ method: "GET", url: "/api/artworks/images/00000000-0000-0000-0000-000000000000.webp" }))
        .statusCode,
    ).toBe(404)
  })
})
