import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, inArray, like, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import {
  ancientWeapons,
  auditLogs,
  cartItems,
  legalCategories,
  productCategories,
  products,
  productVariants,
  users,
} from "../db/schema.js"

const PREFIX = "TEST112-"
// Slugs must be lowercase (the public slug route validates the shape), so the
// SKU prefix and the slug prefix differ on purpose.
const SLUG = "test112-"
const PASSWORD = "MotDePasseTresLong123!"
const BUYER = "buyer-test112@collection.local"
const RIVAL = "rival-test112@collection.local"

let app: FastifyInstance
let buyerToken: string
let rivalToken: string
let uniqueVariantId: string
let plainVariantId: string

async function makeUser(email: string): Promise<string> {
  const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
  await db.insert(users).values({
    email,
    passwordHash,
    role: "customer",
    rgpdConsentAt: new Date(),
    rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
  })
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })
  return res.json().accessToken
}

async function categoryId(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(eq(productCategories.slug, slug))
    .limit(1)
  if (!row) throw new Error(`Missing seeded category: ${slug} (run db:seed)`)
  return row.id
}

async function legalId(code: "B" | "C" | "none"): Promise<string> {
  const [row] = await db
    .select({ id: legalCategories.id })
    .from(legalCategories)
    .where(eq(legalCategories.category, code))
    .limit(1)
  if (!row) throw new Error(`Missing seeded legal category: ${code}`)
  return row.id
}

function addToCart(token: string, variantId: string, qty = 1) {
  return app.inject({
    method: "POST",
    url: "/api/cart/items",
    headers: { authorization: `Bearer ${token}` },
    payload: { variantId, qty },
  })
}

async function cleanup() {
  const productIds = db
    .select({ id: products.id })
    .from(products)
    .where(like(products.sku, `${PREFIX}%`))
  const variantIds = db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(like(productVariants.skuVariant, `${PREFIX}%`))
  const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "%test112@collection.local"))
  await db.delete(cartItems).where(inArray(cartItems.variantId, variantIds))
  // audit_logs references users, so it has to go first.
  await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
  await db.delete(ancientWeapons).where(inArray(ancientWeapons.productId, productIds))
  await db.delete(products).where(like(products.sku, `${PREFIX}%`))
  await db.delete(users).where(like(users.email, "%test112@collection.local"))
}

