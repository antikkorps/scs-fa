import { eq, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { legalCategories, productCategories, products } from "../db/schema.js"

const SKU_PREFIX = "TEST21-"

async function categoryId(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(eq(productCategories.slug, slug))
    .limit(1)
  if (!row) throw new Error(`Missing seeded product category: ${slug} (run db:seed)`)
  return row.id
}

async function legalCategoryId(code: "A" | "B" | "C" | "D" | "none"): Promise<string> {
  const [row] = await db
    .select({ id: legalCategories.id })
    .from(legalCategories)
    .where(eq(legalCategories.category, code))
    .limit(1)
  if (!row) throw new Error(`Missing seeded legal category: ${code} (run db:seed)`)
  return row.id
}

describe("GET /api/products", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()

    await db.delete(products).where(like(products.sku, `${SKU_PREFIX}%`))

    const armePoing = await categoryId("arme-poing")
    const armeLongue = await categoryId("arme-longue")
    const munition = await categoryId("munition")
    const accessoire = await categoryId("accessoire-tireur")
    const legalB = await legalCategoryId("B")
    const legalC = await legalCategoryId("C")
    const legalNone = await legalCategoryId("none")

    await db.insert(products).values([
      {
        sku: `${SKU_PREFIX}alpha`,
        slug: `${SKU_PREFIX}alpha`,
        name: "Pistolet Test Alpha",
        description: "Un pistolet de compétition très précis",
        categoryId: armePoing,
        legalCategoryId: legalB,
        priceHt: "800.00",
        requiresLegalVerification: true,
        published: true,
      },
      {
        sku: `${SKU_PREFIX}beta`,
        slug: `${SKU_PREFIX}beta`,
        name: "Carabine Test Beta",
        description: "Carabine de chasse robuste",
        categoryId: armeLongue,
        legalCategoryId: legalC,
        priceHt: "1200.00",
        requiresLegalVerification: true,
        published: true,
      },
      {
        sku: `${SKU_PREFIX}gamma`,
        slug: `${SKU_PREFIX}gamma`,
        name: "Munition Test Gamma",
        description: "Boîte de cartouches calibre 9mm",
        categoryId: munition,
        legalCategoryId: legalNone,
        priceHt: "25.00",
        requiresLegalVerification: false,
        published: true,
      },
      {
        sku: `${SKU_PREFIX}delta`,
        slug: `${SKU_PREFIX}delta`,
        name: "Accessoire Test Delta caché",
        description: "Produit non publié",
        categoryId: accessoire,
        legalCategoryId: legalNone,
        priceHt: "50.00",
        requiresLegalVerification: false,
        published: false,
      },
    ])
  })

  afterAll(async () => {
    await db.delete(products).where(like(products.sku, `${SKU_PREFIX}%`))
    await app.close()
  })

  const testSkus = (body: { data: Array<{ sku: string }> }) =>
    body.data.filter((p) => p.sku.startsWith(SKU_PREFIX)).map((p) => p.sku)

  it("returns 200 with a paginated envelope and only published products", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products?limit=100" })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.pagination).toMatchObject({ page: 1, limit: 100 })
    expect(Array.isArray(body.data)).toBe(true)

    const skus = testSkus(body)
    expect(skus).toContain(`${SKU_PREFIX}alpha`)
    expect(skus).toContain(`${SKU_PREFIX}beta`)
    expect(skus).toContain(`${SKU_PREFIX}gamma`)
    // unpublished product is hidden
    expect(skus).not.toContain(`${SKU_PREFIX}delta`)
  })

  it("computes priceTtc from priceHt and vat", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products?category=arme-poing&limit=100" })
    const alpha = res.json().data.find((p: { sku: string }) => p.sku === `${SKU_PREFIX}alpha`)
    expect(alpha).toBeDefined()
    expect(alpha.priceHt).toBe(800)
    expect(alpha.vatPct).toBe(20)
    expect(alpha.priceTtc).toBe(960)
    expect(alpha.category).toMatchObject({ slug: "arme-poing" })
    expect(alpha.legalCategory).toBe("B")
  })

  it("paginates with limit/page metadata", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products?limit=2&page=1" })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(2)
    expect(body.pagination.total).toBeGreaterThanOrEqual(3)
    expect(body.pagination.totalPages).toBe(Math.ceil(body.pagination.total / 2))
    expect(body.pagination.hasMore).toBe(true)
  })

  it("filters by category slug", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products?category=munition&limit=100" })
    expect(res.statusCode).toBe(200)
    const skus = testSkus(res.json())
    expect(skus).toEqual([`${SKU_PREFIX}gamma`])
  })

  it("filters by legal category", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products?legalCategory=B&limit=100" })
    expect(res.statusCode).toBe(200)
    const skus = testSkus(res.json())
    expect(skus).toContain(`${SKU_PREFIX}alpha`)
    expect(skus).not.toContain(`${SKU_PREFIX}gamma`)
    expect(skus).not.toContain(`${SKU_PREFIX}beta`)
  })

  it("filters by minPrice", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products?minPrice=1000&limit=100" })
    const skus = testSkus(res.json())
    expect(skus).toEqual([`${SKU_PREFIX}beta`])
  })

  it("filters by maxPrice", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products?maxPrice=100&limit=100" })
    const skus = testSkus(res.json())
    expect(skus).toEqual([`${SKU_PREFIX}gamma`])
  })

  it("performs full-text search on name/description", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products?search=pistolet&limit=100" })
    expect(res.statusCode).toBe(200)
    const skus = testSkus(res.json())
    expect(skus).toContain(`${SKU_PREFIX}alpha`)
    expect(skus).not.toContain(`${SKU_PREFIX}beta`)
    expect(skus).not.toContain(`${SKU_PREFIX}gamma`)
  })

  it("returns 400 on a negative price", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products?minPrice=-5" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("ValidationError")
  })

  it("returns 400 when maxPrice is lower than minPrice", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products?minPrice=100&maxPrice=10" })
    expect(res.statusCode).toBe(400)
    expect(res.json().issues.some((i: { path: string }) => i.path === "maxPrice")).toBe(true)
  })

  it("returns 400 on an invalid category slug", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products?category=Arme_Poing" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("ValidationError")
  })
})
