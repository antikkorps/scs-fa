import { eq, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { legalCategories, productCategories, products, productVariants } from "../db/schema.js"

const SKU_PREFIX = "TEST22-"

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

describe("GET /api/products/:id", () => {
  let app: FastifyInstance
  let publishedId: string
  let accessoryId: string
  let unpublishedId: string

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()

    await db.delete(products).where(like(products.sku, `${SKU_PREFIX}%`))

    const armePoing = await categoryId("arme-poing")
    const accessoire = await categoryId("accessoire-tireur")
    const legalB = await legalCategoryId("B")
    const legalNone = await legalCategoryId("none")

    const inserted = await db
      .insert(products)
      .values([
        {
          sku: `${SKU_PREFIX}alpha`,
          slug: `${SKU_PREFIX}alpha`,
          name: "Pistolet Test Alpha",
          description: "Un pistolet de compétition très précis",
          longDescription: "Description longue détaillée du pistolet Alpha",
          categoryId: armePoing,
          legalCategoryId: legalB,
          priceHt: "800.00",
          ageMinRequired: 18,
          requiresLegalVerification: true,
          published: true,
        },
        {
          sku: `${SKU_PREFIX}gamma`,
          slug: `${SKU_PREFIX}gamma`,
          name: "Accessoire Test Gamma",
          description: "Tapis de nettoyage",
          categoryId: accessoire,
          legalCategoryId: legalNone,
          priceHt: "25.00",
          requiresLegalVerification: false,
          published: true,
        },
        {
          sku: `${SKU_PREFIX}delta`,
          slug: `${SKU_PREFIX}delta`,
          name: "Produit Test Delta caché",
          description: "Produit non publié",
          categoryId: accessoire,
          legalCategoryId: legalNone,
          priceHt: "50.00",
          requiresLegalVerification: false,
          published: false,
        },
      ])
      .returning({ id: products.id, sku: products.sku })

    const idOf = (sku: string): string => {
      const found = inserted.find((p) => p.sku === sku)
      if (!found) throw new Error(`Inserted product not found: ${sku}`)
      return found.id
    }

    publishedId = idOf(`${SKU_PREFIX}alpha`)
    accessoryId = idOf(`${SKU_PREFIX}gamma`)
    unpublishedId = idOf(`${SKU_PREFIX}delta`)

    // Two buyable variants on the published product (priced base HT + delta).
    await db.insert(productVariants).values([
      {
        productId: publishedId,
        skuVariant: `${SKU_PREFIX}alpha-noir`,
        finition: "Noir",
        stockQty: 4,
        priceDeltaHt: "0",
      },
      {
        productId: publishedId,
        skuVariant: `${SKU_PREFIX}alpha-inox`,
        finition: "Inox",
        stockQty: 2,
        priceDeltaHt: "50",
      },
    ])
  })

  afterAll(async () => {
    await db.delete(products).where(like(products.sku, `${SKU_PREFIX}%`))
    await app.close()
  })

  it("returns 200 with the full product detail", async () => {
    const res = await app.inject({ method: "GET", url: `/api/products/${publishedId}` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({
      id: publishedId,
      sku: `${SKU_PREFIX}alpha`,
      slug: `${SKU_PREFIX}alpha`,
      name: "Pistolet Test Alpha",
      longDescription: "Description longue détaillée du pistolet Alpha",
      requiresLegalVerification: true,
      ageMinRequired: 18,
    })
    expect(body.category).toMatchObject({ slug: "arme-poing", name: "Armes de poing" })
    expect(body.seo).toBeDefined()
  })

  it("returns buyable variants with per-variant TTC pricing", async () => {
    const res = await app.inject({ method: "GET", url: `/api/products/${publishedId}` })
    const body = res.json()
    expect(Array.isArray(body.variants)).toBe(true)
    expect(body.variants).toHaveLength(2)
    const inox = body.variants.find((v: { finition: string }) => v.finition === "Inox")
    expect(inox).toBeDefined()
    // base 800 HT + 50 delta = 850 HT → 1020 TTC at 20% VAT
    expect(inox.priceHt).toBe(850)
    expect(inox.priceTtc).toBe(1020)
    expect(inox.stockQty).toBe(2)
    expect(typeof inox.id).toBe("string")
  })

  it("computes priceTtc from priceHt and vat", async () => {
    const res = await app.inject({ method: "GET", url: `/api/products/${publishedId}` })
    const body = res.json()
    expect(body.priceHt).toBe(800)
    expect(body.vatPct).toBe(20)
    expect(body.priceTtc).toBe(960)
  })

  it("returns the full legal category object", async () => {
    const res = await app.inject({ method: "GET", url: `/api/products/${publishedId}` })
    const body = res.json()
    expect(body.legalCategory).toMatchObject({
      category: "B",
      requiresVerification: true,
      minAge: 18,
    })
    expect(Array.isArray(body.legalCategory.requiredDocTypes)).toBe(true)
  })

  it("returns 200 for a product in the unregulated legal category", async () => {
    const res = await app.inject({ method: "GET", url: `/api/products/${accessoryId}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().legalCategory).toMatchObject({ category: "none" })
  })

  it("returns 404 for an unpublished product", async () => {
    const res = await app.inject({ method: "GET", url: `/api/products/${unpublishedId}` })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe("NotFound")
  })

  it("returns 404 for an unknown product id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/products/00000000-0000-0000-0000-000000000000",
    })
    expect(res.statusCode).toBe(404)
  })

  it("returns 400 for a non-UUID id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products/not-a-uuid" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("ValidationError")
  })

  it("resolves a published product by slug", async () => {
    const res = await app.inject({ method: "GET", url: `/api/products/slug/${SKU_PREFIX}alpha` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.id).toBe(publishedId)
    expect(body.slug).toBe(`${SKU_PREFIX}alpha`)
    expect(body.legalCategory).toMatchObject({ category: "B" })
  })

  it("returns 404 for an unpublished product by slug", async () => {
    const res = await app.inject({ method: "GET", url: `/api/products/slug/${SKU_PREFIX}delta` })
    expect(res.statusCode).toBe(404)
  })

  it("returns 404 for an unknown slug", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products/slug/nope-does-not-exist" })
    expect(res.statusCode).toBe(404)
  })
})
