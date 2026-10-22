import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { releaseLapsedPrintHolds } from "../artworks/reservation.js"
import { db } from "../db/client.js"
import {
  artworkCartItems,
  artworkPrints,
  artworks,
  auditLogs,
  cartItems,
  productCategories,
  products,
  productVariants,
  users,
} from "../db/schema.js"
import { pinShippingRates } from "../test/shipping-rates.js"

const PREFIX = "TEST31-"
const PLAINTEXT_PASSWORD = "MotDePasseTresLong123!"
const TEST_EMAIL = "cart-test31@cart-test.local"

async function categoryId(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(eq(productCategories.slug, slug))
    .limit(1)
  if (!row) throw new Error(`Missing seeded product category: ${slug} (run db:seed)`)
  return row.id
}

// Delete the test fixtures children-first (the live DB has no ON DELETE CASCADE here)
async function cleanup() {
  const testArtworkIds = db
    .select({ id: artworks.id })
    .from(artworks)
    .where(like(artworks.sku, `${PREFIX}%`))
  const testVariantIds = db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(like(productVariants.skuVariant, `${PREFIX}%`))
  const testPrintIds = db
    .select({ id: artworkPrints.id })
    .from(artworkPrints)
    .where(inArray(artworkPrints.artworkId, testArtworkIds))

  await db.delete(artworkCartItems).where(inArray(artworkCartItems.printId, testPrintIds))
  await db.delete(cartItems).where(inArray(cartItems.variantId, testVariantIds))
  await db.delete(artworkPrints).where(inArray(artworkPrints.artworkId, testArtworkIds))
  await db.delete(artworks).where(like(artworks.sku, `${PREFIX}%`))
  await db.delete(productVariants).where(like(productVariants.skuVariant, `${PREFIX}%`))
  await db.delete(products).where(like(products.sku, `${PREFIX}%`))

  const testUserIds = db.select({ id: users.id }).from(users).where(like(users.email, TEST_EMAIL))
  await db.delete(auditLogs).where(inArray(auditLogs.userId, testUserIds))
  await db.delete(users).where(like(users.email, TEST_EMAIL))
}

