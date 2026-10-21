import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, cartItems, products, productTags, productVariants, tags, users } from "../db/schema.js"
import { env } from "../env.js"

const EMAIL_SUFFIX = "@audience-test.local"
const PREFIX = "TESTAUD-"
// One word only these products carry, for the full-text search.
const TOKEN = "zircaudience"

const flag = env as { CROSS_SELL_ENABLED: boolean }

/**
 * Story 12.8c — a product reserved for pros (a bulletproof vest for a police
 * force) must not surface anywhere on the public side. Each public route that
 * reads products is checked here, against a published pro product.
 */
describe("products reserved for pros never leak to the public side (story 12.8c)", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerToken: string
  const product: Record<"weapon" | "vest", { id: string; slug: string }> = {
    weapon: { id: "", slug: "" },
    vest: { id: "", slug: "" },
  }

  async function cleanup() {
    const userIds = db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `%${EMAIL_SUFFIX}`))
    await db.delete(cartItems).where(inArray(cartItems.userId, userIds))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(like(users.email, `%${EMAIL_SUFFIX}`))
    await db.delete(products).where(like(products.sku, `${PREFIX}%`))
  }

  async function account(role: "admin" | "customer") {
    const [row] = await db
      .insert(users)
      .values({
        email: `${role}-${Date.now()}${EMAIL_SUFFIX}`,
        passwordHash: "$argon2id$unused",
        role,
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    return app.jwt.sign({ sub: row.id, role })
  }

  async function create(key: "weapon" | "vest", fields: Record<string, unknown>) {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/products",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        sku: `${PREFIX}${key}`,
        slug: `testaud-${key}`,
        priceHt: 450,
        stockQty: 5,
        published: true,
        variants: [],
        tagSlugs: [],
        ...fields,
      },
    })
    expect(res.statusCode, res.body).toBe(201)
    product[key] = { id: res.json().data.id, slug: res.json().data.slug }
    return res.json().data
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
    adminToken = await account("admin")
    customerToken = await account("customer")

    await create("weapon", {
      name: `Pistolet ${TOKEN}`,
      categorySlug: "arme-poing",
      legalCategory: "B",
    })
    const vest = await create("vest", {
      name: `Gilet pare-balles ${TOKEN}`,
      categorySlug: "accessoire-tireur",
      legalCategory: "none",
      audience: "pro",
    })
    expect(vest.audience).toBe("pro")
  })

  afterAll(async () => {
    flag.CROSS_SELL_ENABLED = false
    await cleanup()
    await app.close()
  })

  it("defaults a product to the public catalogue", async () => {
    const [row] = await db
      .select({ audience: products.audience })
      .from(products)
      .where(eq(products.id, product.weapon.id))
    expect(row?.audience).toBe("public")
  })

  it("leaves it out of the catalogue listing", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products?limit=100&search=" + TOKEN })
    const slugs = res.json().data.map((row: { slug: string }) => row.slug)
    expect(slugs).toContain(product.weapon.slug)
    expect(slugs).not.toContain(product.vest.slug)
  })

  it("answers 404 for its page, by slug and by id", async () => {
    expect((await app.inject({ method: "GET", url: `/api/products/slug/${product.vest.slug}` })).statusCode).toBe(404)
    expect((await app.inject({ method: "GET", url: `/api/products/${product.vest.id}` })).statusCode).toBe(404)
    expect((await app.inject({ method: "GET", url: `/api/products/slug/${product.weapon.slug}` })).statusCode).toBe(200)
  })

  it("leaves it out of the site search", async () => {
    const body = (await app.inject({ method: "GET", url: `/api/search?q=${TOKEN}` })).json()
    const skus = body.products.map((row: { sku: string }) => row.sku)
    expect(skus).toContain(`${PREFIX}weapon`)
    expect(skus).not.toContain(`${PREFIX}vest`)
  })

  it("does not count it in the tag facets", async () => {
    const [tag] = await db.select({ id: tags.id, slug: tags.slug }).from(tags).limit(1)
    if (!tag) throw new Error("the seed has no tag")
    const countOf = async () => {
      const facets = (await app.inject({ method: "GET", url: "/api/tags" })).json().data
      const all = facets.flatMap((facet: { tags: { slug: string; productCount: number }[] }) => facet.tags)
      return all.find((row: { slug: string }) => row.slug === tag.slug)?.productCount
    }
    const before = await countOf()
    await db.insert(productTags).values({ productId: product.vest.id, tagId: tag.id })

    expect(await countOf()).toBe(before)
    await db.delete(productTags).where(eq(productTags.productId, product.vest.id))
  })

  it("leaves it out of the sitemap", async () => {
    const data = (await app.inject({ method: "GET", url: "/api/seo/sitemap" })).json().data
    const slugs = data.products.map((row: { slug: string }) => row.slug)
    expect(slugs).toContain(product.weapon.slug)
    expect(slugs).not.toContain(product.vest.slug)
  })

  it("never suggests it under a public weapon", async () => {
    flag.CROSS_SELL_ENABLED = true
    await app.inject({
      method: "PUT",
      url: `/api/admin/products/${product.weapon.id}/cross-sells`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { accessoryIds: [product.vest.id] },
    })

    const page = (await app.inject({ method: "GET", url: `/api/products/slug/${product.weapon.slug}` })).json()
    expect(page.crossSells).toEqual([])
  })

  it("cannot be put in the ordinary cart", async () => {
    const [variant] = await db
      .insert(productVariants)
      .values({ productId: product.vest.id, skuVariant: `${PREFIX}vest-m`, couleur: "noir", stockQty: 3 })
      .returning({ id: productVariants.id })

    const res = await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { variantId: variant?.id, qty: 1 },
    })
    expect(res.statusCode).toBe(404)
  })
})
