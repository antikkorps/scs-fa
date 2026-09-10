import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import {
  artworkPrints,
  artworks,
  auditLogs,
  legalCategories,
  productCategories,
  products,
  users,
} from "../db/schema.js"

const PASSWORD = "MotDePasseTresLong123!"
const ADMIN_EMAIL = "testartprice-admin@testartprice.local"
const CUSTOMER_EMAIL = "testartprice-cust@testartprice.local"
const SLUG = "testartprice-piece"
const URL = "/api/admin/artworks/price-grid"

// The grid the backlog calls out as breaking the client rule: with base 50EUR,
// increment 2EUR and 25 prints, small 1/25 (98EUR) out-prices medium 25/25 (75EUR).
const BROKEN_GRID = {
  basePriceHt: 50,
  priceIncrementHt: 2,
  editionLimit: 25,
  formats: [
    { id: "s", name: "40x50", widthCm: 40, heightCm: 50, priceFactor: 1 },
    { id: "m", name: "60x80", widthCm: 60, heightCm: 80, priceFactor: 1.5 },
    { id: "l", name: "100x100", widthCm: 100, heightCm: 100, priceFactor: 2 },
  ],
}

describe("Gun Art price coherence (story 11.7)", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerToken: string
  let artworkId: string

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "testartprice-%"))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(like(users.email, "testartprice-%"))
    await db.delete(products).where(like(products.sku, "TESTARTPRICE-%"))
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

  function simulate(payload: Record<string, unknown>, token = adminToken) {
    return app.inject({ method: "POST", url: URL, headers: { authorization: `Bearer ${token}` }, payload })
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
        sku: "TESTARTPRICE-1",
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
        sku: "TESTARTPRICE-ART",
        title: "Pièce de test",
        editionLimit: 25,
        basePriceHt: "50.00",
        priceIncrementHt: "2.00",
        published: true,
      })
      .returning({ id: artworks.id })
    if (!artwork) throw new Error("Test artwork insert returned no row")
    artworkId = artwork.id
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("refuses anyone but an admin", async () => {
    expect((await simulate(BROKEN_GRID, customerToken)).statusCode).toBe(403)
    const anon = await app.inject({ method: "POST", url: URL, payload: BROKEN_GRID })
    expect(anon.statusCode).toBe(401)
  })

  it("reports the backlog grid as invalid, naming the crossing formats", async () => {
    const res = await simulate(BROKEN_GRID)
    expect(res.statusCode).toBe(200)
    const grid = res.json().data
    expect(grid.valid).toBe(false)
    expect(grid.overlaps).toHaveLength(2)
    expect(grid.overlaps[0]).toMatchObject({
      lowerFormatId: "s",
      upperFormatId: "m",
      lowerMaxPriceHt: 98,
      upperMinPriceHt: 75,
    })
  })

  it("returns the full editionLimit x formats table with the crossing cells flagged", async () => {
    const grid = (await simulate(BROKEN_GRID)).json().data
    expect(grid.bands.map((b: { formatId: string }) => b.formatId)).toEqual(["s", "m", "l"])
    expect(grid.rows).toHaveLength(25)
    expect(grid.rows[0].cells[0]).toMatchObject({ formatId: "s", priceHt: 98, priceTtc: 117.6, overlapping: true })
    expect(grid.rows[24].cells[0]).toMatchObject({ priceHt: 50, overlapping: false })
  })

  it("accepts a grid whose formats are spread far enough apart", async () => {
    const res = await simulate({
      ...BROKEN_GRID,
      formats: [
        { id: "s", name: "40x50", priceFactor: 1 },
        { id: "m", name: "60x80", priceFactor: 2 },
        { id: "l", name: "100x100", priceFactor: 3 },
      ],
    })
    const grid = res.json().data
    expect(grid.valid).toBe(true)
    expect(grid.overlaps).toEqual([])
    expect(grid.rows.every((r: { cells: { overlapping: boolean }[] }) => r.cells.every((c) => !c.overlapping))).toBe(
      true,
    )
  })

  it("rejects a malformed grid rather than simulating it", async () => {
    expect((await simulate({ ...BROKEN_GRID, formats: [] })).statusCode).toBe(400)
    expect((await simulate({ ...BROKEN_GRID, editionLimit: 0 })).statusCode).toBe(400)
    expect((await simulate({ ...BROKEN_GRID, basePriceHt: -1 })).statusCode).toBe(400)
    // Two formats sharing an id would make the returned cells ambiguous.
    const dupes = await simulate({
      ...BROKEN_GRID,
      formats: [
        { id: "s", name: "A", priceFactor: 1 },
        { id: "s", name: "B", priceFactor: 2 },
      ],
    })
    expect(dupes.statusCode).toBe(400)
    // An editionLimit x formats table has to stay bounded: it sizes the response.
    expect((await simulate({ ...BROKEN_GRID, editionLimit: 5000 })).statusCode).toBe(400)
  })

  /**
   * The backlog asks for this to be locked down explicitly: the edition is 25
   * prints *all formats taken together*, not 25 per format. The guarantee is the
   * `uniq_print_per_artwork` unique index on (artwork_id, print_number) — hence a
   * number already taken in one format cannot be reused in another.
   */
  it("numbers prints once per artwork, formats confounded", async () => {
    await db.insert(artworkPrints).values({
      artworkId,
      printNumber: 7,
      totalPrints: 25,
      printDesignation: "7/25",
      formatId: "s",
      priceHtUnit: "86.00",
    })

    await expect(
      db.insert(artworkPrints).values({
        artworkId,
        printNumber: 7,
        totalPrints: 25,
        printDesignation: "7/25",
        formatId: "l", // a different format does NOT open a second number 7
        priceHtUnit: "136.00",
      }),
    ).rejects.toThrow()

    const rows = await db.select().from(artworkPrints).where(eq(artworkPrints.artworkId, artworkId))
    expect(rows).toHaveLength(1)
  })
})