describe("cart (/api/cart)", () => {
  let app: FastifyInstance
  let userId: string
  let token: string
  let variantId: string
  let unpublishedVariantId: string
  let availablePrintId: string
  let soldPrintId: string

  async function authHeaders() {
    return { authorization: `Bearer ${token}` }
  }

  let restoreShippingRates: () => Promise<void>

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    restoreShippingRates = await pinShippingRates()

    // Clean any leftovers from a previous run
    await cleanup()

    const passwordHash = await hash(PLAINTEXT_PASSWORD, {
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    })
    const [user] = await db
      .insert(users)
      .values({
        email: TEST_EMAIL,
        passwordHash,
        role: "customer",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    userId = user.id

    const armePoing = await categoryId("arme-poing")
    const gunArt = await categoryId("gun-art")

    // Published product + variant (stock 5, +50€ delta)
    const [published] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}pub`,
        slug: `${PREFIX}pub`,
        name: "Pistolet Panier",
        categoryId: armePoing,
        priceHt: "800.00",
        requiresLegalVerification: true,
        published: true,
      })
      .returning({ id: products.id })
    const [variant] = await db
      .insert(productVariants)
      .values({
        productId: published.id,
        skuVariant: `${PREFIX}pub-v1`,
        finition: "Inox",
        stockQty: 5,
        priceDeltaHt: "50.00",
      })
      .returning({ id: productVariants.id })
    variantId = variant.id

    // Unpublished product + variant (must not be addable)
    const [unpublished] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}unpub`,
        slug: `${PREFIX}unpub`,
        name: "Produit Caché",
        categoryId: armePoing,
        priceHt: "100.00",
        requiresLegalVerification: false,
        published: false,
      })
      .returning({ id: products.id })
    const [unpubVariant] = await db
      .insert(productVariants)
      .values({
        productId: unpublished.id,
        skuVariant: `${PREFIX}unpub-v1`,
        couleur: "Noir",
        stockQty: 5,
      })
      .returning({ id: productVariants.id })
    unpublishedVariantId = unpubVariant.id

    // Gun Art product + artwork + prints
    const [artProduct] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}art`,
        slug: `${PREFIX}art`,
        name: "Oeuvre Gun Art",
        categoryId: gunArt,
        priceHt: "100.00",
        requiresLegalVerification: false,
        published: true,
      })
      .returning({ id: products.id })
    const [artwork] = await db
      .insert(artworks)
      .values({
        productId: artProduct.id,
        slug: `${PREFIX}artwork`,
        sku: `${PREFIX}artwork`,
        title: "Tirage Limité Test",
        editionLimit: 25,
        basePriceHt: "50.00",
        priceIncrementHt: "2.00",
      })
      .returning({ id: artworks.id })
    const insertedPrints = await db
      .insert(artworkPrints)
      .values([
        {
          artworkId: artwork.id,
          printNumber: 1,
          totalPrints: 25,
          printDesignation: "1/25",
          formatId: "A4",
          priceHtUnit: "100.00",
          status: "available",
        },
        {
          artworkId: artwork.id,
          printNumber: 2,
          totalPrints: 25,
          printDesignation: "2/25",
          formatId: "A4",
          priceHtUnit: "100.00",
          status: "sold",
        },
      ])
      .returning({ id: artworkPrints.id, printNumber: artworkPrints.printNumber })
    availablePrintId = insertedPrints.find((p) => p.printNumber === 1)?.id ?? ""
    soldPrintId = insertedPrints.find((p) => p.printNumber === 2)?.id ?? ""

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: TEST_EMAIL, password: PLAINTEXT_PASSWORD },
    })
    token = login.json().accessToken
  })

  afterAll(async () => {
    await restoreShippingRates()
    await cleanup()
    await app.close()
  })

  beforeEach(async () => {
    await db.delete(cartItems).where(eq(cartItems.userId, userId))
    await db.delete(artworkCartItems).where(eq(artworkCartItems.userId, userId))
    // Adding a print now reserves it (available -> in_cart); reset the fixtures
    // so each test starts from a known print status.
    await db
      .update(artworkPrints)
      .set({ status: "available", orderId: null })
      .where(eq(artworkPrints.id, availablePrintId))
    await db.update(artworkPrints).set({ status: "sold", orderId: null }).where(eq(artworkPrints.id, soldPrintId))
  })

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/cart" })
    expect(res.statusCode).toBe(401)
  })

  it("returns an empty cart", async () => {
    const res = await app.inject({ method: "GET", url: "/api/cart", headers: await authHeaders() })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.items).toEqual([])
    expect(data.artworkItems).toEqual([])
    expect(data.summary).toMatchObject({ itemCount: 0, subtotalHt: 0, totalTtc: 0 })
  })

  it("adds a product variant and snapshots the delta-adjusted price", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: await authHeaders(),
      payload: { variantId, qty: 2 },
    })
    expect(res.statusCode).toBe(201)
    const { data } = res.json()
    expect(data.items).toHaveLength(1)
    expect(data.items[0]).toMatchObject({ variantId, qty: 2, unitPriceHt: 850 })
    // 850 * 2 = 1700 HT, TTC 20% = 2040
    expect(data.items[0].lineHt).toBe(1700)
    expect(data.items[0].lineTtc).toBe(2040)
    // + delivery (story 12.3): two handguns, one parcel each at 25 TTC — VAT 8.33 of it.
    expect(data.summary).toMatchObject({ itemCount: 2, subtotalHt: 1700, vatAmount: 348.33, totalTtc: 2090 })
    expect(data.summary.shipping).toMatchObject({
      totalTtc: 50,
      totalHt: 41.67,
      breakdown: [{ shippingClass: "firearm", units: 2, amountTtc: 50 }],
    })
  })

  it("computes the VAT by rate over the whole cart, the way the invoice does (story 12.6)", async () => {
    const [cheap] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}cheap`,
        slug: `${PREFIX}cheap`,
        name: "Pastille",
        categoryId: await categoryId("accessoire-tireur"),
        priceHt: "0.33",
        requiresLegalVerification: false,
        published: true,
      })
      .returning({ id: products.id })
    const cheapVariants = await db
      .insert(productVariants)
      .values([
        { productId: cheap.id, skuVariant: `${PREFIX}cheap-red`, couleur: "Rouge", stockQty: 5 },
        { productId: cheap.id, skuVariant: `${PREFIX}cheap-blue`, couleur: "Bleu", stockQty: 5 },
      ])
      .returning({ id: productVariants.id })
    for (const cheapVariant of cheapVariants) {
      await app.inject({
        method: "POST",
        url: "/api/cart/items",
        headers: await authHeaders(),
        payload: { variantId: cheapVariant.id, qty: 1 },
      })
    }

    const { data } = (await app.inject({ method: "GET", url: "/api/cart", headers: await authHeaders() })).json()
    // Each line shows 0.40 TTC, but 0.66 HT of goods + 7.50 HT of small parcel
    // = 8.16 HT at 20 % → 1.63 VAT (1.632), so 9.79 — not 0.40 + 0.40 + 9.00.
    expect(data.items.map((line: { lineTtc: number }) => line.lineTtc)).toEqual([0.4, 0.4])
    expect(data.summary).toMatchObject({ subtotalHt: 0.66, vatAmount: 1.63, totalTtc: 9.79 })
  })

  it("increments quantity when the same variant is added twice", async () => {
    await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: await authHeaders(),
      payload: { variantId, qty: 1 },
    })
    const res = await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: await authHeaders(),
      payload: { variantId, qty: 2 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.items[0].qty).toBe(3)
  })

  it("rejects adding more than the available stock", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: await authHeaders(),
      payload: { variantId, qty: 6 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("InsufficientStock")
  })

  it("returns 404 when adding an unpublished product variant", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: await authHeaders(),
      payload: { variantId: unpublishedVariantId, qty: 1 },
    })
    expect(res.statusCode).toBe(404)
  })

  it("returns 400 when neither variantId nor printId is provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: await authHeaders(),
      payload: { qty: 1 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("ValidationError")
  })

  it("updates the quantity of a cart line", async () => {
    const add = await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: await authHeaders(),
      payload: { variantId, qty: 1 },
    })
    const itemId = add.json().data.items[0].id
    const res = await app.inject({
      method: "PATCH",
      url: `/api/cart/items/${itemId}`,
      headers: await authHeaders(),
      payload: { qty: 4 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.items[0].qty).toBe(4)
  })

  it("rejects a quantity update beyond stock", async () => {
    const add = await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: await authHeaders(),
      payload: { variantId, qty: 1 },
    })
    const itemId = add.json().data.items[0].id
    const res = await app.inject({
      method: "PATCH",
      url: `/api/cart/items/${itemId}`,
      headers: await authHeaders(),
      payload: { qty: 9 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("InsufficientStock")
  })

  it("returns 404 when updating an unknown cart item", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/cart/items/00000000-0000-0000-0000-000000000000",
      headers: await authHeaders(),
      payload: { qty: 2 },
    })
    expect(res.statusCode).toBe(404)
  })

  it("removes a product cart line", async () => {
    const add = await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: await authHeaders(),
      payload: { variantId, qty: 1 },
    })
    const itemId = add.json().data.items[0].id
    const del = await app.inject({
      method: "DELETE",
      url: `/api/cart/items/${itemId}`,
      headers: await authHeaders(),
    })
    expect(del.statusCode).toBe(204)
    const get = await app.inject({ method: "GET", url: "/api/cart", headers: await authHeaders() })
    expect(get.json().data.items).toEqual([])
  })

  it("adds an available artwork print and reserves it (in_cart)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: await authHeaders(),
      payload: { printId: availablePrintId, qty: 1 },
    })
    expect(res.statusCode).toBe(201)
    const { data } = res.json()
    expect(data.artworkItems).toHaveLength(1)
    expect(data.artworkItems[0]).toMatchObject({ printId: availablePrintId, unitPriceHt: 100 })
    expect(data.artworkItems[0].lineTtc).toBe(120)

    const [print] = await db
      .select({ status: artworkPrints.status })
      .from(artworkPrints)
      .where(eq(artworkPrints.id, availablePrintId))
    expect(print.status).toBe("in_cart")
  })

  it("releases the print back to available when its cart line is removed", async () => {
    const add = await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: await authHeaders(),
      payload: { printId: availablePrintId, qty: 1 },
    })
    const artItemId = add.json().data.artworkItems[0].id

    const del = await app.inject({
      method: "DELETE",
      url: `/api/cart/artwork-items/${artItemId}`,
      headers: await authHeaders(),
    })
    expect(del.statusCode).toBe(204)

    const [print] = await db
      .select({ status: artworkPrints.status })
      .from(artworkPrints)
      .where(eq(artworkPrints.id, availablePrintId))
    expect(print.status).toBe("available")
  })

  it("rejects adding the same print twice", async () => {
    await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: await authHeaders(),
      payload: { printId: availablePrintId, qty: 1 },
    })
    const res = await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: await authHeaders(),
      payload: { printId: availablePrintId, qty: 1 },
    })
    expect(res.statusCode).toBe(409)
  })

  it("rejects adding a print that is not available", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: await authHeaders(),
      payload: { printId: soldPrintId, qty: 1 },
    })
    expect(res.statusCode).toBe(409)
  })

  it("clears the whole cart", async () => {
    await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: await authHeaders(),
      payload: { variantId, qty: 1 },
    })
    await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: await authHeaders(),
      payload: { printId: availablePrintId, qty: 1 },
    })
    const clear = await app.inject({
      method: "DELETE",
      url: "/api/cart",
      headers: await authHeaders(),
    })
    expect(clear.statusCode).toBe(204)
    const get = await app.inject({ method: "GET", url: "/api/cart", headers: await authHeaders() })
    expect(get.json().data.summary.itemCount).toBe(0)

    const [print] = await db
      .select({ status: artworkPrints.status })
      .from(artworkPrints)
      .where(eq(artworkPrints.id, availablePrintId))
    expect(print.status).toBe("available")
  })

  describe("Gun Art print hold (story 12.9a)", () => {
    const HOLD_MS = 30 * 60 * 1000

    async function addPrint() {
      const res = await app.inject({
        method: "POST",
        url: "/api/cart/items",
        headers: await authHeaders(),
        payload: { printId: availablePrintId, qty: 1 },
      })
      expect(res.statusCode).toBe(201)
      return res.json().data
    }
    async function ageCartLine(minutes: number) {
      await db
        .update(artworkCartItems)
        .set({ addedAt: new Date(Date.now() - minutes * 60 * 1000) })
        .where(eq(artworkCartItems.userId, userId))
    }
    async function printStatus() {
      const [print] = await db
        .select({ status: artworkPrints.status })
        .from(artworkPrints)
        .where(eq(artworkPrints.id, availablePrintId))
      return print.status
    }

    it("tells the shopper until when the print is held", async () => {
      const before = Date.now()
      const cart = await addPrint()
      const heldUntil = Date.parse(cart.artworkItems[0].heldUntil)
      expect(heldUntil).toBeGreaterThanOrEqual(before + HOLD_MS - 1000)
      expect(heldUntil).toBeLessThanOrEqual(Date.now() + HOLD_MS + 1000)
    })

    it("drops a print whose hold has lapsed from the cart", async () => {
      await addPrint()
      await ageCartLine(31)
      const cart = (await app.inject({ method: "GET", url: "/api/cart", headers: await authHeaders() })).json().data
      expect(cart.artworkItems).toEqual([])
      expect(cart.summary.itemCount).toBe(0)
    })

    it("puts a print back on sale once its hold has lapsed", async () => {
      await addPrint()
      await ageCartLine(31)

      expect(await releaseLapsedPrintHolds()).toBeGreaterThanOrEqual(1)

      expect(await printStatus()).toBe("available")
      const lines = await db.select().from(artworkCartItems).where(eq(artworkCartItems.userId, userId))
      expect(lines).toEqual([])
    })

    it("keeps a print still within its hold", async () => {
      await addPrint()
      await ageCartLine(29)

      await releaseLapsedPrintHolds()

      expect(await printStatus()).toBe("in_cart")
    })
  })
})
