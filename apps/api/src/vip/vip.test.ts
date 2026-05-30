import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import {
  addresses,
  auditLogs,
  cartItems,
  legalCategories,
  orders,
  productCategories,
  products,
  productVariants,
  users,
} from "../db/schema.js"
import { recomputeVipStatus } from "./service.js"

const PREFIX = "TEST34-"
const PASSWORD = "MotDePasseTresLong123!"
const EMAIL = "vip-test34@vip-test.local"

async function categoryId(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(eq(productCategories.slug, slug))
    .limit(1)
  if (!row) throw new Error(`Missing seeded category: ${slug}`)
  return row.id
}

async function legalCategoryId(code: "B" | "C" | "none"): Promise<string> {
  const [row] = await db
    .select({ id: legalCategories.id })
    .from(legalCategories)
    .where(eq(legalCategories.category, code))
    .limit(1)
  if (!row) throw new Error(`Missing seeded legal category: ${code}`)
  return row.id
}

describe("VIP (story 3.4)", () => {
  let app: FastifyInstance
  let userId: string
  let token: string
  let shippingAddressId: string
  let newFirearmVariantId: string
  let occasionVariantId: string
  let munitionVariantId: string

  async function cleanup() {
    const variantIds = db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(like(productVariants.skuVariant, `${PREFIX}%`))
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "vip-test34%"))
    await db.delete(cartItems).where(inArray(cartItems.variantId, variantIds))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(orders).where(inArray(orders.userId, userIds))
    await db.delete(addresses).where(inArray(addresses.userId, userIds))
    await db.delete(productVariants).where(like(productVariants.skuVariant, `${PREFIX}%`))
    await db.delete(products).where(like(products.sku, `${PREFIX}%`))
    await db.delete(users).where(like(users.email, "vip-test34%"))
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()

    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    const [u] = await db
      .insert(users)
      .values({
        email: EMAIL,
        passwordHash,
        role: "customer",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    userId = u.id

    const [addr] = await db
      .insert(addresses)
      .values({
        userId,
        firstName: "Jean",
        lastName: "Tireur",
        line1: "1 rue du Tir",
        postal: "75001",
        city: "Paris",
        isDefault: true,
      })
      .returning({ id: addresses.id })
    shippingAddressId = addr.id

    const armeLongue = await categoryId("arme-longue")
    const occasion = await categoryId("occasion")
    const munition = await categoryId("munition")
    const legalB = await legalCategoryId("B")
    const legalC = await legalCategoryId("C")
    const legalNone = await legalCategoryId("none")

    const mkProduct = async (suffix: string, cat: string, legal: string, price: string, margin: string) => {
      const [p] = await db
        .insert(products)
        .values({
          sku: `${PREFIX}${suffix}`,
          slug: `${PREFIX}${suffix}`,
          name: `Product ${suffix}`,
          categoryId: cat,
          legalCategoryId: legal,
          priceHt: price,
          marginPct: margin,
          requiresLegalVerification: legal !== legalNone,
          published: true,
        })
        .returning({ id: products.id })
      const [v] = await db
        .insert(productVariants)
        .values({ productId: p.id, skuVariant: `${PREFIX}${suffix}-v`, finition: "Std", stockQty: 5 })
        .returning({ id: productVariants.id })
      return v.id
    }

    newFirearmVariantId = await mkProduct("newgun", armeLongue, legalB, "1000.00", "30")
    occasionVariantId = await mkProduct("occ", occasion, legalC, "500.00", "30")
    munitionVariantId = await mkProduct("munit", munition, legalNone, "20.00", "30")

    token = (
      await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: EMAIL, password: PASSWORD } })
    ).json().accessToken
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  beforeEach(async () => {
    await db.delete(cartItems).where(eq(cartItems.userId, userId))
    await db.delete(orders).where(eq(orders.userId, userId))
    await db
      .update(users)
      .set({ vipActive: false, vipStatus: null, vipEligibleSince: null })
      .where(eq(users.id, userId))
    await db
      .update(productVariants)
      .set({ stockQty: 5 })
      .where(like(productVariants.skuVariant, `${PREFIX}%`))
  })

  function headers() {
    return { authorization: `Bearer ${token}` }
  }
  function addToCart(variantId: string, qty = 1) {
    return app.inject({ method: "POST", url: "/api/cart/items", headers: headers(), payload: { variantId, qty } })
  }
  function createOrder() {
    return app.inject({ method: "POST", url: "/api/orders", headers: headers(), payload: { shippingAddressId } })
  }
  function setVip(active: boolean) {
    return db
      .update(users)
      .set({ vipActive: active, vipStatus: active ? "premium" : null })
      .where(eq(users.id, userId))
  }
  async function markOrderPaid(orderId: string) {
    await db.update(orders).set({ paymentStatus: "received" }).where(eq(orders.id, orderId))
  }

  // --- Eligibility (recomputeVipStatus) ---

  it("does not grant VIP from an unpaid qualifying order", async () => {
    await addToCart(newFirearmVariantId, 1)
    await createOrder()
    const vip = await recomputeVipStatus(userId)
    expect(vip).toBe(false)
  })

  it("grants VIP from a paid order containing a new firearm", async () => {
    await addToCart(newFirearmVariantId, 1)
    const order = (await createOrder()).json().data
    await markOrderPaid(order.id)

    const vip = await recomputeVipStatus(userId)
    expect(vip).toBe(true)
    const [u] = await db
      .select({ vipActive: users.vipActive, vipStatus: users.vipStatus, since: users.vipEligibleSince })
      .from(users)
      .where(eq(users.id, userId))
    expect(u.vipActive).toBe(true)
    expect(u.vipStatus).toBe("premium")
    expect(u.since).not.toBeNull()
  })

  it("does not grant VIP from a paid order of a second-hand firearm", async () => {
    await addToCart(occasionVariantId, 1)
    const order = (await createOrder()).json().data
    await markOrderPaid(order.id)
    expect(await recomputeVipStatus(userId)).toBe(false)
  })

  it("does not grant VIP from a paid order of ammunition only", async () => {
    await addToCart(munitionVariantId, 2)
    const order = (await createOrder()).json().data
    await markOrderPaid(order.id)
    expect(await recomputeVipStatus(userId)).toBe(false)
  })

  // --- Discount (cart + order) ---

  it("applies a 50%-of-margin discount in the cart for a VIP", async () => {
    await setVip(true)
    const res = await addToCart(newFirearmVariantId, 1)
    const { data } = res.json()
    expect(data.isVip).toBe(true)
    // margin 30% → 15% discount; 1000 HT → 150 off, TTC on 850 = 1020
    expect(data.items[0]).toMatchObject({ discountPct: 15, discountAmount: 150, lineHt: 1000, lineTtc: 1020 })
    expect(data.summary).toMatchObject({ subtotalHt: 1000, vipDiscountAmount: 150, totalTtc: 1020 })
  })

  it("does not discount ammunition even for a VIP", async () => {
    await setVip(true)
    const res = await addToCart(munitionVariantId, 1)
    expect(res.json().data.items[0]).toMatchObject({ discountAmount: 0, discountPct: 0 })
  })

  it("gives no discount to a non-VIP", async () => {
    const res = await addToCart(newFirearmVariantId, 1)
    const { data } = res.json()
    expect(data.isVip).toBe(false)
    expect(data.items[0]).toMatchObject({ discountAmount: 0, lineTtc: 1200 })
  })

  it("persists the VIP discount on the order", async () => {
    await setVip(true)
    await addToCart(newFirearmVariantId, 1)
    const created = (await createOrder()).json().data
    expect(created.totals.vipDiscountAmount).toBe(150)
    expect(created.totals.totalTtc).toBe(1020)

    const detail = (await app.inject({ method: "GET", url: `/api/orders/${created.id}`, headers: headers() })).json()
      .data
    expect(detail.vipDiscountAmount).toBe(150)
    expect(detail.vipDiscountAppliedPct).toBe(15)
    expect(detail.totalTtc).toBe(1020)
  })

  // --- Exposure ---

  it("exposes VIP fields on GET /api/auth/me", async () => {
    await setVip(true)
    const res = await app.inject({ method: "GET", url: "/api/auth/me", headers: headers() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ vipActive: true, vipStatus: "premium" })
  })
})
