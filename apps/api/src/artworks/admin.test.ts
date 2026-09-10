import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { artworkPrints, artworks, auditLogs, products, users } from "../db/schema.js"

const PASSWORD = "MotDePasseTresLong123!"
const ADMIN_EMAIL = "testartadmin-admin@testartadmin.local"
const CUSTOMER_EMAIL = "testartadmin-cust@testartadmin.local"
const SLUG = "testartadmin-piece"
const SKU = "TESTARTADMIN-1"
const BASE = "/api/admin/artworks"

const SMALL = { id: "s", name: "Petit", widthCm: 40, heightCm: 50, priceFactor: 1 }
const MEDIUM_TIGHT = { id: "m", name: "Moyen", widthCm: 60, heightCm: 80, priceFactor: 1.5 }
const MEDIUM_WIDE = { id: "m", name: "Moyen", widthCm: 60, heightCm: 80, priceFactor: 2 }

// base 50, increment 2, 25 prints: SMALL tops out at 98 while MEDIUM_TIGHT
// starts at 75 — the very grid story 11.7 refuses.
const payload = (overrides: Record<string, unknown> = {}) => ({
  sku: SKU,
  slug: SLUG,
  title: "Pièce de test",
  editionLimit: 25,
  basePriceHt: 50,
  priceIncrementHt: 2,
  availableFormats: [SMALL, MEDIUM_WIDE],
  published: true,
  ...overrides,
})