describe("Collection weapons (story 11.2)", () => {
  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()

    buyerToken = await makeUser(BUYER)
    rivalToken = await makeUser(RIVAL)

    const armePoing = await categoryId("arme-poing")
    const legalB = await legalId("B")

    // A unique collection piece: one product, one ancient_weapons row, stock 1.
    const [unique] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}unique`,
        slug: `${SLUG}unique`,
        name: "Pistolet historique de test",
        categoryId: armePoing,
        legalCategoryId: legalB,
        priceHt: "3000.00",
        stockQty: 1,
        requiresLegalVerification: true,
        published: true,
      })
      .returning({ id: products.id })
    await db.insert(ancientWeapons).values({
      productId: unique.id,
      period: "Première Guerre mondiale",
      periodStartYear: 1917,
      makerName: "DWM",
      condition: "excellent",
      isAuthentic: true,
      isUnique: true,
    })
    const [uniqueVariant] = await db
      .insert(productVariants)
      .values({
        productId: unique.id,
        skuVariant: `${PREFIX}unique-PU`,
        finition: "Pièce unique",
        stockQty: 1,
      })
      .returning({ id: productVariants.id })
    uniqueVariantId = uniqueVariant.id

    // An ordinary multi-stock product: holds must not apply to it.
    const [plain] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}plain`,
        slug: `${SLUG}plain`,
        name: "Produit ordinaire de test",
        categoryId: armePoing,
        legalCategoryId: legalB,
        priceHt: "800.00",
        stockQty: 10,
        requiresLegalVerification: true,
        published: true,
      })
      .returning({ id: products.id })
    const [plainVariant] = await db
      .insert(productVariants)
      .values({ productId: plain.id, skuVariant: `${PREFIX}plain-v`, finition: "Std", stockQty: 10 })
      .returning({ id: productVariants.id })
    plainVariantId = plainVariant.id
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  beforeEach(async () => {
    await db.delete(cartItems).where(inArray(cartItems.variantId, [uniqueVariantId, plainVariantId]))
    await db
      .update(productVariants)
      .set({ reservedBy: null, reservedUntil: null, stockQty: 1 })
      .where(eq(productVariants.id, uniqueVariantId))
    await db.update(productVariants).set({ stockQty: 10 }).where(eq(productVariants.id, plainVariantId))
  })

  describe("cart hold on a unique piece", () => {
    it("holds the piece for the shopper who puts it in their cart", async () => {
      expect((await addToCart(buyerToken, uniqueVariantId)).statusCode).toBe(201)

      const [variant] = await db
        .select({ reservedBy: productVariants.reservedBy, reservedUntil: productVariants.reservedUntil })
        .from(productVariants)
        .where(eq(productVariants.id, uniqueVariantId))
      expect(variant.reservedBy).not.toBeNull()
      expect(variant.reservedUntil).not.toBeNull()
    })

    it("refuses a second shopper while the hold stands", async () => {
      await addToCart(buyerToken, uniqueVariantId)
      const res = await addToCart(rivalToken, uniqueVariantId)
      expect(res.statusCode).toBe(409)
      expect(res.json().error).toBe("Conflict")
    })

    it("lets the holder re-add without locking themselves out", async () => {
      await addToCart(buyerToken, uniqueVariantId)
      // Stock is 1, so a second unit is refused on stock grounds (400), never
      // on reservation grounds — the shopper must not collide with their own hold.
      const res = await addToCart(buyerToken, uniqueVariantId)
      expect(res.statusCode).not.toBe(409)
    })

    it("gives exactly one winner when two shoppers race", async () => {
      const [a, b] = await Promise.all([addToCart(buyerToken, uniqueVariantId), addToCart(rivalToken, uniqueVariantId)])
      const codes = [a.statusCode, b.statusCode].sort()
      expect(codes).toEqual([201, 409])
    })

    it("frees the piece when the line is removed", async () => {
      await addToCart(buyerToken, uniqueVariantId)
      const cart = await app.inject({
        method: "GET",
        url: "/api/cart",
        headers: { authorization: `Bearer ${buyerToken}` },
      })
      const lineId = cart.json().data.items[0].id

      const del = await app.inject({
        method: "DELETE",
        url: `/api/cart/items/${lineId}`,
        headers: { authorization: `Bearer ${buyerToken}` },
      })
      expect(del.statusCode).toBe(204)
      expect((await addToCart(rivalToken, uniqueVariantId)).statusCode).toBe(201)
    })

    it("frees the piece when the whole cart is emptied", async () => {
      await addToCart(buyerToken, uniqueVariantId)
      await app.inject({ method: "DELETE", url: "/api/cart", headers: { authorization: `Bearer ${buyerToken}` } })
      expect((await addToCart(rivalToken, uniqueVariantId)).statusCode).toBe(201)
    })

    it("treats a lapsed hold as free, without any sweeper running", async () => {
      await addToCart(buyerToken, uniqueVariantId)
      // Push the hold into the past: nothing sweeps it, it is simply ignored.
      await db
        .update(productVariants)
        .set({ reservedUntil: sql`now() - interval '1 minute'` })
        .where(eq(productVariants.id, uniqueVariantId))

      expect((await addToCart(rivalToken, uniqueVariantId)).statusCode).toBe(201)
    })

    it("never holds an ordinary multi-stock product", async () => {
      expect((await addToCart(buyerToken, plainVariantId)).statusCode).toBe(201)
      const [variant] = await db
        .select({ reservedBy: productVariants.reservedBy })
        .from(productVariants)
        .where(eq(productVariants.id, plainVariantId))
      expect(variant.reservedBy).toBeNull()

      // …and a second shopper is perfectly welcome.
      expect((await addToCart(rivalToken, plainVariantId)).statusCode).toBe(201)
    })
  })

  describe("public listing", () => {
    it("returns collection weapons with their historical fields", async () => {
      const res = await app.inject({ method: "GET", url: "/api/ancient-weapons?limit=100" })
      expect(res.statusCode).toBe(200)
      const item = (res.json().data as Array<{ slug: string; makerName: string; period: string; available: boolean }>) //
        .find((w) => w.slug === `${SLUG}unique`)
      expect(item?.makerName).toBe("DWM")
      expect(item?.period).toBe("Première Guerre mondiale")
      expect(item?.available).toBe(true)
    })

    it("excludes ordinary products, however published they are", async () => {
      const res = await app.inject({ method: "GET", url: "/api/ancient-weapons?limit=100" })
      const slugs = (res.json().data as Array<{ slug: string }>).map((w) => w.slug)
      expect(slugs).not.toContain(`${SLUG}plain`)
    })

    it("keeps a sold piece listed but marks it unavailable", async () => {
      await db
        .update(products)
        .set({ stockQty: 0 })
        .where(eq(products.sku, `${PREFIX}unique`))
      const res = await app.inject({ method: "GET", url: "/api/ancient-weapons?limit=100" })
      const item = (res.json().data as Array<{ slug: string; available: boolean }>).find(
        (w) => w.slug === `${SLUG}unique`,
      )
      // Still on display — a sold historical piece keeps its editorial value.
      expect(item).toBeDefined()
      expect(item?.available).toBe(false)
      await db
        .update(products)
        .set({ stockQty: 1 })
        .where(eq(products.sku, `${PREFIX}unique`))
    })

    it("filters on availability when asked", async () => {
      await db
        .update(products)
        .set({ stockQty: 0 })
        .where(eq(products.sku, `${PREFIX}unique`))
      const res = await app.inject({ method: "GET", url: "/api/ancient-weapons?available=true&limit=100" })
      const slugs = (res.json().data as Array<{ slug: string }>).map((w) => w.slug)
      expect(slugs).not.toContain(`${SLUG}unique`)
      await db
        .update(products)
        .set({ stockQty: 1 })
        .where(eq(products.sku, `${PREFIX}unique`))
    })

    it("rejects a malformed filter", async () => {
      const res = await app.inject({ method: "GET", url: "/api/ancient-weapons?limit=999" })
      expect(res.statusCode).toBe(400)
    })
  })

  describe("product detail", () => {
    it("carries the historical dossier on a collection weapon", async () => {
      const res = await app.inject({ method: "GET", url: `/api/products/slug/${SLUG}unique` })
      expect(res.statusCode).toBe(200)
      // This route returns the product directly, without a `data` envelope.
      const data = res.json()
      expect(data.ancientWeapon).not.toBeNull()
      expect(data.ancientWeapon.makerName).toBe("DWM")
      expect(data.ancientWeapon.isUnique).toBe(true)
    })

    it("leaves the block null on an ordinary product", async () => {
      const res = await app.inject({ method: "GET", url: `/api/products/slug/${SLUG}plain` })
      expect(res.json().ancientWeapon).toBeNull()
    })

    it("flags a variant held by somebody else", async () => {
      await addToCart(buyerToken, uniqueVariantId)
      const res = await app.inject({ method: "GET", url: `/api/products/slug/${SLUG}unique` })
      expect(res.json().variants[0].heldByOther).toBe(true)
    })
  })

  describe("admin CRUD", () => {
    const created: string[] = []

    async function adminHeaders() {
      const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1)
      if (!admin) throw new Error("No admin seeded (run db:seed)")
      const token = app.jwt.sign({ sub: admin.id, role: "admin" })
      return { authorization: `Bearer ${token}` }
    }

    function payload(overrides: Record<string, unknown> = {}) {
      return {
        sku: `${PREFIX}admin`,
        slug: `${SLUG}admin`,
        name: "Pièce créée par l'admin",
        categorySlug: "arme-poing",
        legalCategory: "C",
        priceHt: 1500,
        condition: "bon",
        tagSlugs: ["occasion", "arme-ancienne"],
        published: true,
        ...overrides,
      }
    }

    afterAll(async () => {
      if (created.length > 0) await db.delete(products).where(inArray(products.id, created))
    })

    it("creates the product, its dossier, its unique variant and its tags at once", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/ancient-weapons",
        headers: await adminHeaders(),
        payload: payload(),
      })
      expect(res.statusCode).toBe(201)
      const weapon = res.json().data
      created.push(weapon.id)

      expect(weapon.stockQty).toBe(1)
      expect(weapon.isUnique).toBe(true)
      // Tag attachment used to bind the array as a tuple, which the database
      // rejected outright — a create with tags must keep working.
      expect(weapon.tags.map((t: { slug: string }) => t.slug).sort()).toEqual(["arme-ancienne", "occasion"])

      const [variant] = await db
        .select({ finition: productVariants.finition, stockQty: productVariants.stockQty })
        .from(productVariants)
        .where(eq(productVariants.productId, weapon.id))
      // Without a variant the piece could never enter a cart.
      expect(variant.finition).toBe("Pièce unique")
      expect(variant.stockQty).toBe(1)
    })

    it("strips scripts and event handlers from the story", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/ancient-weapons",
        headers: await adminHeaders(),
        payload: payload({
          sku: `${PREFIX}xss`,
          slug: `${SLUG}xss`,
          longDescription:
            "<p>Texte <strong>légitime</strong>.</p><script>alert(1)</script>" +
            '<img src=x onerror=alert(2)><a href="javascript:alert(3)">lien</a>',
        }),
      })
      expect(res.statusCode).toBe(201)
      const weapon = res.json().data
      created.push(weapon.id)

      const stored = weapon.longDescription as string
      // The front renders this with v-html, so the guarantee has to hold here.
      expect(stored).toContain("<strong>légitime</strong>")
      expect(stored).not.toContain("<script")
      expect(stored).not.toContain("onerror")
      expect(stored).not.toContain("javascript:")
    })

    it("refuses a duplicate sku or slug", async () => {
      const first = await app.inject({
        method: "POST",
        url: "/api/admin/ancient-weapons",
        headers: await adminHeaders(),
        payload: payload({ sku: `${PREFIX}dup`, slug: `${SLUG}dup` }),
      })
      created.push(first.json().data.id)

      const second = await app.inject({
        method: "POST",
        url: "/api/admin/ancient-weapons",
        headers: await adminHeaders(),
        payload: payload({ sku: `${PREFIX}dup`, slug: `${SLUG}dup` }),
      })
      expect(second.statusCode).toBe(409)
    })

    it("refuses to delete a piece a customer is holding", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/ancient-weapons",
        headers: await adminHeaders(),
        payload: payload({ sku: `${PREFIX}held`, slug: `${SLUG}held` }),
      })
      const weapon = res.json().data
      created.push(weapon.id)

      const [variant] = await db
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.productId, weapon.id))
      await addToCart(buyerToken, variant.id)

      const del = await app.inject({
        method: "DELETE",
        url: `/api/admin/ancient-weapons/${weapon.id}`,
        headers: await adminHeaders(),
      })
      // Deleting it would erase a piece out from under a shopper mid-purchase.
      expect(del.statusCode).toBe(409)
    })

    it("refuses anonymous and non-admin callers", async () => {
      expect((await app.inject({ method: "GET", url: "/api/admin/ancient-weapons" })).statusCode).toBe(401)
      const asCustomer = await app.inject({
        method: "GET",
        url: "/api/admin/ancient-weapons",
        headers: { authorization: `Bearer ${buyerToken}` },
      })
      expect(asCustomer.statusCode).toBe(403)
    })
  })
})
