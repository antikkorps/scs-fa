import { MAX_QUOTE_LINES } from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { organisations, products, productVariants, quoteBasketItems } from "../db/schema.js"
import { type Account, type FixtureProduct, proFixtures } from "../test/pro-fixtures.js"

const TAG = "probasket"

describe("the quote basket (story 12.8c)", () => {
  let app: FastifyInstance
  let fixtures: ReturnType<typeof proFixtures>
  let pro: Account
  const product: Record<string, FixtureProduct> = {}

  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object, token = pro.token) =>
    app.inject({
      method,
      url: `/api/pro/quote-basket${url}`,
      headers: { authorization: `Bearer ${token}` },
      ...(payload ? { payload } : {}),
    })
  const add = (variantId: string | undefined, qty = 1, token = pro.token) =>
    call("POST", "/items", { variantId, qty }, token)
  const basket = async () => (await call("GET", "")).json().data

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    fixtures = proFixtures(app, TAG)
    await fixtures.cleanup()
    pro = await fixtures.account({ organisation: "approved" })
    product.public = await fixtures.product("public", { priceHt: 200 })
    product.vest = await fixtures.product("vest", { audience: "pro", priceHt: 400 })
    product.draft = await fixtures.product("draft", { published: false })
    product.ancient = await fixtures.product("ancient", {
      ancient: true,
      categorySlug: "arme-longue",
      legalCategory: "D",
    })
  })

  beforeEach(async () => {
    await db.delete(quoteBasketItems).where(eq(quoteBasketItems.userId, pro.id))
  })

  afterAll(async () => {
    await fixtures.cleanup()
    await app.close()
  })

  it("takes the public armurerie and the reserved products, and shows them without any price", async () => {
    expect((await add(product.vest?.variantId, 2)).statusCode).toBe(201)
    expect((await add(product.public?.variantId)).statusCode).toBe(201)

    const { items } = await basket()
    expect(items.map((item: { product: { slug: string } }) => item.product.slug)).toEqual([
      product.vest?.slug,
      product.public?.slug,
    ])
    expect(items[0]).toMatchObject({
      qty: 2,
      available: true,
      netPriceHt: null,
      variant: { id: product.vest?.variantId, label: "noir" },
      product: { name: product.vest?.name, legalCategory: "none" },
    })
    expect(JSON.stringify(items)).not.toMatch(/"priceHt"|"priceTtc"|"publicPrice/)
  })

  it("adds up the quantities of the same item", async () => {
    await add(product.vest?.variantId, 2)
    await add(product.vest?.variantId, 3)
    const { items } = await basket()
    expect(items).toHaveLength(1)
    expect(items[0].qty).toBe(5)
  })

  it("refuses a collection piece, an unpublished product and an unknown item", async () => {
    for (const variantId of [product.ancient?.variantId, product.draft?.variantId, crypto.randomUUID()]) {
      const res = await add(variantId)
      expect(res.statusCode).toBe(404)
      expect(res.json().error).toBe("NotAvailableForQuote")
    }
  })

  it("caps a line at 9 999 units, added at once or in several goes", async () => {
    expect((await add(product.vest?.variantId, 10_000)).statusCode).toBe(400)
    await add(product.vest?.variantId, 9_000)
    const over = await add(product.vest?.variantId, 1_000)
    expect(over.statusCode).toBe(409)
    expect(over.json().error).toBe("QuantityTooLarge")
  })

  it(`caps a basket at ${MAX_QUOTE_LINES} lines`, async () => {
    const many = await db
      .insert(productVariants)
      .values(
        Array.from({ length: MAX_QUOTE_LINES }, (_, index) => ({
          productId: product.public?.id as string,
          skuVariant: `${TAG}-many-${index}`,
          couleur: `teinte ${index}`,
        })),
      )
      .returning({ id: productVariants.id })
    await db.insert(quoteBasketItems).values(many.map((variant) => ({ userId: pro.id, variantId: variant.id, qty: 1 })))

    const res = await add(product.vest?.variantId)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe("BasketFull")
    // Adding to a line already there stays possible.
    expect((await add(many[0]?.id)).statusCode).toBe(201)
  })

  it("changes a quantity and removes a line, its owner's only", async () => {
    await add(product.vest?.variantId, 2)
    const [line] = (await basket()).items

    expect((await call("PATCH", `/items/${line.id}`, { qty: 7 })).statusCode).toBe(200)
    expect((await basket()).items[0].qty).toBe(7)

    const other = await fixtures.account({ organisation: "approved" })
    expect((await call("PATCH", `/items/${line.id}`, { qty: 1 }, other.token)).statusCode).toBe(404)
    expect((await call("DELETE", `/items/${line.id}`, undefined, other.token)).statusCode).toBe(404)

    expect((await call("DELETE", `/items/${line.id}`)).statusCode).toBe(204)
    expect((await basket()).items).toEqual([])
  })

  it("flags a line whose product went offline since, instead of hiding it", async () => {
    await add(product.public?.variantId)
    const offline = await fixtures.product("later-offline")
    await add(offline.variantId)
    await db
      .update(organisations)
      .set({ showPrices: false })
      .where(eq(organisations.id, pro.organisationId as string))
    await db.update(products).set({ published: false }).where(eq(products.id, offline.id))

    const { items } = await basket()
    expect(items.find((item: { product: { slug: string } }) => item.product.slug === offline.slug)?.available).toBe(
      false,
    )
  })

  it("shows the pro's net price per unit once SCS opens prices", async () => {
    await db
      .update(organisations)
      .set({ showPrices: true, discountPct: "10.00" })
      .where(eq(organisations.id, pro.organisationId as string))
    await add(product.vest?.variantId, 2)

    const [line] = (await basket()).items
    // (400 € + the variant's 5 €) less 10 %.
    expect(line).toMatchObject({ netPriceHt: 364.5, netPriceTtc: 437.4 })
  })

  it("is closed to a pro whose organisation is not approved", async () => {
    const pending = await fixtures.account({ organisation: "pending" })
    expect((await add(product.vest?.variantId, 1, pending.token)).statusCode).toBe(403)
  })
})