describe("admin artwork CRUD (story 7.5a)", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerToken: string

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "testartadmin-%"))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(like(users.email, "testartadmin-%"))
    await db.delete(products).where(like(products.sku, "%TESTARTADMIN-%"))
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

  const asAdmin = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${adminToken}` }, ...(body ? { payload: body } : {}) })

  async function createArtwork(overrides: Record<string, unknown> = {}) {
    const res = await asAdmin("POST", BASE, payload(overrides))
    expect(res.statusCode).toBe(201)
    return res.json().data
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
    adminToken = await makeUser(ADMIN_EMAIL, "admin")
    customerToken = await makeUser(CUSTOMER_EMAIL, "customer")
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("refuses anyone but an admin", async () => {
    expect((await app.inject({ method: "GET", url: BASE })).statusCode).toBe(401)
    const asCustomer = await app.inject({
      method: "GET",
      url: BASE,
      headers: { authorization: `Bearer ${customerToken}` },
    })
    expect(asCustomer.statusCode).toBe(403)
  })

  /**
   * Story 11.7's guard rail, finally applied where an artwork is saved — the
   * point the story itself had to leave open for want of a form.
   */
  it("refuses a grid where a small format out-prices a bigger one, and says how to fix it", async () => {
    const res = await asAdmin("POST", BASE, payload({ availableFormats: [SMALL, MEDIUM_TIGHT] }))
    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.message).toContain("out-price")
    expect(body.issues[0].message).toContain("Incrément ≤")
    expect(body.issues[0].message).toContain("facteur de")
    // Nothing was written on the way out.
    const [row] = await db.select({ id: artworks.id }).from(artworks).where(eq(artworks.slug, SLUG)).limit(1)
    expect(row).toBeUndefined()
  })

  it("creates the artwork, its backing product and the whole numbered edition", async () => {
    const data = await createArtwork()
    expect(data.prints).toHaveLength(25)
    expect(data.prints[0]).toMatchObject({ printNumber: 1, printDesignation: "1/25", formatId: "s", priceHt: 98 })
    expect(data.prints[24]).toMatchObject({ printNumber: 25, priceHt: 50 })

    // The cart and the order tunnel key on the product: without one the piece
    // could never be bought.
    const [product] = await db.select().from(products).where(eq(products.id, data.productId)).limit(1)
    expect(product?.sku).toBe(`ART-${SKU}`)
    expect(product?.published).toBe(true)

    // …and it is immediately visible on the public route.
    const pub = await app.inject({ method: "GET", url: `/api/artworks/${SLUG}` })
    expect(pub.statusCode).toBe(200)
    expect(pub.json().data.prints).toHaveLength(25)
  })

  it("refuses a duplicate SKU or slug", async () => {
    expect((await asAdmin("POST", BASE, payload())).statusCode).toBe(409)
  })

  it("validates the grid AFTER the patch, not the fields the patch carries", async () => {
    const [row] = await db.select({ id: artworks.id }).from(artworks).where(eq(artworks.slug, SLUG)).limit(1)
    // The factors are untouched here — only the increment moves, and that alone
    // is enough to make the small format overtake the medium one.
    const res = await asAdmin("PATCH", `${BASE}/${row?.id}`, { priceIncrementHt: 5 })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain("out-price")
  })

  it("re-prices the prints still on the shelf, and only those", async () => {
    const [row] = await db.select({ id: artworks.id }).from(artworks).where(eq(artworks.slug, SLUG)).limit(1)
    const artworkId = row?.id as string

    // Print 1 is sold at its original price; print 2 stays available.
    const before = (await asAdmin("GET", `${BASE}/${artworkId}`)).json().data
    const sold = before.prints[0]
    await db.update(artworkPrints).set({ status: "sold" }).where(eq(artworkPrints.id, sold.id))

    const res = await asAdmin("PATCH", `${BASE}/${artworkId}`, { basePriceHt: 60 })
    expect(res.statusCode).toBe(200)
    const after = res.json().data

    // A sold print keeps what the buyer was promised.
    expect(after.prints[0].priceHt).toBe(98)
    // An available one follows the new base price: 60 + 2 × (25 − 2) = 106.
    expect(after.prints[1].priceHt).toBe(106)

    await db.update(artworkPrints).set({ status: "available" }).where(eq(artworkPrints.id, sold.id))
  })

  it("moves an available print to another format, re-pricing it", async () => {
    const [row] = await db.select({ id: artworks.id }).from(artworks).where(eq(artworks.slug, SLUG)).limit(1)
    const artworkId = row?.id as string
    const before = (await asAdmin("GET", `${BASE}/${artworkId}`)).json().data
    const print = before.prints[4] // 5/25

    const res = await asAdmin("PATCH", `${BASE}/${artworkId}/prints/${print.id}`, { formatId: "m" })
    expect(res.statusCode).toBe(200)
    const moved = res.json().data.prints.find((p: { id: string }) => p.id === print.id)
    // base 60 × 2 + 2 × (25 − 5) = 160
    expect(moved).toMatchObject({ formatId: "m", priceHt: 160 })
  })

  it("refuses to re-format a print that is already spoken for", async () => {
    const [row] = await db.select({ id: artworks.id }).from(artworks).where(eq(artworks.slug, SLUG)).limit(1)
    const artworkId = row?.id as string
    const before = (await asAdmin("GET", `${BASE}/${artworkId}`)).json().data
    const print = before.prints[9]

    await db.update(artworkPrints).set({ status: "reserved" }).where(eq(artworkPrints.id, print.id))
    const res = await asAdmin("PATCH", `${BASE}/${artworkId}/prints/${print.id}`, { formatId: "m" })
    expect(res.statusCode).toBe(409)
    await db.update(artworkPrints).set({ status: "available" }).where(eq(artworkPrints.id, print.id))
  })

  it("refuses an unknown format", async () => {
    const [row] = await db.select({ id: artworks.id }).from(artworks).where(eq(artworks.slug, SLUG)).limit(1)
    const before = (await asAdmin("GET", `${BASE}/${row?.id}`)).json().data
    const res = await asAdmin("PATCH", `${BASE}/${row?.id}/prints/${before.prints[0].id}`, { formatId: "xxl" })
    expect(res.statusCode).toBe(400)
  })

  it("refuses to delete an edition that has been sold into, and offers the alternative", async () => {
    const [row] = await db.select({ id: artworks.id }).from(artworks).where(eq(artworks.slug, SLUG)).limit(1)
    const artworkId = row?.id as string
    const before = (await asAdmin("GET", `${BASE}/${artworkId}`)).json().data
    await db.update(artworkPrints).set({ status: "sold" }).where(eq(artworkPrints.id, before.prints[0].id))

    const res = await asAdmin("DELETE", `${BASE}/${artworkId}`)
    expect(res.statusCode).toBe(409)
    expect(res.json().message).toContain("unpublish")

    await db.update(artworkPrints).set({ status: "available" }).where(eq(artworkPrints.id, before.prints[0].id))
  })

  it("deletes an untouched edition, product and prints included", async () => {
    const [row] = await db
      .select({ id: artworks.id, productId: artworks.productId })
      .from(artworks)
      .where(eq(artworks.slug, SLUG))
      .limit(1)
    const artworkId = row?.id as string

    expect((await asAdmin("DELETE", `${BASE}/${artworkId}`)).statusCode).toBe(204)
    expect(await db.select().from(artworks).where(eq(artworks.id, artworkId))).toHaveLength(0)
    expect(await db.select().from(artworkPrints).where(eq(artworkPrints.artworkId, artworkId))).toHaveLength(0)
    expect(
      await db
        .select()
        .from(products)
        .where(eq(products.id, row?.productId as string)),
    ).toHaveLength(0)
  })
})
