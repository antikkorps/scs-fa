import { eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { organisations } from "../db/schema.js"
import { type Account, type FixtureProduct, proFixtures } from "../test/pro-fixtures.js"

const TAG = "procat"

describe("the pro catalogue (story 12.8c)", () => {
  let app: FastifyInstance
  let fixtures: ReturnType<typeof proFixtures>
  let pro: Account
  const product: Record<string, FixtureProduct> = {}

  const get = (url: string, token?: string) =>
    app.inject({ method: "GET", url, headers: token ? { authorization: `Bearer ${token}` } : {} })

  const listed = async (token: string) => {
    const res = await get(`/api/pro/products?limit=100&search=${TAG}`, token)
    return res.json().data as Array<Record<string, unknown>>
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    fixtures = proFixtures(app, TAG)
    await fixtures.cleanup()
    pro = await fixtures.account({ organisation: "approved" })
    product.public = await fixtures.product("public", { priceHt: 200 })
    product.vest = await fixtures.product("vest", { audience: "pro", priceHt: 400 })
    product.draft = await fixtures.product("draft", { audience: "pro", published: false })
    product.ancient = await fixtures.product("ancient", {
      ancient: true,
      categorySlug: "arme-longue",
      legalCategory: "D",
    })
  })

  afterAll(async () => {
    await fixtures.cleanup()
    await app.close()
  })

  describe("who may open it", () => {
    it("lets in a member of an approved organisation", async () => {
      expect((await get("/api/pro/products", pro.token)).statusCode).toBe(200)
    })

    it("turns away an anonymous visitor, a private customer and an admin", async () => {
      expect((await get("/api/pro/products")).statusCode).toBe(401)
      const customer = await fixtures.account()
      expect((await get("/api/pro/products", customer.token)).statusCode).toBe(403)
      const admin = await fixtures.account({ role: "admin" })
      expect((await get("/api/pro/products", admin.token)).statusCode).toBe(403)
    })

    it("turns away a pro whose organisation is pending, suspended or refused, saying which", async () => {
      for (const status of ["pending", "suspended", "rejected"] as const) {
        const member = await fixtures.account({ organisation: status })
        const res = await get("/api/pro/products", member.token)
        expect(res.statusCode, status).toBe(403)
        expect(res.json()).toMatchObject({ error: "ProAccessRequired", organisationStatus: status })
      }
    })
  })

  describe("what it holds", () => {
    it("lists the public armurerie and the products reserved for pros, published only", async () => {
      const slugs = (await listed(pro.token)).map((row) => row.slug)
      expect(slugs).toContain(product.public?.slug)
      expect(slugs).toContain(product.vest?.slug)
      expect(slugs).not.toContain(product.draft?.slug)
    })

    it("leaves out collection pieces: a pro buys those as anyone does", async () => {
      const slugs = (await listed(pro.token)).map((row) => row.slug)
      expect(slugs).not.toContain(product.ancient?.slug)
      expect((await get(`/api/pro/products/slug/${product.ancient?.slug}`, pro.token)).statusCode).toBe(404)
    })

    it("opens a reserved product's page, with its variants", async () => {
      const res = await get(`/api/pro/products/slug/${product.vest?.slug}`, pro.token)
      expect(res.statusCode).toBe(200)
      expect(res.json().data).toMatchObject({ slug: product.vest?.slug, audience: "pro" })
      expect(res.json().data.variants[0].id).toBe(product.vest?.variantId)
    })
  })

  describe("prices", () => {
    it("never sends the public price, nor any price while « afficher les prix » is off", async () => {
      const [row] = await listed(pro.token)
      const page = (await get(`/api/pro/products/slug/${product.vest?.slug}`, pro.token)).json().data
      for (const shown of [row, page, page.variants[0]]) {
        expect(shown).not.toHaveProperty("priceHt")
        expect(shown).not.toHaveProperty("priceTtc")
        expect(shown).not.toHaveProperty("priceDeltaHt")
        expect(shown.netPriceHt).toBeNull()
      }
    })

    it("ignores price filters: they would give the public price away by bisection", async () => {
      const cheap = await get(`/api/pro/products?limit=100&search=${TAG}&maxPrice=150`, pro.token)
      const slugs = cheap.json().data.map((row: { slug: string }) => row.slug)
      expect(slugs).toContain(product.vest?.slug)
    })

    it("shows the pro's net prices once SCS opens them", async () => {
      await db
        .update(organisations)
        .set({ showPrices: true, discountPct: "10.00" })
        .where(eq(organisations.id, pro.organisationId as string))

      const page = (await get(`/api/pro/products/slug/${product.vest?.slug}`, pro.token)).json().data
      expect(page.netPriceHt).toBe(360)
      expect(page.netPriceTtc).toBe(432)
      // The variant's own delta (5 € HT) is discounted with the rest.
      expect(page.variants[0].netPriceHt).toBe(364.5)
      expect(page).not.toHaveProperty("priceHt")
    })
  })
})
