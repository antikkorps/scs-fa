import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import {
  addresses,
  artworkCartItems,
  artworkPrints,
  artworks,
  auditLogs,
  cartItems,
  legalCategories,
  orders,
  productCategories,
  products,
  productVariants,
  users,
} from "../db/schema.js"

const PREFIX = "TEST32-"
const PASSWORD = "MotDePasseTresLong123!"
const EMAIL = "cart-test32@order-test.local"
const EMAIL_OTHER = "cart-test32-other@order-test.local"

async function categoryId(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(eq(productCategories.slug, slug))
    .limit(1)
  if (!row) throw new Error(`Missing seeded category: ${slug}`)
  return row.id
}

async function legalCategoryId(code: "B" | "none"): Promise<string> {
  const [row] = await db
    .select({ id: legalCategories.id })
    .from(legalCategories)
    .where(eq(legalCategories.category, code))
    .limit(1)
  if (!row) throw new Error(`Missing seeded legal category: ${code}`)
  return row.id
}

describe("orders (POST /api/orders)", () => {
  let app: FastifyInstance
  let userId: string
  let otherUserId: string
  let token: string
  let otherToken: string
  let shippingAddressId: string
  let otherUserAddressId: string
  let regulatedVariantId: string
  let accessoryVariantId: string
  let printId: string
  let testArtworkId: string

  async function cleanup() {
    const artworkIds = db
      .select({ id: artworks.id })
      .from(artworks)
      .where(like(artworks.sku, `${PREFIX}%`))
    const variantIds = db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(like(productVariants.skuVariant, `${PREFIX}%`))
    const printIds = db
      .select({ id: artworkPrints.id })
      .from(artworkPrints)
      .where(inArray(artworkPrints.artworkId, artworkIds))
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "cart-test32%"))

    await db.delete(artworkCartItems).where(inArray(artworkCartItems.printId, printIds))
    await db.delete(cartItems).where(inArray(cartItems.variantId, variantIds))
    await db
      .update(artworkPrints)
      .set({ orderId: null, status: "available" })
      .where(inArray(artworkPrints.artworkId, artworkIds))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(orders).where(inArray(orders.userId, userIds))
    await db.delete(addresses).where(inArray(addresses.userId, userIds))
    await db.delete(artworkPrints).where(inArray(artworkPrints.artworkId, artworkIds))
    await db.delete(artworks).where(like(artworks.sku, `${PREFIX}%`))
    await db.delete(productVariants).where(like(productVariants.skuVariant, `${PREFIX}%`))
    await db.delete(products).where(like(products.sku, `${PREFIX}%`))
    await db.delete(users).where(like(users.email, "cart-test32%"))
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()

    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    const [u1] = await db
      .insert(users)
      .values({
        email: EMAIL,
        passwordHash,
        role: "customer",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    userId = u1.id
    const [u2] = await db
      .insert(users)
      .values({
        email: EMAIL_OTHER,
        passwordHash,
        role: "customer",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    otherUserId = u2.id

    const [addr] = await db
      .insert(addresses)
      .values({
        userId,
        label: "Domicile",
        firstName: "Jean",
        lastName: "Tireur",
        line1: "1 rue du Tir",
        postal: "75001",
        city: "Paris",
        isDefault: true,
      })
      .returning({ id: addresses.id })
    shippingAddressId = addr.id
    const [otherAddr] = await db
      .insert(addresses)
      .values({
        userId: otherUserId,
        firstName: "Autre",
        lastName: "Client",
        line1: "2 avenue Ailleurs",
        postal: "69002",
        city: "Lyon",
      })
      .returning({ id: addresses.id })
    otherUserAddressId = otherAddr.id

    const armeLongue = await categoryId("arme-longue")
    const accessoire = await categoryId("accessoire-tireur")
    const gunArt = await categoryId("gun-art")
    const legalB = await legalCategoryId("B")
    const legalNone = await legalCategoryId("none")

    const [regulated] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}reg`,
        slug: `${PREFIX}reg`,
        name: "Carabine Réglementée",
        categoryId: armeLongue,
        legalCategoryId: legalB,
        priceHt: "1000.00",
        requiresLegalVerification: true,
        published: true,
      })
      .returning({ id: products.id })
    const [regVariant] = await db
      .insert(productVariants)
      .values({ productId: regulated.id, skuVariant: `${PREFIX}reg-v1`, finition: "Bois", stockQty: 5 })
      .returning({ id: productVariants.id })
    regulatedVariantId = regVariant.id

    const [accessory] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}acc`,
        slug: `${PREFIX}acc`,
        name: "Tapis de tir",
        categoryId: accessoire,
        legalCategoryId: legalNone,
        priceHt: "50.00",
        requiresLegalVerification: false,
        published: true,
      })
      .returning({ id: products.id })
    const [accVariant] = await db
      .insert(productVariants)
      .values({ productId: accessory.id, skuVariant: `${PREFIX}acc-v1`, couleur: "Vert", stockQty: 5 })
      .returning({ id: productVariants.id })
    accessoryVariantId = accVariant.id

    const [artProduct] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}art`,
        slug: `${PREFIX}art`,
        name: "Oeuvre",
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
        title: "Tirage Test",
        editionLimit: 25,
        basePriceHt: "50.00",
        priceIncrementHt: "2.00",
      })
      .returning({ id: artworks.id })
    testArtworkId = artwork.id
    const [print] = await db
      .insert(artworkPrints)
      .values({
        artworkId: artwork.id,
        printNumber: 1,
        totalPrints: 25,
        printDesignation: "1/25",
        formatId: "A4",
        priceHtUnit: "100.00",
        status: "available",
      })
      .returning({ id: artworkPrints.id })
    printId = print.id

    const loginAs = async (email: string) =>
      (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })).json()
        .accessToken
    token = await loginAs(EMAIL)
    otherToken = await loginAs(EMAIL_OTHER)
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  beforeEach(async () => {
    await db.delete(cartItems).where(inArray(cartItems.userId, [userId, otherUserId]))
    await db.delete(artworkCartItems).where(inArray(artworkCartItems.userId, [userId, otherUserId]))
    await db
      .update(artworkPrints)
      .set({ orderId: null, status: "available" })
      .where(eq(artworkPrints.artworkId, testArtworkId))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, [userId, otherUserId]))
    await db.delete(orders).where(inArray(orders.userId, [userId, otherUserId]))
    await db
      .update(productVariants)
      .set({ stockQty: 5 })
      .where(like(productVariants.skuVariant, `${PREFIX}%`))
  })

  function authHeaders(t: string) {
    return { authorization: `Bearer ${t}` }
  }
  function addToCart(t: string, payload: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/api/cart/items", headers: authHeaders(t), payload })
  }
  function createOrder(payload: Record<string, unknown> = { shippingAddressId }) {
    return app.inject({ method: "POST", url: "/api/orders", headers: authHeaders(token), payload })
  }

  it("requires authentication", async () => {
    const res = await app.inject({ method: "POST", url: "/api/orders", payload: { shippingAddressId } })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 when shippingAddressId is missing", async () => {
    await addToCart(token, { variantId: accessoryVariantId, qty: 1 })
    const res = await createOrder({})
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("ValidationError")
  })

  it("returns 400 when the cart is empty", async () => {
    const res = await createOrder()
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("EmptyCart")
  })

  it("returns 404 when the shipping address belongs to another user", async () => {
    await addToCart(token, { variantId: accessoryVariantId, qty: 1 })
    const res = await createOrder({ shippingAddressId: otherUserAddressId })
    expect(res.statusCode).toBe(404)
  })

  it("creates a virement-only order for a regulated firearm and snapshots the address", async () => {
    await addToCart(token, { variantId: regulatedVariantId, qty: 1 })
    const res = await createOrder()
    expect(res.statusCode).toBe(201)
    const { data } = res.json()
    expect(data.requiresLegalVerification).toBe(true)
    expect(data.legalVerificationStatus).toBe("pending")
    expect(data.paymentSplit.splitType).toBe("virement_only")
    expect(data.paymentSplit.virement.amountTtc).toBe(1200)
    expect(data.totals.totalTtc).toBe(1200)
    expect(data.shippingAddress).toMatchObject({ line1: "1 rue du Tir", city: "Paris", country: "FR" })

    const [variant] = await db
      .select({ stockQty: productVariants.stockQty })
      .from(productVariants)
      .where(eq(productVariants.id, regulatedVariantId))
    expect(variant.stockQty).toBe(4)
    const cart = await app.inject({ method: "GET", url: "/api/cart", headers: authHeaders(token) })
    expect(cart.json().data.summary.itemCount).toBe(0)
  })

  it("creates a carte-only order for accessories without legal verification", async () => {
    await addToCart(token, { variantId: accessoryVariantId, qty: 2 })
    const res = await createOrder()
    expect(res.statusCode).toBe(201)
    const { data } = res.json()
    expect(data.requiresLegalVerification).toBe(false)
    expect(data.legalVerificationStatus).toBe("payment_pending")
    expect(data.paymentSplit.splitType).toBe("carte_only")
    expect(data.paymentSplit.carte.amountTtc).toBe(120)
  })

  it("splits a mixed order and reserves the artwork print", async () => {
    await addToCart(token, { variantId: regulatedVariantId, qty: 1 })
    await addToCart(token, { variantId: accessoryVariantId, qty: 1 })
    await addToCart(token, { printId, qty: 1 })
    const res = await createOrder()
    expect(res.statusCode).toBe(201)
    const { data } = res.json()
    expect(data.paymentSplit.splitType).toBe("mixed")
    expect(data.paymentSplit.virement.amountTtc).toBe(1200)
    expect(data.paymentSplit.carte.amountTtc).toBe(180)

    const [print] = await db
      .select({ status: artworkPrints.status, orderId: artworkPrints.orderId })
      .from(artworkPrints)
      .where(eq(artworkPrints.id, printId))
    expect(print.status).toBe("reserved")
    expect(print.orderId).toBe(data.id)
  })

  it("rolls back and returns 409 when stock ran out before checkout", async () => {
    await addToCart(token, { variantId: regulatedVariantId, qty: 2 })
    await db.update(productVariants).set({ stockQty: 1 }).where(eq(productVariants.id, regulatedVariantId))

    const res = await createOrder()
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe("InsufficientStock")

    const orderRows = await db.select({ id: orders.id }).from(orders).where(eq(orders.userId, userId))
    expect(orderRows).toHaveLength(0)
    const cart = await app.inject({ method: "GET", url: "/api/cart", headers: authHeaders(token) })
    expect(cart.json().data.summary.itemCount).toBe(2)
  })

  // --- Story 3.3: order tracking (GET) ---

  it("GET /api/orders requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/orders" })
    expect(res.statusCode).toBe(401)
  })

  it("lists the user's orders newest-first with a paginated envelope", async () => {
    await addToCart(token, { variantId: accessoryVariantId, qty: 2 })
    const created = (await createOrder()).json().data

    const res = await app.inject({ method: "GET", url: "/api/orders", headers: authHeaders(token) })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.pagination).toMatchObject({ page: 1, limit: 20, total: 1, totalPages: 1, hasMore: false })
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({
      id: created.id,
      paymentStatus: "pending",
      legalVerificationStatus: "payment_pending",
      totalTtc: 120,
      itemCount: 2,
    })
  })

  it("does not leak another user's orders", async () => {
    await addToCart(token, { variantId: accessoryVariantId, qty: 1 })
    await createOrder()
    const res = await app.inject({ method: "GET", url: "/api/orders", headers: authHeaders(otherToken) })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([])
  })

  it("returns a single order with its items and address snapshots", async () => {
    await addToCart(token, { variantId: regulatedVariantId, qty: 1 })
    const created = (await createOrder()).json().data

    const res = await app.inject({ method: "GET", url: `/api/orders/${created.id}`, headers: authHeaders(token) })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data).toMatchObject({
      id: created.id,
      legalVerificationStatus: "pending",
      paymentStatus: "pending",
      totalTtc: 1200,
    })
    expect(data.items).toHaveLength(1)
    expect(data.items[0]).toMatchObject({ sku: `${PREFIX}reg`, qty: 1, requiresPaymentVirement: true })
    expect(data.shippingAddress).toMatchObject({ line1: "1 rue du Tir", city: "Paris" })
    expect(data.billingAddress).toMatchObject({ line1: "1 rue du Tir" })
  })

  it("returns 404 for an unknown order id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/orders/00000000-0000-0000-0000-000000000000",
      headers: authHeaders(token),
    })
    expect(res.statusCode).toBe(404)
  })

  it("returns 404 when fetching another user's order by id", async () => {
    await addToCart(token, { variantId: accessoryVariantId, qty: 1 })
    const created = (await createOrder()).json().data
    const res = await app.inject({
      method: "GET",
      url: `/api/orders/${created.id}`,
      headers: authHeaders(otherToken),
    })
    expect(res.statusCode).toBe(404)
  })
})
